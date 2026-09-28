import { Types } from "mongoose";
import { Payment, IPayment } from "../models/Payment";
import { User } from "../models/User";
import { Subscription } from "../models/Subscription";
import { CustomError } from "../errors/customError.error";
import { addMonths, grantPlanAccess } from "../helpers/access.helper";
import {
  sendNuveiReceiptEmail,
  sendPaymentAccessEmail,
  sendPaymentWelcomeEmail,
} from "../helpers/email.helper";
import { sendPurchaseEvent } from "./metaPixel.service";
import { PAYMENT_PLANS } from "../config/paymentPlans";
import { vatIncludedIn } from "../config/nuvei";
import type { NuveiCardInfo, NuveiTransaction } from "./nuveiCard.service";

/**
 * Efectos de negocio de un pago con Nuvei, compartidos por Link to Pay, el
 * webhook y los cobros de suscripción. Todo es idempotente: Nuvei reintenta el
 * webhook y el cron puede correr dos veces.
 */

type TransactionFacts = {
  transaction: NuveiTransaction & { application_code?: string };
  card?: NuveiCardInfo | { type?: string; number?: string };
  applicationCode?: string | null;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Nuvei recomienda validar que el monto coincida con la orden antes de aprobar. */
export function amountMatches(payment: IPayment, amount: unknown): boolean {
  const received = toNumber(amount);
  return received !== null && Math.abs(received - payment.amount) < 0.01;
}

function recordFacts(payment: IPayment, facts: TransactionFacts) {
  const { transaction, card } = facts;
  if (transaction.id) payment.nuveiTransactionId = String(transaction.id);
  if (transaction.authorization_code) payment.nuveiAuthorizationCode = String(transaction.authorization_code);
  const detail = toNumber(transaction.status_detail);
  if (detail !== null) payment.nuveiStatusDetail = detail;
  const appCode = facts.applicationCode ?? transaction.application_code;
  if (appCode) payment.nuveiApplicationCode = appCode;
  if (card?.type) payment.cardBrand = card.type;
  if (card?.number) payment.cardLast4 = String(card.number).slice(-4);
}

/**
 * Marca el pago aprobado y otorga el acceso en una transacción de Mongo.
 * Devuelve true solo la primera vez (para no duplicar correos ni accesos).
 */
export async function approvePayment(
  devReference: string,
  facts: TransactionFacts,
  options: { extendAccess?: boolean } = {},
): Promise<boolean> {
  const session = await Payment.startSession();
  let granted = false;
  try {
    await session.withTransaction(async () => {
      granted = false;
      const payment = await Payment.findOne({ clientTransactionId: devReference, gateway: "nuvei" }).session(session);
      if (!payment) throw new CustomError("Transacción no encontrada", 404);
      if (payment.status === "approved" || payment.status === "refunded") return;

      recordFacts(payment, facts);
      payment.status = "approved";
      payment.nuveiResponse = facts;

      const user = await User.findById(payment.user).session(session);
      if (!user) throw new CustomError("Usuario no encontrado", 404);
      await grantPlanAccess(user, payment.plan, { session, extend: options.extendAccess });
      await payment.save({ session });
      granted = true;
    });
  } finally {
    await session.endSession();
  }
  return granted;
}

/** Guarda un resultado no aprobado (rechazo, pendiente, expiración). */
export async function recordNonApproved(
  devReference: string,
  status: "pending" | "failed" | "canceled",
  facts: TransactionFacts,
) {
  const payment = await Payment.findOne({ clientTransactionId: devReference, gateway: "nuvei" });
  if (!payment || payment.status === "approved" || payment.status === "refunded") return payment;
  recordFacts(payment, facts);
  payment.status = status;
  payment.nuveiResponse = facts;
  await payment.save();
  return payment;
}

/**
 * Quita los meses que dio un pago que luego se anuló o reembolsó. Si el acceso
 * resultante ya venció, la alumna queda sin acceso.
 */
async function revokePaymentAccess(payment: IPayment) {
  const user = await User.findById(payment.user);
  if (!user?.accessUntil) return;
  const reduced = addMonths(user.accessUntil, -PAYMENT_PLANS[payment.plan].months);
  const now = new Date();
  user.accessUntil = reduced > now ? reduced : now;
  if (reduced <= now) user.subscriptionStatus = "canceled";
  await user.save();
}

/**
 * Nuvei avisa por webhook (status 2) cuando una transacción aprobada se anula
 * o reembolsa desde su lado. También lo usa el reembolso hecho desde el admin.
 */
export async function reversePayment(
  payment: IPayment,
  kind: "canceled" | "refunded",
  detail: string | null = null,
  refundedAmount: number | null = null,
) {
  const wasApproved = payment.status === "approved";
  if (payment.status === kind || payment.status === "refunded") return false;
  payment.status = kind;
  if (kind === "refunded") {
    payment.refundedAt = new Date();
    payment.refundDetail = detail;
    payment.refundedAmount = refundedAmount ?? payment.amount;
  }
  await payment.save();
  if (wasApproved) await revokePaymentAccess(payment);
  return wasApproved;
}

/**
 * Comprobante exigido por Nuvei (detalle, transaction_id y authorization_code).
 * receiptSentAt se reclama de forma atómica para no enviarlo dos veces.
 */
export async function sendReceiptOnce(paymentId: Types.ObjectId | string) {
  const payment = await Payment.findOneAndUpdate(
    { _id: paymentId, status: "approved", receiptSentAt: null },
    { $set: { receiptSentAt: new Date() } },
    { new: true },
  );
  if (!payment || !payment.nuveiTransactionId) return;

  const user = await User.findById(payment.user);
  if (!user) return;
  const subscription = payment.subscription ? await Subscription.findById(payment.subscription) : null;

  try {
    await sendNuveiReceiptEmail({
      to: user.email,
      name: user.name,
      plan: payment.plan,
      amount: payment.amount,
      vat: vatIncludedIn(payment.amount),
      transactionId: payment.nuveiTransactionId,
      authorizationCode: payment.nuveiAuthorizationCode,
      paidAt: payment.updatedAt ?? new Date(),
      cardBrand: payment.cardBrand,
      cardLast4: payment.cardLast4,
      accessUntil: user.accessUntil,
      nextChargeAt: subscription && subscription.status !== "canceled" ? subscription.nextChargeAt : null,
    });
  } catch (err) {
    // Se libera para que un reintento del webhook lo vuelva a intentar.
    await Payment.updateOne({ _id: payment._id }, { $set: { receiptSentAt: null } });
    console.error("[Nuvei] Failed to send receipt email:", err);
  }
}

/**
 * Correo de acceso (o bienvenida con contraseña) + evento de compra de Meta.
 * El checkout sin login manda su propio correo de acceso (email: false).
 */
export async function notifyAccessGranted(payment: IPayment, options: { email?: boolean } = {}) {
  const user = await User.findById(payment.user);
  if (!user) return;
  const loginUrl = `${process.env.FRONTEND_URL}/login`;
  if (options.email !== false) {
    try {
      if (payment.plainPassword) {
        await sendPaymentWelcomeEmail(user.email, user.name, payment.plainPassword, loginUrl);
      } else {
        await sendPaymentAccessEmail(user.email, user.name, loginUrl);
      }
    } catch (err) {
      console.error("[Nuvei] Failed to send access email:", err);
    }
  }

  sendPurchaseEvent({
    email: user.email,
    value: payment.amount,
    currency: payment.currency || "USD",
    eventSourceUrl: process.env.FRONTEND_URL,
  }).catch((err) => console.error("[Nuvei] Meta Pixel purchase failed:", err));
}
