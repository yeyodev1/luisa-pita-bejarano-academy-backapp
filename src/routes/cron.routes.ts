import { Router } from "express";
import * as cronController from "../controllers/cron.controller";

const router = Router();

router.get("/event-reminders", cronController.eventReminders);
router.get("/missed-class-email", cronController.missedClassEmail);
router.get("/missed-class-email/status", cronController.missedClassEmailStatus);
router.get("/recorded-class-gaps", cronController.recordedClassGaps);
router.get("/class-link-announcement", cronController.classLinkAnnouncement);
router.get("/nuvei-subscriptions", cronController.nuveiSubscriptions);

export default router;
