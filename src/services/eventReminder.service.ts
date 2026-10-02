import crypto from "crypto";
import { User } from "../models/User";
import { EventReminderDelivery } from "../models/EventReminderDelivery";
import {
  EventReminderEmailInput,
  sendEventReminderEmailBatch,
} from "../helpers/email.helper";
import { CustomError } from "../errors/customError.error";
import { formatRange, listWeeklySessions } from "./weeklySchedule.service";

const ECUADOR_TIMEZONE = "America/Guayaquil";
const BATCH_SIZE = 100;
/** Margen para enviar un recordatorio si el cron llega tarde. */
const SEND_WINDOW_MINUTES = 20;

/** Minutos antes del inicio en que sale cada recordatorio. */
const REMINDER_OFFSETS = [
  { minutes: 60, text: "Falta 1 hora" },
  { minutes: 30, text: "Faltan 30 minutos" },
  { minutes: 10, text: "Faltan 10 minutos" },
  { minutes: 0, text: "La sesión comienza ahora" },
] as const;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
    weekday: WEEKDAYS.indexOf(value("weekday")),
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

type DueReminder = {
  session: Awaited<ReturnType<typeof listWeeklySessions>>[number];
  slot: string;
  reminderText: string;
};

/** Recordatorios que tocan ahora según el horario semanal guardado. */
async function dueReminders(now: Date) {
  const { date, weekday } = ecuadorDateParts(now);
  const sessions = await listWeeklySessions({ activeOnly: true });
  const due: DueReminder[] = [];
  for (const session of sessions) {
    if (!session.reminders || !session.days.includes(weekday)) continue;
    const startsAt = new Date(`${date}T${session.startTime}:00-05:00`).getTime();
    // Solo el aviso más reciente: si el cron llega tarde no salen dos seguidos.
    const offset = [...REMINDER_OFFSETS].reverse().find((item) => {
      const elapsed = now.getTime() - (startsAt - item.minutes * 60_000);
      return elapsed >= 0 && elapsed < SEND_WINDOW_MINUTES * 60_000;
    });
    if (!offset) continue;
    due.push({
      session,
      slot: `${session._id}:${offset.minutes}`,
      reminderText: offset.text,
    });
  }
  return { date, due };
}

export async function sendEventReminders(
  options: { dryRun?: boolean; now?: Date } = {},
) {
  const now = options.now || new Date();
  const { date, due } = await dueReminders(now);
  if (!due.length) return { date, reminders: [], sent: 0 };

  const users = await User.find({ isVerified: true })
    .select("_id name email role subscriptionStatus accessUntil")
    .lean();
  const frontendUrl =
    process.env.FRONTEND_URL || "https://luisapitabejarano.com";

  const results = [];
  for (const { session, slot, reminderText } of due) {
    const recipients = users.map((user) => {
      const canJoin = hasEventAccess(user, now);
      return {
        userId: user._id.toString(),
        userObjectId: user._id,
        recipientKind: canJoin ? ("access" as const) : ("payment" as const),
        email: {
          to: user.email,
          name: user.name,
          eventTitle: session.title,
          eventTime: formatRange(session),
          reminderText,
          canJoin,
          actionUrl: canJoin ? session.meetingUrl : `${frontendUrl}/app/pagos`,
          meetingId: canJoin ? session.meetingId : "",
          passcode: canJoin ? session.passcode : "",
        } satisfies EventReminderEmailInput,
      };
    });

    if (options.dryRun) {
      results.push({
        session: session.title,
        reminderText,
        eligible: recipients.length,
        withAccess: recipients.filter((item) => item.email.canJoin).length,
        sent: 0,
      });
      continue;
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
                eventKey: session.key,
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
    results.push({
      session: session.title,
      reminderText,
      eligible: recipients.length,
      sent,
      duplicatesSkipped: recipients.length - sent,
    });
  }

  return {
    date,
    dryRun: Boolean(options.dryRun),
    reminders: results,
    sent: results.reduce((total, item) => total + item.sent, 0),
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
