import { Request, Response, NextFunction } from "express";
import { handleZoomWebhook } from "../services/zoomRecording.service";

/** Zoom espera el JSON tal cual (sin `{ data, message }`) y en menos de 3 s. */
export async function zoom(req: Request, res: Response, next: NextFunction) {
  try {
    const rawBody = (req as Request & { rawBody?: string }).rawBody ?? "";
    const result = await handleZoomWebhook(req.body, rawBody, {
      timestamp: req.header("x-zm-request-timestamp"),
      signature: req.header("x-zm-signature"),
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}
