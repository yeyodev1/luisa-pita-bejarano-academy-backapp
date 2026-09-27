import axios, { AxiosError } from "axios";
import crypto from "crypto";
import { Payment } from "../models/Payment";
import { User } from "../models/User";
import { Subscription } from "../models/Subscription";
import { CustomError } from "../errors/customError.error";
import { hashPassword } from "../helpers/password.helper";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";
import {
  NUVEI_MAX_AMOUNT,
  NUVEI_TAX_PERCENTAGE,
  buildAuthToken,
  credentialKindForAppCode,
  isApprovedTransaction,
  isNuveiEnabled,
  isValidStoken,
  nuveiBaseUrl,
  nuveiEnvironment,
  taxableAmountOf,
  vatIncludedIn,
} from "../config/nuvei";
import { refundTransaction } from "./nuveiCard.service";
import {
  amountMatches,
  approvePayment,
  notifyAccessGranted,
  recordNonApproved,
  reversePayment,
  sendReceiptOnce,
} from "./nuveiPayments.service";
import { onSubscriptionPaymentApproved } from "./nuveiSubscription.service";

type GuestData = { email: string; name: string; lastName: string };

/**
 * installments_type para Ecuador (ver tabla de Nuvei): 0 = solo corriente,
 * 2 = diferido con intereses. Este comercio tiene corriente + diferido con
 * intereses a 3 meses; mientras Nuvei no confirme el código queda en 0.
 */
function installmentsType(): number {
  const raw = Number(process.env.NUVEI_INSTALLMENTS_TYPE);
  return Number.isFinite(raw) ? raw : 0;
}

function assertEnabled() {
  if (!isNuveiEnabled()) {
    throw new CustomError(
      "Nuvei aún no está habilitado. Falta la confirmación oficial de activación del comercio.",
      503,
    );
  }
}

async function findOrCreateGuestUser(input: GuestData) {
  const normalizedEmail = input.email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) return { user: existing, isNew: false, plainPassword: null };

  const plainPassword = crypto.randomBytes(8).toString("hex");
  const user = await User.create({
    name: input.name.trim(),
    lastName: input.lastName.trim(),
    email: normalizedEmail,
    password: await hashPassword(plainPassword),
    isVerified: true,
    verificationToken: null,
    verificationTokenExpires: null,
    subscriptionStatus: "none",
    accessUntil: null,
  });
  return { user, isNew: true, plainPassword };
}

function frontendUrl(origin?: string): string {
  return origin || process.env.FRONTEND_URL || "";
}

type InitOrderResponse = {
  success?: boolean;
  detail?: string;
  data?: { order?: { id?: string }; payment?: { payment_url?: string; payment_qr?: string } };
  // Algunas versiones responden sin el envoltorio `data`.
  payment?: { payment_url?: string; payment_qr?: string; id?: string };
  order?: { id?: string };
};

/**
 * Crea el link de pago y el registro `pending`. El registro se crea ANTES de
 * redirigir para que el webhook siempre encuentre a qué transacción aplicar.
 */
export async function createPaymentLink(
  plan: PaymentPlan,
  guestData: GuestData,
  origin?: string,
) {
  assertEnabled();

  const { amount, reference } = PAYMENT_PLANS[plan];
  if (amount > NUVEI_MAX_AMOUNT) {
    throw new CustomError(
      `El plan excede el límite de $${NUVEI_MAX_AMOUNT} autorizado por Nuvei`,
      400,
    );
  }

  const { user, isNew, plainPassword } = await findOrCreateGuestUser(guestData);
  const userId = user._id.toString();
  const env = nuveiEnvironment();
  const devReference = `nuvei-${env}-${userId}-${Date.now()}`;
  const base = frontendUrl(origin);

  const payload = {
    user: {
      id: userId,
      email: user.email,
      name: user.name,
      last_name: user.lastName || user.name,
    },
    order: {
      dev_reference: devReference,
      description: reference,
      amount,
      vat: vatIncludedIn(amount),
      taxable_amount: taxableAmountOf(amount),
      tax_percentage: NUVEI_TAX_PERCENTAGE,
      installments_type: installmentsType(),
      currency: "USD",
    },
    configuration: {
      partial_payment: false,
      expiration_days: 1,
      allowed_payment_methods: ["All"],
      success_url: `${base}/pago/nuvei?ref=${devReference}&status=success`,
      failure_url: `${base}/pago/nuvei?ref=${devReference}&status=failure`,
      pending_url: `${base}/pago/nuvei?ref=${devReference}&status=pending`,
      review_url: `${base}/pago/nuvei?ref=${devReference}&status=review`,
    },
  };

  await Payment.create({
    user: userId,
    plan,
    amount,
    currency: "USD",
    gateway: "nuvei",
    source: "link",
    clientTransactionId: devReference,
    isNewUser: isNew,
    plainPassword,
  });

  try {
    const response = await axios.post<InitOrderResponse>(
      `${nuveiBaseUrl()}/linktopay/init_order/`,
      payload,
      { headers: { "Auth-Token": buildAuthToken("ltp"), "Content-Type": "application/json" } },
    );

    // La respuesta documentada es { success, detail, data: { order, payment } }.
    const body = response.data;
    const payment = body.data?.payment ?? body.payment;
    const orderId = body.data?.order?.id ?? body.order?.id ?? body.payment?.id ?? null;
    const paymentUrl = payment?.payment_url;
    if (!paymentUrl) {
      console.error("[Nuvei] init_order without payment_url:", body);
      throw new CustomError("Nuvei no devolvió un link de pago", 502);
    }

    await Payment.updateOne(
      { clientTransactionId: devReference },
      { $set: { nuveiLinkId: orderId, nuveiResponse: body } },
    );

    return {
      paymentUrl,
      paymentQr: payment?.payment_qr,
      devReference,
      amount,
      isNewUser: isNew,
    };
  } catch (error) {
    await Payment.updateOne(
      { clientTransactionId: devReference },
      { $set: { status: "failed" } },
    );
    if (error instanceof CustomError) throw error;
    const axiosError = error as AxiosError;
    console.error("[Nuvei] init_order failed:", axiosError.response?.data ?? axiosError.message);
    throw new CustomError("No se pudo generar el link de pago", 502);
  }
}

type NuveiWebhookBody = {
  transaction?: {
    id?: string;
    status?: string | number;
    status_detail?: string | number;
    dev_reference?: string;
    stoken?: string;
    amount?: string | number;
    authorization_code?: string;
    application_code?: string;
    ltp_id?: string;
    message?: string;
  };
  user?: { id?: string; email?: string };
  card?: { type?: string; number?: string; bin?: string };
};

export type WebhookResult = {
  /** 200 = recibido; 203 = stoken inválido (así lo pide Nuvei). */
  httpStatus: 200 | 203;
  status?: string;
  accessGranted?: boolean;
  ignored?: string;
};

/**
 * Confirmación servidor-a-servidor (callback). Es la fuente de verdad: el
 * retorno del navegador solo consulta el estado ya persistido aquí.
 *
 * Reglas de Nuvei: aprobar solo con status 1 + status_detail 3 y monto
 * correcto; responder 200 aunque sea un duplicado; status 2 = una transacción
 * aprobada que luego se anuló o reembolsó.
 */
export async function handleWebhook(body: NuveiWebhookBody): Promise<WebhookResult> {
  // Sin credenciales no se puede validar la firma. Se corta acá para no
  // reventar en un 500 que además dispara la alerta de Slack: este endpoint es
  // público y recibe sondeos.
  if (!isNuveiEnabled()) {
    throw new CustomError("Nuvei no está habilitado", 401);
  }

  const transaction = body.transaction;
  const devReference = transaction?.dev_reference;
  const transactionId = transaction?.id;
  const userId = body.user?.id;

  if (!devReference || !transactionId || !userId) {
    throw new CustomError("Webhook inválido", 400);
  }

  if (!isValidStoken(String(transaction?.stoken ?? ""), transactionId, transaction?.application_code, userId)) {
    console.warn("[Nuvei] Webhook with invalid stoken:", transactionId);
    return { httpStatus: 203, ignored: "invalid stoken" };
  }

  const payment = await Payment.findOne({ clientTransactionId: devReference, gateway: "nuvei" });
  if (!payment) {
    // 200 para que Nuvei no reintente 48 horas algo que no es nuestro.
    return { httpStatus: 200, ignored: "unknown dev_reference" };
  }

  const facts = {
    transaction: { ...transaction, status: String(transaction.status ?? "") },
    card: body.card,
    applicationCode: transaction.application_code ?? null,
  };
  const status = String(transaction.status ?? "");

  if (status === "2") {
    const refunded = String(transaction.status_detail) === "7";
    await reversePayment(payment, refunded ? "refunded" : "canceled", transaction.message ?? null);
    return { httpStatus: 200, status: refunded ? "refunded" : "canceled", accessGranted: false };
  }

  if (isApprovedTransaction(status, transaction.status_detail)) {
    if (!amountMatches(payment, transaction.amount)) {
      console.error("[Nuvei] Amount mismatch", { devReference, expected: payment.amount, got: transaction.amount });
      await recordNonApproved(devReference, "failed", facts);
      return { httpStatus: 200, status: "failed", accessGranted: false, ignored: "amount mismatch" };
    }

    const isSubscription = payment.source === "subscription";
    const granted = await approvePayment(devReference, facts, { extendAccess: isSubscription });
    if (granted) {
      const approved = await Payment.findById(payment._id);
      if (approved) {
        if (isSubscription) await onSubscriptionPaymentApproved(approved);
        else await notifyAccessGranted(approved);
        await sendReceiptOnce(approved._id);
      }
    } else {
      // Duplicado: igual se reintenta el comprobante por si falló antes.
      await sendReceiptOnce(payment._id);
    }
    return { httpStatus: 200, status: "approved", accessGranted: granted };
  }

  const mapped = status === "0" || status === "1" ? "pending" : "failed";
  await recordNonApproved(devReference, mapped, facts);
  return { httpStatus: 200, status: mapped, accessGranted: false };
}

/** Estado para la vista de retorno del navegador. No consulta a Nuvei. */
export async function getPaymentStatus(devReference: string) {
  const payment = await Payment.findOne({
    clientTransactionId: devReference,
    gateway: "nuvei",
  });
  if (!payment) throw new CustomError("Transacción no encontrada", 404);

  const user = await User.findById(payment.user);
  return {
    status: payment.status,
    plan: payment.plan,
    amount: payment.amount,
    transactionId: payment.nuveiTransactionId ?? undefined,
    authorizationCode: payment.nuveiAuthorizationCode ?? undefined,
    isNewUser: payment.isNewUser,
    plainPassword: payment.plainPassword || undefined,
    email: user?.email,
  };
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function listNuveiPayments(filters: { search?: string; status?: string; limit?: number }) {
  const query: Record<string, unknown> = { gateway: "nuvei" };
  if (filters.status) query.status = filters.status;
  if (filters.search?.trim()) {
    const regex = new RegExp(filters.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const users = await User.find({ $or: [{ email: regex }, { name: regex }, { lastName: regex }] }).select("_id");
    query.$or = [
      { user: { $in: users.map((u) => u._id) } },
      { nuveiTransactionId: regex },
      { clientTransactionId: regex },
    ];
  }

  const payments = await Payment.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(filters.limit ?? 100, 500))
    .populate("user", "name lastName email");

  return payments.map((p) => ({
    id: p._id.toString(),
    user: p.user,
    plan: p.plan,
    amount: p.amount,
    status: p.status,
    source: p.source ?? "link",
    transactionId: p.nuveiTransactionId,
    authorizationCode: p.nuveiAuthorizationCode,
    statusDetail: p.nuveiStatusDetail,
    cardBrand: p.cardBrand,
    cardLast4: p.cardLast4,
    devReference: p.clientTransactionId,
    refundedAt: p.refundedAt,
    refundDetail: p.refundDetail,
    receiptSentAt: p.receiptSentAt,
    createdAt: p.createdAt,
  }));
}

/**
 * Reembolso total desde el admin. Requisito bancario de Nuvei. Quita el acceso
 * que dio el pago y, si era de una suscripción, la cancela.
 */
export async function refundNuveiPayment(paymentId: string) {
  assertEnabled();
  const payment = await Payment.findOne({ _id: paymentId, gateway: "nuvei" });
  if (!payment) throw new CustomError("Pago no encontrado", 404);
  if (payment.status === "refunded") throw new CustomError("Este pago ya fue reembolsado", 409);
  if (payment.status !== "approved" || !payment.nuveiTransactionId) {
    throw new CustomError("Solo se pueden reembolsar pagos aprobados", 409);
  }

  const kind =
    credentialKindForAppCode(payment.nuveiApplicationCode) ??
    (payment.source === "subscription" ? "cardServer" : "ltp");

  const result = await refundTransaction(payment.nuveiTransactionId, kind);
  if (result.status === "failure") {
    throw new CustomError(`Nuvei rechazó el reembolso: ${result.detail || "sin detalle"}`, 409);
  }

  // "pending" = Nuvei espera confirmación del banco; igual se quita el acceso.
  await reversePayment(payment, "refunded", `${result.status}: ${result.detail}`);

  if (payment.subscription) {
    await Subscription.updateOne(
      { _id: payment.subscription, status: { $ne: "canceled" } },
      { $set: { status: "canceled", canceledAt: new Date(), cancelReason: "refund" } },
    );
  }

  return { id: payment._id.toString(), status: payment.status, refundStatus: result.status, detail: result.detail };
}
