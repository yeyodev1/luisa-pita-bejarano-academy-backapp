import { Router } from "express";
import * as cronController from "../controllers/cron.controller";

const router = Router();

router.get("/event-reminders/:slot", cronController.eventReminders);
router.get("/missed-class-email", cronController.missedClassEmail);

export default router;
