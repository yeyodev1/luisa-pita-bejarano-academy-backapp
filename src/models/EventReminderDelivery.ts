import { Schema, model, Document, Types } from "mongoose";

export interface IEventReminderDelivery extends Document {
  deliveryKey: string;
  user: Types.ObjectId;
  eventKey: string;
  eventDate: string;
  reminderSlot: string;
  recipientKind: "access" | "payment";
  claimToken?: string;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<IEventReminderDelivery>(
  {
    deliveryKey: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    eventKey: { type: String, required: true },
    eventDate: { type: String, required: true },
    reminderSlot: { type: String, required: true },
    recipientKind: {
      type: String,
      enum: ["access", "payment"],
      required: true,
    },
    claimToken: { type: String, default: undefined },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true },
);

schema.index({ eventDate: 1, reminderSlot: 1 });
schema.index({ claimToken: 1 }, { sparse: true });

export const EventReminderDelivery = model<IEventReminderDelivery>(
  "EventReminderDelivery",
  schema,
);
