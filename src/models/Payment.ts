import { Schema, model, Document, Types } from "mongoose";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

export type PaymentGateway = "payphone" | "nuvei";

export interface IPayment extends Document {
  user: Types.ObjectId;
  plan: PaymentPlan;
  amount: number;
  currency: "USD";
  status: "pending" | "approved" | "failed" | "canceled";
  gateway: PaymentGateway;
  payphoneTransactionId: number | null;
  clientTransactionId: string;
  payphoneResponse: unknown;
  nuveiTransactionId: string | null;
  nuveiLinkId: string | null;
  nuveiResponse: unknown;
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
      enum: ["pending", "approved", "failed", "canceled"],
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
    isNewUser: { type: Boolean, default: false },
    plainPassword: { type: String, default: null },
  },
  { timestamps: true },
);

export const Payment = model<IPayment>("Payment", paymentSchema);
