import { Schema, model, Document } from "mongoose";

/**
 * Sesión fija semanal (clase diaria, Cafecito…). La edita el admin desde
 * "Horario semanal"; de aquí salen el calendario de las alumnas, los
 * recordatorios por correo y la reunión de Zoom que se publica sola.
 */
export interface IWeeklySession extends Document {
  key: string;
  title: string;
  /** Días de la semana: 0 = domingo … 6 = sábado. */
  days: number[];
  /** Hora Ecuador, "HH:mm". */
  startTime: string;
  endTime: string;
  meetingUrl: string;
  meetingId: string;
  passcode: string;
  color: string;
  icon: string;
  active: boolean;
  reminders: boolean;
  /** Si es la clase cuyas grabaciones de Zoom se publican solas. */
  isMainClass: boolean;
  order: number;
}

const schema = new Schema<IWeeklySession>(
  {
    key: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true },
    days: { type: [Number], required: true },
    startTime: { type: String, required: true, trim: true },
    endTime: { type: String, required: true, trim: true },
    meetingUrl: { type: String, default: "", trim: true },
    meetingId: { type: String, default: "", trim: true },
    passcode: { type: String, default: "", trim: true },
    color: { type: String, default: "#536d59", trim: true },
    icon: { type: String, default: "fa-video", trim: true },
    active: { type: Boolean, default: true },
    reminders: { type: Boolean, default: true },
    isMainClass: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const WeeklySession = model<IWeeklySession>("WeeklySession", schema);
