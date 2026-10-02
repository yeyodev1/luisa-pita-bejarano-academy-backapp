import { Schema, model, Document } from "mongoose";

/**
 * Inventario de servicios tecnológicos del negocio (dominio, hosting, correos…):
 * para qué sirve, qué cuenta es la dueña, cuánto cuesta, quién paga y cuándo
 * renueva. NUNCA se guardan contraseñas aquí.
 */
export const billingPeriods = ["mensual", "anual", "gratis", "por uso", ""] as const;
export const techServiceStatuses = ["activo", "pendiente", "cancelado"] as const;

export interface ITechService extends Document {
  name: string;
  category: string;
  provider: string;
  purpose: string;
  url: string;
  accountEmail: string;
  costAmount: number | null;
  currency: string;
  billingPeriod: (typeof billingPeriods)[number];
  paidBy: string;
  renewsAt: Date | null;
  status: (typeof techServiceStatuses)[number];
  notes: string;
  order: number;
}

const text = { type: String, default: "", trim: true };

const schema = new Schema<ITechService>(
  {
    name: { type: String, required: true, trim: true },
    category: text,
    provider: text,
    purpose: text,
    url: text,
    accountEmail: text,
    costAmount: { type: Number, min: 0, default: null },
    currency: { type: String, default: "USD", trim: true },
    billingPeriod: { type: String, enum: billingPeriods, default: "" },
    paidBy: text,
    renewsAt: { type: Date, default: null },
    status: { type: String, enum: techServiceStatuses, default: "activo" },
    notes: text,
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

schema.index({ name: 1 }, { unique: true });

export const TechService = model<ITechService>("TechService", schema);
