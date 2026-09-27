import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import { isPaymentPlan } from "../config/paymentPlans";
import { requireString } from "../helpers/validation.helper";
import { areSubscriptionsEnabled, isNuveiEnabled } from "../config/nuvei";
import * as service from "../services/nuvei.service";
import * as subscriptionService from "../services/nuveiSubscription.service";

function clientIp(req: Request): string | undefined {
  const forwarded = req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.ip || undefined;
  // Nuvei solo acepta IPv4.
  return ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : undefined;
}

function userIdOf(req: AuthRequest): string {
  if (!req.user) throw new CustomError("Unauthorized", 401);
  return req.user.userId;
}

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
 * dentro del servicio, no con el token de sesión. Nuvei espera 200 si se
 * recibió bien y 203 si el stoken no coincide.
 */
export async function webhook(req: Request, res: Response, next: NextFunction) {
  try {
    const { httpStatus, ...result } = await service.handleWebhook(req.body ?? {});
    successResponse(res, result, "Webhook procesado", httpStatus);
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
  successResponse(
    res,
    { enabled: isNuveiEnabled(), subscriptionsEnabled: areSubscriptionsEnabled() },
    "Estado de Nuvei",
  );
}

// ── Suscripciones (alumna autenticada) ────────────────────────────────────────

export async function checkoutConfig(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    successResponse(res, await subscriptionService.getCheckoutConfig(userIdOf(req)), "Configuración obtenida");
  } catch (error) {
    next(error);
  }
}

export async function verifyCard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { transactionId, otp } = req.body ?? {};
    const result = await subscriptionService.verifyCardOtp(
      userIdOf(req),
      requireString(transactionId, "transactionId"),
      requireString(otp, "otp"),
    );
    successResponse(res, result, "Tarjeta verificada");
  } catch (error) {
    next(error);
  }
}

export async function subscribe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { plan, cardToken } = req.body ?? {};
    if (!isPaymentPlan(plan)) throw new CustomError("Plan inválido", 400);
    const result = await subscriptionService.subscribe(
      userIdOf(req),
      plan,
      requireString(cardToken, "cardToken"),
      clientIp(req),
    );
    successResponse(res, result, "Suscripción procesada", 201);
  } catch (error) {
    next(error);
  }
}

export async function updateCard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { cardToken } = req.body ?? {};
    const result = await subscriptionService.updateCard(
      userIdOf(req),
      requireString(cardToken, "cardToken"),
      clientIp(req),
    );
    successResponse(res, result, "Tarjeta actualizada");
  } catch (error) {
    next(error);
  }
}

export async function mySubscription(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    successResponse(res, { subscription: await subscriptionService.getMySubscription(userIdOf(req)) }, "Suscripción obtenida");
  } catch (error) {
    next(error);
  }
}

// ── Admin ─────────────────────────────────────────────────────────────────────

export async function adminListPayments(req: Request, res: Response, next: NextFunction) {
  try {
    const { search, status: paymentStatus } = req.query as Record<string, string | undefined>;
    const payments = await service.listNuveiPayments({ search, status: paymentStatus });
    successResponse(res, { payments }, "Pagos obtenidos");
  } catch (error) {
    next(error);
  }
}

export async function adminRefund(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await service.refundNuveiPayment(requireString(req.params.id, "id"));
    successResponse(res, result, "Reembolso procesado");
  } catch (error) {
    next(error);
  }
}

export async function adminListSubscriptions(req: Request, res: Response, next: NextFunction) {
  try {
    const { status: subStatus } = req.query as Record<string, string | undefined>;
    const subscriptions = await subscriptionService.listSubscriptions({ status: subStatus });
    successResponse(res, { subscriptions }, "Suscripciones obtenidas");
  } catch (error) {
    next(error);
  }
}

export async function adminCancelSubscription(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await subscriptionService.adminCancelSubscription(requireString(req.params.id, "id"));
    successResponse(res, result, "Suscripción cancelada");
  } catch (error) {
    next(error);
  }
}

export async function adminChargeNow(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await subscriptionService.adminChargeNow(requireString(req.params.id, "id"));
    successResponse(res, result, "Cobro procesado");
  } catch (error) {
    next(error);
  }
}
