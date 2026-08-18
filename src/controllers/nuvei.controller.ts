import { Request, Response, NextFunction } from "express";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import { isPaymentPlan } from "../config/paymentPlans";
import { requireString } from "../helpers/validation.helper";
import { isNuveiEnabled } from "../config/nuvei";
import * as service from "../services/nuvei.service";

export async function createLink(req: Request, res: Response, next: NextFunction) {
  try {
    const { plan, email, name, lastName, origin } = req.body ?? {};
    if (!isPaymentPlan(plan)) throw new CustomError("Plan inválido", 400);

    const result = await service.createPaymentLink(
      plan,
      {
        email: requireString(email, "email"),
        name: requireString(name, "name"),
        lastName: requireString(lastName ?? name, "lastName"),
      },
      typeof origin === "string" ? origin : undefined,
    );
    successResponse(res, result, "Link de pago generado", 201);
  } catch (error) {
    next(error);
  }
}

/**
 * Endpoint público que consume Nuvei. La autenticidad se valida con el stoken
 * dentro del servicio, no con el token de sesión.
 */
export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.handleWebhook(req.body ?? {});
    successResponse(res, result, "Webhook procesado");
  } catch (error) {
    next(error);
  }
}

export async function status(req: Request, res: Response, next: NextFunction) {
  try {
    const devReference = requireString(req.params.devReference, "devReference");
    successResponse(res, await service.getPaymentStatus(devReference), "Estado obtenido");
  } catch (error) {
    next(error);
  }
}

export function health(_req: Request, res: Response) {
  successResponse(res, { enabled: isNuveiEnabled() }, "Estado de Nuvei");
}
