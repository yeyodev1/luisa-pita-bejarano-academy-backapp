import { Schema, model, Document } from "mongoose";
import {
  ContentStatus,
  contentStatuses,
  IMediaAsset,
  mediaAssetSchema,
} from "./content.shared";

export interface IAchievement extends Document {
  title: string;
  slug: string;
  description: string;
  status: ContentStatus;
  order: number;
  icon?: IMediaAsset;
}

const schema = new Schema<IAchievement>(
  {
    title: { type: String, required: true, trim: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, default: "" },
    status: {
      type: String,
      enum: contentStatuses,
      default: "draft",
      index: true,
    },
    order: { type: Number, default: 0 },
    icon: mediaAssetSchema,
  },
  { timestamps: true },
);

schema.index({ status: 1, order: 1 });
export const Achievement = model<IAchievement>("Achievement", schema);
