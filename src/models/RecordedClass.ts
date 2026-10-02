import { Schema, model, Document } from "mongoose";

export type RecordedClassStatus = "draft" | "published" | "archived";

export interface IRecordedClass extends Document {
  title: string;
  classDate: Date; // fecha real de la clase (Ecuador time stored as UTC)
  startsAt: string; // "06:00" hora local display
  endsAt: string; // "07:00" hora local display
  recordingUrl: string; // obligatorio - Google Drive / Meet / etc
  notesUrl?: string; // opcional - Google Doc
  status: RecordedClassStatus;
  /** Cuándo se avisó por correo a las alumnas; null = aún no. */
  announcedAt: Date | null;
  /** "zoom" = publicada sola por el webhook de grabación de Zoom. */
  source: "manual" | "zoom";
  /** UUID de la reunión de Zoom; evita publicar dos veces la misma grabación. */
  zoomMeetingUuid?: string;
}

const schema = new Schema<IRecordedClass>(
  {
    title: { type: String, required: true, trim: true },
    classDate: { type: Date, required: true, index: true },
    startsAt: { type: String, required: true, trim: true, default: "06:00" },
    endsAt: { type: String, required: true, trim: true, default: "07:00" },
    recordingUrl: { type: String, required: true, trim: true },
    notesUrl: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "published",
      index: true,
    },
    announcedAt: { type: Date, default: null },
    source: { type: String, enum: ["manual", "zoom"], default: "manual" },
    zoomMeetingUuid: { type: String },
  },
  { timestamps: true },
);

schema.index({ status: 1, classDate: -1 });
schema.index({ zoomMeetingUuid: 1 }, { unique: true, sparse: true });

export const RecordedClass = model<IRecordedClass>("RecordedClass", schema);
