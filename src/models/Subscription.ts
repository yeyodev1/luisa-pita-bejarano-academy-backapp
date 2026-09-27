import { Schema, model, Document, Types } from "mongoose";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

/**
 * Cobro recurrente con Nuvei (Add Card + débito con token). El token de la
 * tarjeta lo emite Nuvei; nunca guardamos el número ni el CVV.
 *
 * active    → se cobra en nextChargeAt.
 * past_due  → falló el último cobro; se reintenta hasta MAX_FAILED_ATTEMPTS.
 * canceled  → no se cobra más (la canceló la alumna, el admin o los reintentos).
 */
export type SubscriptionStatus = "active" | "past_due" | "canceled";

export interface ISubscription extends Document {
  user: Types.ObjectId;
  plan: PaymentPlan;
  amount: number;
  status: SubscriptionStatus;
  cardToken: string;
  cardBrand: string | null;
  cardLast4: string | null;
  cardBin: string | null;
  nextChargeAt: Date;
  lastChargeAt: Date | null;
  failedAttempts: number;
  lastError: string | null;
  /** Candado para que dos crons no cobren la misma suscripción a la vez. */
  chargingAt: Date | null;
  canceledAt: Date | null;
  cancelReason: string | null;
  /** Evidencia de aceptación de los Términos (incluye la política de reembolso). */
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  termsAcceptedIp: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const subscriptionSchema = new Schema<ISubscription>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    plan: { type: String, enum: Object.keys(PAYMENT_PLANS), required: true },
    amount: { type: Number, required: true },
    status: {
      type: String,
      enum: ["active", "past_due", "canceled"],
      default: "active",
      index: true,
    },
    cardToken: { type: String, required: true },
    cardBrand: { type: String, default: null },
    cardLast4: { type: String, default: null },
    cardBin: { type: String, default: null },
    nextChargeAt: { type: Date, required: true, index: true },
    lastChargeAt: { type: Date, default: null },
    failedAttempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    chargingAt: { type: Date, default: null },
    canceledAt: { type: Date, default: null },
    cancelReason: { type: String, default: null },
    // Obligatorios al crear (lo valida subscribe); opcionales para registros previos.
    termsVersion: { type: String, default: null },
    termsAcceptedAt: { type: Date, default: null },
    termsAcceptedIp: { type: String, default: null },
  },
  { timestamps: true },
);

export const Subscription = model<ISubscription>("Subscription", subscriptionSchema);
