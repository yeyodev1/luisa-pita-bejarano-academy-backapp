import { Schema, model, Document, Types } from "mongoose";

/**
 * Solicitudes del equipo del cliente al equipo técnico (cambios, ideas,
 * problemas) con notas de implementación. Reemplaza la cadena de mensajes
 * cliente → Luisa → Diego.
 */
export const requestStatuses = ["nueva", "en_progreso", "hecha", "descartada"] as const;
export const requestPriorities = ["normal", "urgente"] as const;

export interface IRequestNote {
  authorName: string;
  body: string;
  createdAt: Date;
}

export interface IAdminRequest extends Document {
  title: string;
  description: string;
  priority: (typeof requestPriorities)[number];
  status: (typeof requestStatuses)[number];
  createdBy: Types.ObjectId;
  createdByName: string;
  notes: IRequestNote[];
  completedAt: Date | null;
}

const schema = new Schema<IAdminRequest>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },
    priority: { type: String, enum: requestPriorities, default: "normal" },
    status: {
      type: String,
      enum: requestStatuses,
      default: "nueva",
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    createdByName: { type: String, default: "", trim: true },
    notes: {
      type: [
        {
          _id: false,
          authorName: { type: String, default: "", trim: true },
          body: { type: String, required: true, trim: true },
          createdAt: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const AdminRequest = model<IAdminRequest>("AdminRequest", schema);
