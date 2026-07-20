import { Schema, model, Document, Types } from "mongoose";

export interface ILessonProgress extends Document {
  user: Types.ObjectId;
  course: Types.ObjectId;
  lesson: Types.ObjectId;
  watchedSeconds: number;
  lastPositionSeconds: number;
  percent: number;
  completed: boolean;
  manualCompletion: boolean | null;
  completedAt: Date | null;
}

const schema = new Schema<ILessonProgress>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    course: {
      type: Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    lesson: { type: Schema.Types.ObjectId, ref: "Lesson", required: true },
    watchedSeconds: { type: Number, min: 0, default: 0 },
    lastPositionSeconds: { type: Number, min: 0, default: 0 },
    percent: { type: Number, min: 0, max: 100, default: 0 },
    completed: { type: Boolean, default: false },
    manualCompletion: { type: Boolean, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ user: 1, lesson: 1 }, { unique: true });
schema.index({ user: 1, course: 1 });
export const LessonProgress = model<ILessonProgress>("LessonProgress", schema);
