import { Schema, model, Document, Types } from "mongoose";

export interface ILessonComment extends Document {
  lesson: Types.ObjectId;
  user: Types.ObjectId;
  body: string;
  status: "pending" | "published" | "rejected";
  moderatedBy: Types.ObjectId | null;
  moderatedAt: Date | null;
}

const schema = new Schema<ILessonComment>(
  {
    lesson: {
      type: Schema.Types.ObjectId,
      ref: "Lesson",
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    status: {
      type: String,
      enum: ["pending", "published", "rejected"],
      default: "pending",
      index: true,
    },
    moderatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    moderatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ lesson: 1, status: 1, createdAt: -1 });
export const LessonComment = model<ILessonComment>("LessonComment", schema);
