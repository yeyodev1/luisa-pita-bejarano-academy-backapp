import { Schema, model, Document } from "mongoose";
import {
  ContentStatus,
  contentStatuses,
  IMediaAsset,
  mediaAssetSchema,
} from "./content.shared";

export interface IRecipe extends Document {
  title: string;
  slug: string;
  summary: string;
  description: string;
  ingredients: string[];
  instructions: string[];
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  status: ContentStatus;
  order: number;
  cover?: IMediaAsset;
  publishedAt: Date | null;
}

const schema = new Schema<IRecipe>(
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
    ingredients: { type: [String], default: [] },
    instructions: { type: [String], default: [] },
    prepMinutes: { type: Number, min: 0, default: 0 },
    cookMinutes: { type: Number, min: 0, default: 0 },
    servings: { type: Number, min: 1, default: 1 },
    status: {
      type: String,
      enum: contentStatuses,
      default: "draft",
      index: true,
    },
    order: { type: Number, default: 0 },
    cover: mediaAssetSchema,
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ status: 1, order: 1 });
export const Recipe = model<IRecipe>("Recipe", schema);
