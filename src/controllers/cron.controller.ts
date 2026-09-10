import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import {
  assertCronAuthorization,
  isEventReminderSlot,
  sendEventReminders,
} from "../services/eventReminder.service";
import { sendMissedClassEmail } from "../services/missedClassEmail.service";

export async function eventReminders(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertCronAuthorization(req.header("authorization"));
    const slot = String(req.params.slot);
    if (!isEventReminderSlot(slot)) {
      throw new CustomError("Invalid reminder slot", 400);
    }

    const result = await sendEventReminders(slot, {
      dryRun: req.query.dryRun === "1",
    });
    successResponse(res, result, "Event reminders processed successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Correo puntual: aviso de clase faltante + grabación del primer jueves.
 * Query: dryRun=1 | test=<email> | confirm=1 (envío real), classId, missed, extra (csv).
 */
export async function missedClassEmail(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertCronAuthorization(req.header("authorization"));
    const q = req.query as Record<string, string | undefined>;
    const dryRun = q.dryRun === "1";
    const test = q.test?.trim() || undefined;

    if (!dryRun && !test && q.confirm !== "1") {
      throw new CustomError(
        "Para el envío real agrega confirm=1 (o usa dryRun=1 / test=<email>)",
        400,
      );
    }

    const result = await sendMissedClassEmail({
      dryRun,
      test,
      classId: q.classId?.trim() || undefined,
      missed: q.missed?.trim() || undefined,
      extra: q.extra !== undefined ? q.extra.split(",") : undefined,
    });
    successResponse(res, result, "Missed class email processed");
  } catch (error) {
    next(error);
  }
}
