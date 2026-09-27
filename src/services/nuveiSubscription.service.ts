import { Payment, IPayment } from "../models/Payment";
import { User } from "../models/User";
import { Subscription, ISubscription } from "../models/Subscription";
import { CustomError } from "../errors/customError.error";
import { addMonths } from "../helpers/access.helper";
import {
  sendSubscriptionCanceledEmail,
  sendSubscriptionChargeFailedEmail,
  sendSubscriptionScheduledEmail,
} from "../helpers/email.helper";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";
import {
  NUVEI_MAX_AMOUNT,
  areSubscriptionsEnabled,
  findNuveiCredentials,
  isApprovedTransaction,
  nuveiEnvironment,
} from "../config/nuvei";
import { debitWithToken, deleteCard, listCards, verifyTransaction } from "./nuveiCard.service";
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
    amount: PAYMENT_PLANS[SUBSCRIPTION_PLAN].amount,
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
  status: "approved" | "pending" | "failed" | "duplicate" | "locked";
  paymentId?: string;
  transactionId?: string;
  message?: string;
};

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
      const granted = await approvePayment(devReference, facts, { extendAccess: true });
      const approved = await Payment.findById(payment._id);
      if (granted && approved) {
        await onSubscriptionPaymentApproved(approved);
        if (options.initial) await notifyAccessGranted(approved, { email: options.accessEmail });
        await sendReceiptOnce(approved._id);
      }
      return { status: "approved", paymentId: payment._id.toString(), transactionId: transaction.id };
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
  options: { accessEmail?: boolean } = {},
) {
  assertSubscriptionsEnabled();
  const plan = SUBSCRIPTION_PLAN;
  const { amount } = PAYMENT_PLANS[plan];
  if (amount > NUVEI_MAX_AMOUNT) {
    throw new CustomError(`El plan excede el límite de $${NUVEI_MAX_AMOUNT} autorizado por Nuvei`, 400);
  }
  if (await currentSubscription(userId)) {
    throw new CustomError("Ya tienes una suscripción activa. Cancélala antes de cambiar de plan.", 409);
  }

  const user = await User.findById(userId);
  if (!user) throw new CustomError("Usuario no encontrado", 404);
  if (user.subscriptionStatus === "active" && !user.accessUntil) {
    throw new CustomError("Tu acceso no tiene fecha de vencimiento; no necesitas una suscripción.", 409);
  }
  const now = new Date();
  const paidUntil = user.accessUntil && user.accessUntil > now ? user.accessUntil : null;
  const cardToken = requestedToken || user.nuveiDefaultCardToken;
  if (!cardToken) throw new CustomError("Agrega una tarjeta para suscribirte.", 400);

  const card = await resolveCard(userId, cardToken);
  if (!user.nuveiDefaultCardToken || requestedToken) {
    user.nuveiDefaultCardToken = cardToken;
    await user.save();
  }
  const sub = await Subscription.create({
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
    const cardLabel = card.number ? `${(card.type || "Tarjeta").toUpperCase()} •••• ${card.number}` : null;
    await sendSubscriptionScheduledEmail(user.email, user.name, amount, paidUntil, cardLabel, paymentsUrl()).catch(
      (err) => console.error("[Nuvei] Failed to send scheduled email:", err),
    );
    return { charge: null, firstChargeAt: paidUntil, subscription: serialize(sub) };
  }

  const charge = await chargeSubscription(sub._id.toString(), { initial: true, ip, accessEmail: options.accessEmail });
  const fresh = await Subscription.findById(sub._id);
  return { charge, firstChargeAt: null, subscription: serialize(fresh) };
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
