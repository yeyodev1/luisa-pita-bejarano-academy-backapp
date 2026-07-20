import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as paymentController from "../controllers/payment.controller";
import * as manualPaymentController from "../controllers/manualPayment.controller";

const router = Router();

router.post("/prepare", paymentController.prepare);
router.post("/prepare-monthly", paymentController.prepareMonthly);
router.post("/prepare-plan", paymentController.preparePlan);
router.post("/prepare-box", paymentController.prepareBox);
router.get("/history", authMiddleware, manualPaymentController.history);
router.get("/confirm", paymentController.confirm);
router.post(
  "/resend-welcome",
  authMiddleware,
  adminMiddleware,
  paymentController.resendWelcomeEmail,
);
router.post("/resend-welcome-public", paymentController.resendWelcomePublic);
router.post("/cancel-pending", authMiddleware, paymentController.cancelPending);
router.post("/cancel-subscription", authMiddleware, paymentController.cancelSubscription);

export default router;
