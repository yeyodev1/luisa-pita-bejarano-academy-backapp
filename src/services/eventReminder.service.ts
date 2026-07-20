import crypto from "crypto";
import { User } from "../models/User";
import { EventReminderDelivery } from "../models/EventReminderDelivery";
import {
  EventReminderEmailInput,
  sendEventReminderEmailBatch,
} from "../helpers/email.helper";
import { CustomError } from "../errors/customError.error";

const ECUADOR_TIMEZONE = "America/Guayaquil";
const MEETING_URL = "https://meet.google.com/tik-vsks-pbc";
const BATCH_SIZE = 100;

const REMINDER_SLOTS = {
  "morning-60": {
    eventKey: "weekday-class",
    eventTitle: "Clase de Luisa Pita Bejarano",
    eventTime: "6:00 a. m. - 7:00 a. m.",
    reminderText: "Falta 1 hora",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  },
  "morning-30": {
    eventKey: "weekday-class",
    eventTitle: "Clase de Luisa Pita Bejarano",
    eventTime: "6:00 a. m. - 7:00 a. m.",
    reminderText: "Faltan 30 minutos",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  },
  "morning-10": {
    eventKey: "weekday-class",
    eventTitle: "Clase de Luisa Pita Bejarano",
    eventTime: "6:00 a. m. - 7:00 a. m.",
    reminderText: "Faltan 10 minutos",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  },
  "morning-now": {
    eventKey: "weekday-class",
    eventTitle: "Clase de Luisa Pita Bejarano",
    eventTime: "6:00 a. m. - 7:00 a. m.",
    reminderText: "La clase comienza ahora",
    weekdays: ["Mon", "Tue", "Wed", "Thu", "Fri"],
  },
  "cafecito-60": {
    eventKey: "monday-cafecito",
    eventTitle: "Cafecito con Luisa Pita Bejarano",
    eventTime: "4:00 p. m. - 5:00 p. m.",
    reminderText: "Falta 1 hora",
    weekdays: ["Mon"],
  },
  "cafecito-30": {
    eventKey: "monday-cafecito",
    eventTitle: "Cafecito con Luisa Pita Bejarano",
    eventTime: "4:00 p. m. - 5:00 p. m.",
    reminderText: "Faltan 30 minutos",
    weekdays: ["Mon"],
  },
  "cafecito-10": {
    eventKey: "monday-cafecito",
    eventTitle: "Cafecito con Luisa Pita Bejarano",
    eventTime: "4:00 p. m. - 5:00 p. m.",
    reminderText: "Faltan 10 minutos",
    weekdays: ["Mon"],
  },
  "cafecito-now": {
    eventKey: "monday-cafecito",
    eventTitle: "Cafecito con Luisa Pita Bejarano",
    eventTime: "4:00 p. m. - 5:00 p. m.",
    reminderText: "El Cafecito comienza ahora",
    weekdays: ["Mon"],
  },
} as const;

export type EventReminderSlot = keyof typeof REMINDER_SLOTS;

export function isEventReminderSlot(value: string): value is EventReminderSlot {
  return value in REMINDER_SLOTS;
}

function ecuadorDateParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECUADOR_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    weekday: value("weekday"),
  };
}

function hasEventAccess(
  user: {
    role: "user" | "admin";
    subscriptionStatus: "none" | "pending" | "active" | "canceled";
    accessUntil: Date | null;
  },
  now: Date,
) {
  if (user.role === "admin") return true;
  if (user.subscriptionStatus !== "active") return false;
  return !user.accessUntil || user.accessUntil.getTime() > now.getTime();
}

export async function sendEventReminders(
  slot: EventReminderSlot,
  options: { dryRun?: boolean; now?: Date } = {},
) {
  const schedule = REMINDER_SLOTS[slot];
  const now = options.now || new Date();
  const { date, weekday } = ecuadorDateParts(now);

  if (!schedule.weekdays.includes(weekday as never)) {
    return { slot, date, sent: 0, eligible: 0, skipped: "no-event-today" };
  }

  const users = await User.find({ isVerified: true })
    .select("_id name email role subscriptionStatus accessUntil")
    .lean();
  const frontendUrl =
    process.env.FRONTEND_URL || "https://luisapitabejarano.com";
  const recipients = users.map((user) => {
    const canJoin = hasEventAccess(user, now);
    return {
      userId: user._id.toString(),
      userObjectId: user._id,
      recipientKind: canJoin ? ("access" as const) : ("payment" as const),
      email: {
        to: user.email,
        name: user.name,
        eventTitle: schedule.eventTitle,
        eventTime: schedule.eventTime,
        reminderText: schedule.reminderText,
        canJoin,
        actionUrl: canJoin ? MEETING_URL : `${frontendUrl}/app/pagos`,
      } satisfies EventReminderEmailInput,
    };
  });

  if (options.dryRun) {
    return {
      slot,
      date,
      eligible: recipients.length,
      withAccess: recipients.filter((item) => item.email.canJoin).length,
      invitedToPay: recipients.filter((item) => !item.email.canJoin).length,
      sent: 0,
      dryRun: true,
    };
  }

  let sent = 0;
  for (let offset = 0; offset < recipients.length; offset += BATCH_SIZE) {
    const batch = recipients.slice(offset, offset + BATCH_SIZE);
    const claimToken = crypto.randomUUID();

    await EventReminderDelivery.bulkWrite(
      batch.map((recipient) => ({
        updateOne: {
          filter: {
            deliveryKey: `${date}:${slot}:${recipient.userId}`,
          },
          update: {
            $setOnInsert: {
              deliveryKey: `${date}:${slot}:${recipient.userId}`,
              user: recipient.userObjectId,
              eventKey: schedule.eventKey,
              eventDate: date,
              reminderSlot: slot,
              recipientKind: recipient.recipientKind,
              claimToken,
            },
          },
          upsert: true,
        },
      })),
      { ordered: false },
    );

    const claimed = await EventReminderDelivery.find({ claimToken })
      .select("user")
      .lean();
    const claimedIds = new Set(
      claimed.map((delivery) => delivery.user.toString()),
    );
    const claimedRecipients = batch.filter((recipient) =>
      claimedIds.has(recipient.userId),
    );
    if (!claimedRecipients.length) continue;

    try {
      await sendEventReminderEmailBatch(
        claimedRecipients.map((recipient) => recipient.email),
      );
      await EventReminderDelivery.updateMany(
        { claimToken },
        { $set: { sentAt: new Date() }, $unset: { claimToken: 1 } },
      );
      sent += claimedRecipients.length;
    } catch (error) {
      await EventReminderDelivery.deleteMany({ claimToken });
      throw error;
    }
  }

  return {
    slot,
    date,
    eligible: recipients.length,
    sent,
    duplicatesSkipped: recipients.length - sent,
  };
}

export function assertCronAuthorization(authorization?: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new CustomError("Missing cron configuration", 500);
  const expected = `Bearer ${secret}`;
  if (!authorization || authorization.length !== expected.length) {
    throw new CustomError("Unauthorized", 401);
  }
  if (
    !crypto.timingSafeEqual(Buffer.from(authorization), Buffer.from(expected))
  ) {
    throw new CustomError("Unauthorized", 401);
  }
}
