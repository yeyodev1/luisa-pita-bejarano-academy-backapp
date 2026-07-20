import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import {
  assertCronAuthorization,
  isEventReminderSlot,
  sendEventReminders,
} from "../services/eventReminder.service";

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
