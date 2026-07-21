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
  },
  { timestamps: true },
);

schema.index({ status: 1, classDate: -1 });

export const RecordedClass = model<IRecordedClass>("RecordedClass", schema);
