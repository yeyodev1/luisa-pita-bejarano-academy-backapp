import { Schema, model, Document } from "mongoose";
import {
  ContentStatus,
  contentStatuses,
  IMediaAsset,
  mediaAssetSchema,
} from "./content.shared";

export interface ICalendarEvent extends Document {
  title: string;
  description: string;
  startsAt: Date;
  endsAt: Date | null;
  timezone: string;
  meetingUrl: string;
  status: ContentStatus;
  cover?: IMediaAsset;
}

const schema = new Schema<ICalendarEvent>(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, default: null },
    timezone: { type: String, required: true, default: "UTC", trim: true },
    meetingUrl: { type: String, default: "", trim: true },
    status: {
      type: String,
      enum: contentStatuses,
      default: "draft",
      index: true,
    },
    cover: mediaAssetSchema,
  },
  { timestamps: true },
);

schema.index({ status: 1, startsAt: 1 });
export const CalendarEvent = model<ICalendarEvent>("CalendarEvent", schema);
