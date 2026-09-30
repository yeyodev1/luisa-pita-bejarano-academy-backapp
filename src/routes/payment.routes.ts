import { Router } from "express";
import { authMiddleware } from "../middlewares/auth.middleware";
import { adminMiddleware } from "../middlewares/admin.middleware";
import * as paymentController from "../controllers/payment.controller";
import * as manualPaymentController from "../controllers/manualPayment.controller";
import * as nuveiController from "../controllers/nuvei.controller";

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

// ── Nuvei ─────────────────────────────────────────────────────────────────────
// El webhook es público a propósito: lo llama Nuvei y se valida con el stoken.
router.get("/nuvei/health", nuveiController.health);
router.post("/nuvei/webhook", nuveiController.webhook);
router.get("/nuvei/status/:devReference", nuveiController.status);

// ── Nuvei (Recurrencia: suscripción mensual y tarjetas guardadas) ─────────────
router.get("/nuvei/subscription/config", authMiddleware, nuveiController.checkoutConfig);
router.get("/nuvei/subscription", authMiddleware, nuveiController.mySubscription);
router.get("/nuvei/receipts/:id", authMiddleware, nuveiController.myReceipt);
router.post("/nuvei/subscription", authMiddleware, nuveiController.subscribe);
router.post("/nuvei/card/verify", authMiddleware, nuveiController.verifyCard);
router.post("/nuvei/subscription/verify-otp", authMiddleware, nuveiController.verifyChargeOtp);
router.get("/nuvei/cards", authMiddleware, nuveiController.listCards);
router.post("/nuvei/cards", authMiddleware, nuveiController.saveCard);
router.post("/nuvei/cards/:token/default", authMiddleware, nuveiController.setDefaultCard);
router.delete("/nuvei/cards/:token", authMiddleware, nuveiController.removeCard);

// Checkout sin iniciar sesión: el token de checkout reemplaza a la sesión.
router.post("/nuvei/checkout/start", nuveiController.checkoutStart);
router.post("/nuvei/checkout/card/verify", nuveiController.checkoutVerifyCard);
router.post("/nuvei/checkout/complete", nuveiController.checkoutComplete);
router.post("/nuvei/checkout/charge/verify", nuveiController.checkoutVerifyChargeOtp);
router.post("/nuvei/checkout/resend-access", nuveiController.checkoutResendAccess);
router.post("/nuvei/checkout/status", nuveiController.checkoutStatus);

export default router;
