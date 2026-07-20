import { Schema, model, Document, Types } from "mongoose";
import {
  ContentStatus,
  contentStatuses,
  IMediaAsset,
  mediaAssetSchema,
} from "./content.shared";

export interface ILesson extends Document {
  course: Types.ObjectId;
  title: string;
  slug: string;
  summary: string;
  content: string;
  status: ContentStatus;
  order: number;
  durationSeconds: number;
  video?: IMediaAsset;
  thumbnail?: IMediaAsset;
  materials: Array<IMediaAsset & { title: string }>;
  publishedAt: Date | null;
}

const materialSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    publicId: { type: String, required: true, trim: true },
    resourceType: {
      type: String,
      enum: ["image", "video", "raw"],
      required: true,
    },
    format: String,
    bytes: Number,
    width: Number,
    height: Number,
    duration: Number,
    originalFilename: String,
  },
  { _id: false },
);
const schema = new Schema<ILesson>(
  {
    course: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    summary: { type: String, default: "", trim: true },
    content: { type: String, default: "" },
    status: {
      type: String,
      enum: contentStatuses,
      default: "draft",
      index: true,
    },
    order: { type: Number, default: 0 },
    durationSeconds: { type: Number, min: 0, default: 0 },
    video: mediaAssetSchema,
    thumbnail: mediaAssetSchema,
    materials: { type: [materialSchema], default: [] },
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ course: 1, slug: 1 }, { unique: true });
schema.index({ course: 1, status: 1, order: 1 });
export const Lesson = model<ILesson>("Lesson", schema);
