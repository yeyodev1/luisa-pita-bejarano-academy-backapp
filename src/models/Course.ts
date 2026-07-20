import { Schema, model, Document } from "mongoose";
import {
  ContentStatus,
  contentStatuses,
  IMediaAsset,
  mediaAssetSchema,
} from "./content.shared";

export interface ICourse extends Document {
  title: string;
  slug: string;
  summary: string;
  description: string;
  status: ContentStatus;
  order: number;
  cover?: IMediaAsset;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<ICourse>(
  {
    title: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    summary: { type: String, default: "", trim: true },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: contentStatuses,
      default: "draft",
      index: true,
    },
    order: { type: Number, default: 0, index: true },
    cover: mediaAssetSchema,
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ status: 1, order: 1 });
export const Course = model<ICourse>("Course", schema);
