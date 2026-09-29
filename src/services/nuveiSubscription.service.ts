import { Payment, IPayment } from "../models/Payment";
import { User } from "../models/User";
import { Subscription, ISubscription } from "../models/Subscription";
import { CustomError } from "../errors/customError.error";
import { addMonths } from "../helpers/access.helper";
import { runInBackground } from "../helpers/mailer";
import {
  sendSubscriptionCanceledEmail,
  sendSubscriptionChargeFailedEmail,
  sendSubscriptionScheduledEmail,
  cardBrandLabel,
} from "../helpers/email.helper";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";
import {
  NUVEI_MAX_AMOUNT,
  areSubscriptionsEnabled,
  findNuveiCredentials,
  isApprovedTransaction,
  nuveiEnvironment,
} from "../config/nuvei";
import {
  NuveiTransaction,
  debitWithToken,
  deleteCard,
  getTransaction,
  listCards,
  verifyTransaction,
} from "./nuveiCard.service";
import {
  amountMatches,
  approvePayment,
  notifyAccessGranted,
  recordNonApproved,
  sendReceiptOnce,
} from "./nuveiPayments.service";

/**
 * Suscripciones con Nuvei Recurrencia: la tarjeta se tokeniza en el navegador
 * (credencial CLIENT, con OTP) y los cobros los hace el backend con débito con
 * token (credencial SERVER, sin 3DS). El cron diario cobra lo que vence.
 *
 * Modelo de negocio: una única suscripción mensual con renovación automática.
 * La alumna puede guardar varias tarjetas; se cobra siempre a la principal.
 */

export const SUBSCRIPTION_PLAN: PaymentPlan = "monthly";

/**
 * Plan de prueba: los correos de NUVEI_TEST_EMAILS (separados por coma) pagan
 * USD 1 al mes en vez del precio real, para probar cobros reales en producción
 * sin gastar USD 47. No existe como plan público.
 */
export const TEST_PLAN_AMOUNT = 1;

export function isTestPlanEmail(email: string) {
  const allowed = (process.env.NUVEI_TEST_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

export function subscriptionAmountFor(email: string) {
  return isTestPlanEmail(email) ? TEST_PLAN_AMOUNT : PAYMENT_PLANS[SUBSCRIPTION_PLAN].amount;
}
export const MAX_FAILED_ATTEMPTS = 3;
const RETRY_AFTER_DAYS = 2;
const PENDING_RECHECK_HOURS = 24;
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

function assertSubscriptionsEnabled() {
  if (!areSubscriptionsEnabled()) {
    throw new CustomError("Las suscripciones con tarjeta aún no están habilitadas.", 503);
  }
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function paymentsUrl() {
  return `${process.env.FRONTEND_URL}/app/pagos`;
}

function serialize(sub: ISubscription | null) {
  if (!sub) return null;
  return {
    id: sub._id.toString(),
    plan: sub.plan,
    amount: sub.amount,
    status: sub.status,
    cardBrand: sub.cardBrand,
    cardLast4: sub.cardLast4,
    nextChargeAt: sub.nextChargeAt,
    lastChargeAt: sub.lastChargeAt,
    failedAttempts: sub.failedAttempts,
    lastError: sub.lastError,
    canceledAt: sub.canceledAt,
    createdAt: sub.createdAt,
  };
}

async function currentSubscription(userId: string) {
  return Subscription.findOne({ user: userId, status: { $in: ["active", "past_due"] } }).sort({ createdAt: -1 });
}

/**
 * Datos para el formulario de tarjeta del navegador. La credencial CLIENT es
 * pública por diseño de Nuvei (el SDK la usa en el navegador); la SERVER nunca
 * sale del backend.
 */
export async function getCheckoutConfig(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  const client = findNuveiCredentials("cardClient");
  const enabled = areSubscriptionsEnabled();
  return {
    enabled,
    plan: SUBSCRIPTION_PLAN,
    amount: subscriptionAmountFor(user.email),
    environment: nuveiEnvironment(),
    appCode: enabled ? client?.appCode ?? null : null,
    appKey: enabled ? client?.appKey ?? null : null,
    user: { id: user._id.toString(), email: user.email },
    subscription: serialize(await Subscription.findOne({ user: userId }).sort({ createdAt: -1 })),
  };
}

/** Confirma que el token existe en Nuvei, es de esta alumna y está válido. */
async function resolveCard(userId: string, cardToken: string) {
  const cards = await listCards(userId);
  const card = cards.find((c) => c.token === cardToken);
  if (!card) throw new CustomError("No encontramos esa tarjeta. Vuelve a ingresarla.", 400);
  if (card.status !== "valid") {
    throw new CustomError(
      card.status === "pending"
        ? "La tarjeta necesita verificación con el código que te envió tu banco."
        : "La tarjeta está en revisión o fue rechazada por Nuvei.",
      409,
    );
  }
  return card;
}

// ── Tarjetas guardadas ────────────────────────────────────────────────────────
// Nuvei es la fuente de verdad de las tarjetas (list/delete por uid). Nosotros
// solo recordamos cuál es la principal.

export async function listMyCards(userId: string) {
  assertSubscriptionsEnabled();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  const cards = await listCards(userId);

  // Si la principal ya no existe en Nuvei, se promueve la primera válida.
  let defaultToken = user.nuveiDefaultCardToken;
  const valid = cards.filter((c) => c.status === "valid");
  if (!valid.some((c) => c.token === defaultToken)) {
    defaultToken = valid[0]?.token ?? null;
    if (defaultToken !== user.nuveiDefaultCardToken) {
      user.nuveiDefaultCardToken = defaultToken;
      await user.save();
    }
  }

  return cards.map((c) => ({
    token: c.token,
    brand: c.type ?? null,
    last4: c.number ?? null,
    bin: c.bin ?? null,
    expiryMonth: c.expiry_month ?? null,
    expiryYear: c.expiry_year ?? null,
    holderName: c.holder_name ?? null,
    status: c.status ?? null,
    isDefault: c.token === defaultToken,
  }));
}

/** Pasa la suscripción vigente a la tarjeta indicada (y cobra si estaba en mora). */
async function syncSubscriptionCard(userId: string, cardToken: string, ip?: string) {
  const sub = await currentSubscription(userId);
  if (!sub) return null;
  const card = await resolveCard(userId, cardToken);
  sub.cardToken = cardToken;
  sub.cardBrand = card.type ?? null;
  sub.cardLast4 = card.number ?? null;
  sub.cardBin = card.bin ?? null;
  await sub.save();
  return sub.status === "past_due" ? chargeSubscription(sub._id.toString(), { ip }) : null;
}

/** Registra una tarjeta recién tokenizada. La primera queda como principal. */
export async function saveCard(userId: string, cardToken: string, makeDefault: boolean, ip?: string) {
  assertSubscriptionsEnabled();
  await resolveCard(userId, cardToken);
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);

  let charge: ChargeResult | null = null;
  if (makeDefault || !user.nuveiDefaultCardToken) {
    user.nuveiDefaultCardToken = cardToken;
    await user.save();
    charge = await syncSubscriptionCard(userId, cardToken, ip);
  }
  return { cards: await listMyCards(userId), charge };
}

export async function setDefaultCard(userId: string, cardToken: string, ip?: string) {
  assertSubscriptionsEnabled();
  await resolveCard(userId, cardToken);
  await User.updateOne({ _id: userId }, { $set: { nuveiDefaultCardToken: cardToken } });
  const charge = await syncSubscriptionCard(userId, cardToken, ip);
  return { cards: await listMyCards(userId), charge, subscription: await getMySubscription(userId) };
}

export async function removeCard(userId: string, cardToken: string) {
  assertSubscriptionsEnabled();
  const user = await User.findById(userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  const sub = await currentSubscription(userId);
  if (sub && sub.cardToken === cardToken) {
    throw new CustomError(
      "Esta tarjeta paga tu suscripción. Elige otra tarjeta como principal antes de eliminarla.",
      409,
    );
  }

  await deleteCard(userId, cardToken);
  if (user.nuveiDefaultCardToken === cardToken) {
    user.nuveiDefaultCardToken = null;
    await user.save();
  }
  return { cards: await listMyCards(userId) };
}

/** Verifica con el OTP del banco una tarjeta recién agregada (status pending). */
export async function verifyCardOtp(userId: string, transactionId: string, otp: string) {
  assertSubscriptionsEnabled();
  const result = await verifyTransaction({ userId, transactionId, type: "BY_OTP", value: otp });
  const detail = String(result.status_detail ?? "");
  const verified = String(result.status) === "1" || detail === "32" || detail === "3";
  if (!verified) {
    throw new CustomError(result.message || "El código no es válido. Revisa el SMS de tu banco.", 400);
  }
  return { verified: true, statusDetail: result.status_detail };
}

type ChargeResult = {
  /** otp_required: el banco (p. ej. Diners) pide un código para terminar el cobro. */
  status: "approved" | "pending" | "failed" | "duplicate" | "locked" | "otp_required";
  paymentId?: string;
  transactionId?: string;
  message?: string;
};

/** Nuvei deja el débito esperando el código del banco (tarjetas Diners, por ejemplo). */
function isWaitingOtp(transaction: NuveiTransaction) {
  return (
    String(transaction.status) === "pending" &&
    (transaction.carrier_code === "WAITING_OTP" || String(transaction.status_detail) === "31")
  );
}

type ChargeFacts = Parameters<typeof approvePayment>[1];

/** Aprueba un cobro de suscripción: acceso, próximo cobro, correos. */
async function finalizeApprovedCharge(
  paymentId: IPayment["_id"],
  devReference: string,
  facts: ChargeFacts,
  options: { initial?: boolean; accessEmail?: boolean },
) {
  const granted = await approvePayment(devReference, facts, { extendAccess: true });
  const approved = await Payment.findById(paymentId);
  if (granted && approved) {
    await onSubscriptionPaymentApproved(approved);
    // Los correos no deben retrasar la respuesta del pago.
    await runInBackground(
      (async () => {
        if (options.initial) await notifyAccessGranted(approved, { email: options.accessEmail });
        await sendReceiptOnce(approved._id);
      })(),
      "correos del cobro",
    );
  }
}

/** Fecha en Ecuador para la referencia: a lo sumo un cobro por día y por intento. */
function chargeReference(sub: ISubscription) {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" }).replace(/-/g, "");
  return `nuvei-sub-${nuveiEnvironment()}-${sub._id.toString()}-${day}-${sub.failedAttempts}`;
}

/**
 * Cobra una suscripción. El candado (chargingAt) y el dev_reference único por
 * día evitan cobrar dos veces aunque el cron corra en paralelo o se reintente.
 */
export async function chargeSubscription(
  subscriptionId: string,
  options: { initial?: boolean; ip?: string; accessEmail?: boolean } = {},
): Promise<ChargeResult> {
  const now = new Date();
  const sub = await Subscription.findOneAndUpdate(
    {
      _id: subscriptionId,
      status: { $in: ["active", "past_due"] },
      $or: [{ chargingAt: null }, { chargingAt: { $lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } }],
    },
    { $set: { chargingAt: now } },
    { new: true },
  );
  if (!sub) return { status: "locked", message: "La suscripción ya se está cobrando o no está activa" };

  try {
    const user = await User.findById(sub.user);
    if (!user) throw new CustomError("Usuario no encontrado", 404);

    const devReference = chargeReference(sub);
    let payment: IPayment;
    try {
      payment = await Payment.create({
        user: user._id,
        plan: sub.plan,
        amount: sub.amount,
        currency: "USD",
        gateway: "nuvei",
        source: "subscription",
        subscription: sub._id,
        clientTransactionId: devReference,
      });
    } catch (err) {
      if ((err as { code?: number }).code === 11000) {
        return { status: "duplicate", message: "Ya hubo un intento de cobro hoy para esta suscripción" };
      }
      throw err;
    }

    const cardServer = findNuveiCredentials("cardServer");
    const { transaction, card } = await debitWithToken({
      user: { id: user._id.toString(), email: user.email, ip: options.ip },
      amount: sub.amount,
      description: PAYMENT_PLANS[sub.plan].reference,
      devReference,
      cardToken: sub.cardToken,
    });
    const facts = {
      transaction,
      card: { type: card.type ?? sub.cardBrand ?? undefined, number: card.number ?? sub.cardLast4 ?? undefined },
      applicationCode: cardServer?.appCode ?? null,
    };

    if (isApprovedTransaction(transaction.status, transaction.status_detail) && amountMatches(payment, transaction.amount)) {
      await finalizeApprovedCharge(payment._id, devReference, facts, options);
      return { status: "approved", paymentId: payment._id.toString(), transactionId: transaction.id };
    }

    // El banco pide un código (OTP). Con la alumna presente se lo pedimos en
    // pantalla; en una renovación automática no hay quién lo ingrese.
    if (isWaitingOtp(transaction)) {
      if (options.initial) {
        await recordNonApproved(devReference, "pending", facts);
        await Subscription.updateOne(
          { _id: sub._id },
          { $set: { nextChargeAt: new Date(now.getTime() + PENDING_RECHECK_HOURS * 3600 * 1000) } },
        );
        return {
          status: "otp_required",
          paymentId: payment._id.toString(),
          transactionId: transaction.id,
          message: "Tu banco envió un código de verificación para confirmar el pago.",
        };
      }
      await recordNonApproved(devReference, "failed", facts);
      await registerFailedCharge(sub, "El banco pidió un código OTP en la renovación automática", false);
      return {
        status: "failed",
        paymentId: payment._id.toString(),
        transactionId: transaction.id,
        message: "Tu banco pidió un código para la renovación. Cambia de tarjeta o vuelve a intentarlo.",
      };
    }

    if (String(transaction.status) === "pending") {
      await recordNonApproved(devReference, "pending", facts);
      await Subscription.updateOne(
        { _id: sub._id },
        { $set: { nextChargeAt: new Date(now.getTime() + PENDING_RECHECK_HOURS * 3600 * 1000) } },
      );
      return {
        status: "pending",
        paymentId: payment._id.toString(),
        transactionId: transaction.id,
        message: "El banco dejó el cobro pendiente. Te avisaremos cuando se confirme.",
      };
    }

    await recordNonApproved(devReference, "failed", facts);
    const reason = transaction.message || `Rechazado (detalle ${transaction.status_detail ?? "?"})`;
    await registerFailedCharge(sub, reason, options.initial === true);
    return {
      status: "failed",
      paymentId: payment._id.toString(),
      transactionId: transaction.id,
      message: "La tarjeta fue rechazada. Prueba con otra tarjeta.",
    };
  } finally {
    await Subscription.updateOne({ _id: sub._id }, { $set: { chargingAt: null } });
  }
}

async function registerFailedCharge(sub: ISubscription, reason: string, initial: boolean) {
  const user = await User.findById(sub.user);
  const failedAttempts = sub.failedAttempts + 1;

  // El primer cobro fallido no deja una suscripción colgando: la alumna ve el
  // error en pantalla y puede intentar con otra tarjeta.
  if (initial || failedAttempts >= MAX_FAILED_ATTEMPTS) {
    await Subscription.updateOne(
      { _id: sub._id },
      {
        $set: {
          status: "canceled",
          failedAttempts,
          lastError: reason,
          canceledAt: new Date(),
          cancelReason: initial ? "initial_charge_failed" : "max_failed_attempts",
        },
      },
    );
    if (!initial && user) {
      await sendSubscriptionChargeFailedEmail(user.email, user.name, sub.plan, null, paymentsUrl()).catch((err) =>
        console.error("[Nuvei] Failed to send charge failed email:", err),
      );
    }
    return;
  }

  const retryAt = addDays(new Date(), RETRY_AFTER_DAYS);
  await Subscription.updateOne(
    { _id: sub._id },
    { $set: { status: "past_due", failedAttempts, lastError: reason, nextChargeAt: retryAt } },
  );
  if (user) {
    await sendSubscriptionChargeFailedEmail(user.email, user.name, sub.plan, retryAt, paymentsUrl()).catch((err) =>
      console.error("[Nuvei] Failed to send charge failed email:", err),
    );
  }
}

/**
 * Tras un cobro aprobado (en línea o por webhook), el próximo cobro es el día
 * en que vence el acceso recién otorgado.
 */
export async function onSubscriptionPaymentApproved(payment: IPayment) {
  if (!payment.subscription) return;
  const sub = await Subscription.findById(payment.subscription);
  if (!sub) return;
  const user = await User.findById(payment.user);
  const nextChargeAt = user?.accessUntil ?? addMonths(new Date(), PAYMENT_PLANS[sub.plan].months);

  sub.lastChargeAt = new Date();
  sub.failedAttempts = 0;
  sub.lastError = null;
  if (sub.status !== "canceled") {
    sub.status = "active";
    sub.nextChargeAt = nextChargeAt;
  }
  await sub.save();
}

/**
 * Alta de la suscripción mensual con la tarjeta indicada o la principal.
 *
 * Cambio de forma de pago: si la alumna ya tiene acceso pagado (PayPhone,
 * transferencia), NO se cobra hoy; el primer cobro es el día en que vence ese
 * acceso. Si no tiene acceso vigente, se cobra de inmediato.
 */
export async function subscribe(
  userId: string,
  requestedToken: string | undefined,
  ip?: string,
  options: { accessEmail?: boolean; termsVersion?: string } = {},
) {
  assertSubscriptionsEnabled();
  if (!options.termsVersion) {
    throw new CustomError("Debes aceptar los Términos y condiciones para suscribirte.", 400);
  }
  const plan = SUBSCRIPTION_PLAN;
  if (await currentSubscription(userId)) {
    throw new CustomError("Ya tienes una suscripción activa. Cancélala antes de cambiar de plan.", 409);
  }

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  const amount = subscriptionAmountFor(user.email);
  if (amount > NUVEI_MAX_AMOUNT) {
    throw new CustomError(`El plan excede el límite de $${NUVEI_MAX_AMOUNT} autorizado por Nuvei`, 400);
  }
  if (user.subscriptionStatus === "active" && !user.accessUntil) {
    throw new CustomError("Tu acceso no tiene fecha de vencimiento; no necesitas una suscripción.", 409);
  }
  const now = new Date();
  const paidUntil = user.accessUntil && user.accessUntil > now ? user.accessUntil : null;
  const cardToken = requestedToken || user.nuveiDefaultCardToken;
  if (!cardToken) throw new CustomError("Agrega una tarjeta para suscribirte.", 400);

  const card = await resolveCard(userId, cardToken);
  const termsAcceptedAt = new Date();
  if (!user.nuveiDefaultCardToken || requestedToken) user.nuveiDefaultCardToken = cardToken;
  user.termsVersion = options.termsVersion;
  user.termsAcceptedAt = termsAcceptedAt;
  await user.save();

  const sub = await Subscription.create({
    termsVersion: options.termsVersion,
    termsAcceptedAt,
    termsAcceptedIp: ip ?? null,
    user: userId,
    plan,
    amount,
    status: "active",
    cardToken,
    cardBrand: card.type ?? null,
    cardLast4: card.number ?? null,
    cardBin: card.bin ?? null,
    nextChargeAt: paidUntil ?? now,
  });

  if (paidUntil) {
    // Renueva sin cobrar hoy: vuelve a quedar "activa" aunque antes la hubiera cancelado.
    if (user.subscriptionStatus !== "active") {
      user.subscriptionStatus = "active";
      await user.save();
    }
    const cardLabel = card.number ? `${cardBrandLabel(card.type)} •••• ${card.number}` : null;
    await runInBackground(
      sendSubscriptionScheduledEmail(user.email, user.name, amount, paidUntil, cardLabel, paymentsUrl()),
      "correo de suscripción sin cobro",
    );
    return { charge: null, firstChargeAt: paidUntil, subscription: serialize(sub) };
  }

  const charge = await chargeSubscription(sub._id.toString(), { initial: true, ip, accessEmail: options.accessEmail });
  const fresh = await Subscription.findById(sub._id);
  return { charge, firstChargeAt: null, subscription: serialize(fresh) };
}

/**
 * Termina un cobro que quedó esperando el OTP del banco. Si el código es
 * incorrecto se puede reintentar; si el banco rechaza, la suscripción se cancela
 * como cualquier primer cobro fallido.
 */
export async function verifyChargeOtp(
  userId: string,
  paymentId: string,
  otp: string,
  options: { accessEmail?: boolean } = {},
): Promise<ChargeResult> {
  assertSubscriptionsEnabled();
  const payment = await Payment.findOne({ _id: paymentId, user: userId, gateway: "nuvei", source: "subscription" });
  if (!payment?.nuveiTransactionId) throw new CustomError("Pago no encontrado", 404);
  if (payment.status === "approved") {
    return { status: "approved", paymentId, transactionId: payment.nuveiTransactionId };
  }
  if (payment.status !== "pending") throw new CustomError("Este pago ya no está esperando un código", 409);

  const result = await verifyTransaction({
    userId,
    transactionId: payment.nuveiTransactionId,
    type: "BY_OTP",
    value: otp,
  });
  const detail = String(result.status_detail ?? "");

  if (String(result.status) === "1" && detail === "3") {
    // La verificación no trae el código de autorización: se lee la transacción.
    const { transaction, card } = await getTransaction(payment.nuveiTransactionId, "cardServer");
    const facts = {
      transaction: { ...transaction, status: "success", status_detail: 3 },
      card: { type: card.type ?? undefined, number: card.number ?? undefined },
      applicationCode: findNuveiCredentials("cardServer")?.appCode ?? null,
    };
    if (!amountMatches(payment, transaction.amount ?? payment.amount)) {
      throw new CustomError("El monto confirmado por el banco no coincide", 409);
    }
    await finalizeApprovedCharge(payment._id, payment.clientTransactionId, facts, {
      initial: true,
      accessEmail: options.accessEmail,
    });
    return { status: "approved", paymentId, transactionId: payment.nuveiTransactionId };
  }

  // 31 = sigue esperando, 33 = OTP no validado: se puede volver a intentar.
  if (detail === "31" || detail === "33" || String(result.status) === "0") {
    throw new CustomError(result.message || "El código no es correcto. Revísalo e intenta de nuevo.", 400);
  }

  payment.status = "failed";
  payment.nuveiStatusDetail = Number(detail) || null;
  await payment.save();
  const sub = payment.subscription ? await Subscription.findById(payment.subscription) : null;
  if (sub) await registerFailedCharge(sub, result.message || `OTP rechazado (detalle ${detail})`, true);
  return { status: "failed", paymentId, message: "El banco rechazó el pago. Prueba con otra tarjeta." };
}

export async function getMySubscription(userId: string) {
  return serialize(await Subscription.findOne({ user: userId }).sort({ createdAt: -1 }));
}

/**
 * Cancela la renovación. El acceso ya pagado se conserva hasta accessUntil.
 * Devuelve null si no había suscripción que cancelar.
 */
export async function cancelSubscriptionFor(userId: string, reason: string) {
  const sub = await currentSubscription(userId);
  if (!sub) return null;
  return cancelSubscriptionDoc(sub, reason);
}

async function cancelSubscriptionDoc(sub: ISubscription, reason: string) {
  sub.status = "canceled";
  sub.canceledAt = new Date();
  sub.cancelReason = reason;
  await sub.save();

  const user = await User.findById(sub.user);
  if (user) {
    await sendSubscriptionCanceledEmail(user.email, user.name, user.accessUntil).catch((err) =>
      console.error("[Nuvei] Failed to send canceled email:", err),
    );
  }
  return serialize(sub);
}

/** Cron diario: cobra todas las suscripciones vencidas, una por una. */
export async function chargeDueSubscriptions(options: { dryRun?: boolean; limit?: number } = {}) {
  if (!areSubscriptionsEnabled()) return { enabled: false, due: 0, results: [] };

  const due = await Subscription.find({
    status: { $in: ["active", "past_due"] },
    nextChargeAt: { $lte: new Date() },
  })
    .sort({ nextChargeAt: 1 })
    .limit(Math.min(options.limit ?? 50, 200));

  if (options.dryRun) {
    return { enabled: true, due: due.length, results: due.map((s) => ({ id: s._id.toString(), plan: s.plan })) };
  }

  const results: Array<{ id: string } & ChargeResult> = [];
  for (const sub of due) {
    // Primer cobro que quedó esperando el OTP y la alumna nunca confirmó: no se
    // le cobra por su cuenta; se cancela y puede volver a suscribirse.
    const abandonedOtp =
      !sub.lastChargeAt && (await Payment.exists({ subscription: sub._id, status: "pending" }));
    if (abandonedOtp) {
      await Subscription.updateOne(
        { _id: sub._id },
        { $set: { status: "canceled", canceledAt: new Date(), cancelReason: "initial_otp_abandoned" } },
      );
      await Payment.updateMany({ subscription: sub._id, status: "pending" }, { $set: { status: "canceled" } });
      results.push({ id: sub._id.toString(), status: "failed", message: "OTP inicial no confirmado" });
      continue;
    }
    try {
      results.push({ id: sub._id.toString(), ...(await chargeSubscription(sub._id.toString())) });
    } catch (err) {
      console.error("[Nuvei] Subscription charge crashed:", sub._id.toString(), err);
      results.push({ id: sub._id.toString(), status: "failed", message: (err as Error).message });
    }
  }
  return { enabled: true, due: due.length, results };
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function listSubscriptions(filters: { status?: string }) {
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  const subs = await Subscription.find(query)
    .sort({ createdAt: -1 })
    .limit(500)
    .populate("user", "name lastName email accessUntil");
  return subs.map((s) => ({ ...serialize(s), user: s.user }));
}

export async function adminCancelSubscription(subscriptionId: string) {
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) throw new CustomError("Suscripción no encontrada", 404);
  if (sub.status === "canceled") throw new CustomError("La suscripción ya está cancelada", 409);
  return cancelSubscriptionDoc(sub, "admin");
}

export async function adminChargeNow(subscriptionId: string) {
  assertSubscriptionsEnabled();
  const sub = await Subscription.findById(subscriptionId);
  if (!sub) throw new CustomError("Suscripción no encontrada", 404);
  if (sub.status === "canceled") throw new CustomError("La suscripción está cancelada", 409);
  return chargeSubscription(subscriptionId);
}
