import { Schema, model, Document } from "mongoose";

export interface IUser extends Document {
  name: string;
  lastName: string;
  email: string;
  password: string;
  profilePicture?: string;
  isVerified: boolean;
  verificationToken: string | null;
  verificationTokenExpires: Date | null;
  resetToken: string | null;
  resetTokenExpires: Date | null;
  role: "user" | "admin";
  subscriptionStatus: "none" | "pending" | "active" | "canceled";
  accessUntil: Date | null;
  foundingMember: boolean;
  /** Token de Nuvei de la tarjeta principal: la que se usa para los cobros. */
  nuveiDefaultCardToken: string | null;
  /** Cuenta creada en el checkout sin contraseña propia: debe crearla por correo. */
  passwordPending: boolean;
  /** Último correo de acceso enviado (para limitar los reenvíos). */
  lastAccessEmailAt: Date | null;
  termsVersion: string | null;
  termsAcceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: { type: String, required: true },
    profilePicture: { type: String, default: null },
    isVerified: { type: Boolean, default: false },
    verificationToken: { type: String, default: null },
    verificationTokenExpires: { type: Date, default: null },
    resetToken: { type: String, default: null },
    resetTokenExpires: { type: Date, default: null },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    subscriptionStatus: {
      type: String,
      enum: ["none", "pending", "active", "canceled"],
      default: "none",
    },
    accessUntil: { type: Date, default: null },
    foundingMember: { type: Boolean, default: false },
    nuveiDefaultCardToken: { type: String, default: null },
    passwordPending: { type: Boolean, default: false },
    lastAccessEmailAt: { type: Date, default: null },
    termsVersion: { type: String, default: null },
    termsAcceptedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const User = model<IUser>("User", userSchema);
