import { Router } from "express";
import * as webhookController from "../controllers/webhook.controller";

// Sin authMiddleware: cada proveedor se valida con su propia firma.
const router = Router();

router.post("/zoom", webhookController.zoom);

export default router;
