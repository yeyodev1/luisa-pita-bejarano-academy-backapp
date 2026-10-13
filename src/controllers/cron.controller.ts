import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import {
  assertCronAuthorization,
  sendEventReminders,
} from "../services/eventReminder.service";
import {
  sendMissedClassEmail,
  missedClassEmailStatus as getMissedClassEmailStatus,
} from "../services/missedClassEmail.service";
import { fillRecordedClassGaps } from "../services/recordedClassGaps.service";
import { createRecordedClass } from "../services/adminAcademy.service";
import { todayClassTitle } from "../services/missedClassEmail.service";
import { RecordedClass } from "../models/RecordedClass";
import { chargeDueSubscriptions } from "../services/nuveiSubscription.service";
import { sendClassLinkAnnouncement } from "../services/classLinkAnnouncement.service";

export async function eventReminders(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertCronAuthorization(req.header("authorization"));
    const result = await sendEventReminders({
      dryRun: req.query.dryRun === "1",
      now: req.query.at ? new Date(String(req.query.at)) : undefined,
    });
    successResponse(res, result, "Event reminders processed successfully");
  } catch (error) {
    next(error);
  }
}

/**
 * Correo puntual: aviso de clase faltante + grabación del primer jueves.
 * Query: dryRun=1 | test=<email> | confirm=1 (envío real), classId, missed, extra (csv),
 * variant=exclusive (la clase de hoy es una exclusiva), publishAsToday=1 (la sube a la biblioteca con fecha de hoy).
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
      variant: q.variant === "exclusive" ? "exclusive" : "missed",
      publishAsToday: q.publishAsToday === "1",
    });
    successResponse(res, result, "Missed class email processed");
  } catch (error) {
    next(error);
  }
}

export async function missedClassEmailStatus(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertCronAuthorization(req.header("authorization"));
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const result = await getMissedClassEmailStatus(limit);
    successResponse(res, result, "Missed class email status");
  } catch (error) {
    next(error);
  }
}

/**
 * Rellena los días de lunes a viernes sin clase grabada con una grabación del mismo día de la semana.
 * Query: dryRun=1 | confirm=1 (escritura real), to=YYYY-MM-DD (por defecto hoy).
 */
export async function recordedClassGaps(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertCronAuthorization(req.header("authorization"));
    const q = req.query as Record<string, string | undefined>;
    const dryRun = q.dryRun === "1";
    if (!dryRun && q.confirm !== "1") {
      throw new CustomError("Para escribir agrega confirm=1 (o usa dryRun=1)", 400);
    }
    const result = await fillRecordedClassGaps({ dryRun, to: q.to?.trim() || undefined });
    successResponse(res, result, "Recorded class gaps processed");
  } catch (error) {
    next(error);
  }
}

/**
 * Publica a mano la grabación de una clase (p. ej. una de Zoom antes de tener el webhook).
 * Query: date=YYYY-MM-DD, url, dryRun=1 | confirm=1, notify=0 (no avisar por correo).
 */
export async function publishRecordedClass(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertCronAuthorization(req.header("authorization"));
    const q = req.query as Record<string, string | undefined>;
    const date = q.date?.trim() ?? "";
    const recordingUrl = q.url?.trim() ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new CustomError("date=YYYY-MM-DD", 400);
    if (!/^https:\/\//.test(recordingUrl)) throw new CustomError("url inválida", 400);
    const dryRun = q.dryRun === "1";
    if (!dryRun && q.confirm !== "1") {
      throw new CustomError("Para escribir agrega confirm=1 (o usa dryRun=1)", 400);
    }

    const sameDay = await RecordedClass.findOne({
      classDate: {
        $gte: new Date(`${date}T00:00:00-05:00`),
        $lte: new Date(`${date}T23:59:59-05:00`),
      },
    }).lean();
    const plan = {
      title: todayClassTitle(date),
      classDate: `${date}T06:00:00-05:00`,
      startsAt: "06:00",
      endsAt: "07:00",
      recordingUrl,
      status: "published",
      notify: q.notify !== "0",
    };
    if (sameDay) {
      successResponse(res, { skipped: "ya hay una clase ese día", existing: sameDay }, "Recorded class not published");
      return;
    }
    if (dryRun) {
      successResponse(res, { dryRun, plan }, "Recorded class preview");
      return;
    }
    const cls = await createRecordedClass(plan);
    successResponse(res, { published: String(cls._id), plan }, "Recorded class published");
  } catch (error) {
    next(error);
  }
}

/** Cobra las suscripciones de Nuvei que vencen hoy. Query: dryRun=1, limit. */
export async function nuveiSubscriptions(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    assertCronAuthorization(req.header("authorization"));
    const result = await chargeDueSubscriptions({
      dryRun: req.query.dryRun === "1",
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    successResponse(res, result, "Nuvei subscriptions processed");
  } catch (error) {
    next(error);
  }
}

/** Aviso puntual: la clase diaria pasa a Zoom. Query: dryRun=1 | test=<email> | confirm=1. */
export async function classLinkAnnouncement(
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
    const result = await sendClassLinkAnnouncement({ dryRun, test });
    successResponse(res, result, "Class link announcement processed");
  } catch (error) {
    next(error);
  }
}
