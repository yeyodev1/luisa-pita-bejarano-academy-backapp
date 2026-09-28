import { Schema, model, Document, Types } from "mongoose";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

export type PaymentGateway = "payphone" | "nuvei";

export interface IPayment extends Document {
  user: Types.ObjectId;
  plan: PaymentPlan;
  amount: number;
  currency: "USD";
  status: "pending" | "approved" | "failed" | "canceled" | "refunded";
  gateway: PaymentGateway;
  payphoneTransactionId: number | null;
  clientTransactionId: string;
  payphoneResponse: unknown;
  nuveiTransactionId: string | null;
  nuveiLinkId: string | null;
  nuveiResponse: unknown;
  /** Datos que Nuvei exige incluir en el correo de confirmación. */
  nuveiAuthorizationCode: string | null;
  nuveiApplicationCode: string | null;
  nuveiStatusDetail: number | null;
  cardBrand: string | null;
  cardLast4: string | null;
  /** link = Link to Pay (pago único); subscription = débito con token. */
  source: "link" | "subscription" | null;
  subscription: Types.ObjectId | null;
  receiptSentAt: Date | null;
  refundedAt: Date | null;
  refundDetail: string | null;
  /** Monto devuelto (puede ser parcial, p. ej. el 30% de la política). */
  refundedAmount: number | null;
  isNewUser: boolean;
  plainPassword: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    plan: { type: String, enum: Object.keys(PAYMENT_PLANS), required: true },
    amount: { type: Number, required: true },
    currency: { type: String, enum: ["USD"], default: "USD" },
    status: {
      type: String,
      enum: ["pending", "approved", "failed", "canceled", "refunded"],
      default: "pending",
    },
    gateway: {
      type: String,
      enum: ["payphone", "nuvei"],
      default: "payphone",
      index: true,
    },
    payphoneTransactionId: { type: Number, default: null },
    clientTransactionId: { type: String, required: true, unique: true },
    payphoneResponse: { type: Schema.Types.Mixed, default: null },
    nuveiTransactionId: { type: String, default: null },
    nuveiLinkId: { type: String, default: null },
    nuveiResponse: { type: Schema.Types.Mixed, default: null },
    nuveiAuthorizationCode: { type: String, default: null },
    nuveiApplicationCode: { type: String, default: null },
    nuveiStatusDetail: { type: Number, default: null },
    cardBrand: { type: String, default: null },
    cardLast4: { type: String, default: null },
    source: { type: String, enum: ["link", "subscription", null], default: null },
    subscription: { type: Schema.Types.ObjectId, ref: "Subscription", default: null, index: true },
    receiptSentAt: { type: Date, default: null },
    refundedAt: { type: Date, default: null },
    refundDetail: { type: String, default: null },
    refundedAmount: { type: Number, default: null },
    isNewUser: { type: Boolean, default: false },
    plainPassword: { type: String, default: null },
  },
  { timestamps: true },
);

export const Payment = model<IPayment>("Payment", paymentSchema);
