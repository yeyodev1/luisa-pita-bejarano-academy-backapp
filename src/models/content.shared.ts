import { Schema } from "mongoose";

export interface IMediaAsset {
  publicId: string;
  resourceType: "image" | "video" | "raw";
  provider?: "cloudinary" | "bunny";
  format?: string;
  bytes?: number;
  width?: number;
  height?: number;
  duration?: number;
  originalFilename?: string;
}

export const mediaAssetSchema = new Schema<IMediaAsset>(
  {
    publicId: { type: String, required: true, trim: true },
    resourceType: {
      type: String,
      enum: ["image", "video", "raw"],
      required: true,
    },
    provider: { type: String, enum: ["cloudinary", "bunny"] },
    format: String,
    bytes: Number,
    width: Number,
    height: Number,
    duration: Number,
    originalFilename: String,
  },
  { _id: false },
);

export const contentStatuses = ["draft", "published", "archived"] as const;
export type ContentStatus = (typeof contentStatuses)[number];
