import { Schema, model, Document, Types } from "mongoose";

export interface IUserAchievement extends Document {
  user: Types.ObjectId;
  achievement: Types.ObjectId;
  awardedAt: Date;
  notes: string;
}

const schema = new Schema<IUserAchievement>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    achievement: {
      type: Schema.Types.ObjectId,
      ref: "Achievement",
      required: true,
    },
    awardedAt: { type: Date, default: Date.now },
    notes: { type: String, default: "", trim: true },
  },
  { timestamps: true },
);

schema.index({ user: 1, achievement: 1 }, { unique: true });
export const UserAchievement = model<IUserAchievement>(
  "UserAchievement",
  schema,
);
