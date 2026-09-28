import { Payment, IPayment } from "../models/Payment";
import { User } from "../models/User";
import { Subscription } from "../models/Subscription";
import { CustomError } from "../errors/customError.error";
import {
  credentialKindForAppCode,
  isApprovedTransaction,
  isNuveiEnabled,
  isValidStoken,
} from "../config/nuvei";
import { refundTransaction } from "./nuveiCard.service";
import { sendRefundEmail } from "../helpers/email.helper";
import {
  amountMatches,
  approvePayment,
  notifyAccessGranted,
  recordNonApproved,
  reversePayment,
  sendReceiptOnce,
} from "./nuveiPayments.service";
import { onSubscriptionPaymentApproved } from "./nuveiSubscription.service";

/**
 * Nuvei LATAM: webhook, estado y reembolsos. Los cobros son solo con tarjeta
 * guardada (ver nuveiSubscription.service); Link to Pay no se usa.
 */

function assertEnabled() {
  if (!isNuveiEnabled()) {
    throw new CustomError(
      "Nuvei aún no está habilitado. Falta la confirmación oficial de activación del comercio.",
      503,
    );
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
    refundedAmount: p.refundedAmount,
    receiptSentAt: p.receiptSentAt,
    createdAt: p.createdAt,
  }));
}

/**
 * Política de reembolso de los Términos (2 primeros días, hasta 30%). Solo es
 * informativa para el admin: la decisión de reembolsar el total es suya.
 */
export const REFUND_WINDOW_HOURS = 48;
export const REFUND_POLICY_PERCENT = 30;

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function refundPolicyFor(payment: IPayment) {
  const sub = payment.subscription ? await Subscription.findById(payment.subscription).select("createdAt") : null;
  const acquiredAt = sub?.createdAt ?? payment.createdAt;
  const deadline = new Date(acquiredAt.getTime() + REFUND_WINDOW_HOURS * 3600 * 1000);
  return {
    acquiredAt,
    deadline,
    withinWindow: Date.now() <= deadline.getTime(),
    policyAmount: round2((payment.amount * REFUND_POLICY_PERCENT) / 100),
  };
}

export async function getRefundPreview(paymentId: string) {
  const payment = await Payment.findOne({ _id: paymentId, gateway: "nuvei" });
  if (!payment) throw new CustomError("Pago no encontrado", 404);
  return { amount: payment.amount, policyPercent: REFUND_POLICY_PERCENT, ...(await refundPolicyFor(payment)) };
}

/**
 * Reembolso desde el admin (requisito bancario de Nuvei). Devuelve el total del
 * pago; el monto parcial queda disponible por API pero la UI no lo usa.
 * Quita el acceso de ese pago, cancela la suscripción y avisa a la alumna.
 */
export async function refundNuveiPayment(paymentId: string, requestedAmount?: number) {
  assertEnabled();
  const payment = await Payment.findOne({ _id: paymentId, gateway: "nuvei" });
  if (!payment) throw new CustomError("Pago no encontrado", 404);
  if (payment.status === "refunded") throw new CustomError("Este pago ya fue reembolsado", 409);
  if (payment.status !== "approved" || !payment.nuveiTransactionId) {
    throw new CustomError("Solo se pueden reembolsar pagos aprobados", 409);
  }

  const policy = await refundPolicyFor(payment);
  const amount = round2(requestedAmount ?? payment.amount);
  if (!(amount > 0) || amount > payment.amount) {
    throw new CustomError(`El monto a devolver debe estar entre 0.01 y ${payment.amount}`, 400);
  }
  const partial = amount < payment.amount;

  const kind =
    credentialKindForAppCode(payment.nuveiApplicationCode) ??
    (payment.source === "subscription" ? "cardServer" : "ltp");

  const result = await refundTransaction(payment.nuveiTransactionId, kind, partial ? amount : undefined);
  if (result.status === "failure") {
    throw new CustomError(
      `Nuvei rechazó el reembolso${partial ? " parcial" : ""}: ${result.detail || "sin detalle"}`,
      409,
    );
  }

  // "pending" = Nuvei espera confirmación del banco; igual se quita el acceso.
  await reversePayment(payment, "refunded", `${result.status}: ${result.detail}`, amount);

  const customer = await User.findById(payment.user);
  if (customer) {
    await sendRefundEmail(customer.email, customer.name, {
      refundedAmount: amount,
      paidAmount: payment.amount,
      transactionId: payment.nuveiTransactionId,
      pending: result.status === "pending",
    }).catch((err) => console.error("[Nuvei] Failed to send refund email:", err));
  }

  if (payment.subscription) {
    await Subscription.updateOne(
      { _id: payment.subscription, status: { $ne: "canceled" } },
      { $set: { status: "canceled", canceledAt: new Date(), cancelReason: "refund" } },
    );
  }

  return {
    id: payment._id.toString(),
    status: payment.status,
    refundedAmount: amount,
    partial,
    withinPolicy: policy.withinWindow,
    refundStatus: result.status,
    detail: result.detail,
  };
}
