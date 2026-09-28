import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import { requireString } from "../helpers/validation.helper";
import { areSubscriptionsEnabled, isNuveiEnabled } from "../config/nuvei";
import * as service from "../services/nuvei.service";
import * as subscriptionService from "../services/nuveiSubscription.service";
import * as checkoutService from "../services/nuveiCheckout.service";

function clientIp(req: Request): string | undefined {
  const forwarded = req.header("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || req.ip || undefined;
  // Nuvei solo acepta IPv4.
  return ip && /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) ? ip : undefined;
}

/** Versión de los Términos aceptada; undefined si no marcó la casilla. */
function acceptedTermsVersion(body: unknown): string | undefined {
  const { acceptTerms, termsVersion } = (body ?? {}) as { acceptTerms?: unknown; termsVersion?: unknown };
  if (acceptTerms !== true || typeof termsVersion !== "string" || !termsVersion.trim()) return undefined;
  return termsVersion.trim().slice(0, 40);
}

function userIdOf(req: AuthRequest): string {
  if (!req.user) throw new CustomError("Unauthorized", 401);
  return req.user.userId;
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

/** Suscripción mensual. cardToken es opcional: por defecto usa la tarjeta principal. */
export async function subscribe(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { cardToken } = req.body ?? {};
    const result = await subscriptionService.subscribe(
      userIdOf(req),
      typeof cardToken === "string" && cardToken.trim() ? cardToken.trim() : undefined,
      clientIp(req),
      { termsVersion: acceptedTermsVersion(req.body) },
    );
    successResponse(res, result, "Suscripción procesada", 201);
  } catch (error) {
    next(error);
  }
}

export async function listCards(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    successResponse(res, { cards: await subscriptionService.listMyCards(userIdOf(req)) }, "Tarjetas obtenidas");
  } catch (error) {
    next(error);
  }
}

export async function saveCard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { cardToken, makeDefault } = req.body ?? {};
    const result = await subscriptionService.saveCard(
      userIdOf(req),
      requireString(cardToken, "cardToken"),
      makeDefault === true,
      clientIp(req),
    );
    successResponse(res, result, "Tarjeta guardada", 201);
  } catch (error) {
    next(error);
  }
}

export async function setDefaultCard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await subscriptionService.setDefaultCard(
      userIdOf(req),
      requireString(req.params.token, "token"),
      clientIp(req),
    );
    successResponse(res, result, "Tarjeta principal actualizada");
  } catch (error) {
    next(error);
  }
}

export async function removeCard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const result = await subscriptionService.removeCard(userIdOf(req), requireString(req.params.token, "token"));
    successResponse(res, result, "Tarjeta eliminada");
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

// ── Checkout sin iniciar sesión ───────────────────────────────────────────────

export async function checkoutStart(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, lastName, email } = req.body ?? {};
    const result = await checkoutService.startCheckout({
      name: requireString(name, "name"),
      lastName: typeof lastName === "string" ? lastName : "",
      email: requireString(email, "email"),
    });
    successResponse(res, result, "Checkout iniciado", 201);
  } catch (error) {
    next(error);
  }
}

export async function checkoutVerifyCard(req: Request, res: Response, next: NextFunction) {
  try {
    const { checkoutToken, transactionId, otp } = req.body ?? {};
    const result = await checkoutService.verifyCheckoutCard(
      requireString(checkoutToken, "checkoutToken"),
      requireString(transactionId, "transactionId"),
      requireString(otp, "otp"),
    );
    successResponse(res, result, "Tarjeta verificada");
  } catch (error) {
    next(error);
  }
}

export async function checkoutComplete(req: Request, res: Response, next: NextFunction) {
  try {
    const { checkoutToken, cardToken } = req.body ?? {};
    const result = await checkoutService.completeCheckout(
      requireString(checkoutToken, "checkoutToken"),
      requireString(cardToken, "cardToken"),
      acceptedTermsVersion(req.body),
      clientIp(req),
    );
    successResponse(res, result, "Suscripción procesada", 201);
  } catch (error) {
    next(error);
  }
}

export async function checkoutVerifyChargeOtp(req: Request, res: Response, next: NextFunction) {
  try {
    const { checkoutToken, paymentId, otp } = req.body ?? {};
    const result = await checkoutService.verifyCheckoutChargeOtp(
      requireString(checkoutToken, "checkoutToken"),
      requireString(paymentId, "paymentId"),
      requireString(otp, "otp"),
    );
    successResponse(res, result, "Pago verificado");
  } catch (error) {
    next(error);
  }
}

export async function verifyChargeOtp(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { paymentId, otp } = req.body ?? {};
    const charge = await subscriptionService.verifyChargeOtp(
      userIdOf(req),
      requireString(paymentId, "paymentId"),
      requireString(otp, "otp"),
    );
    successResponse(res, { charge, subscription: await subscriptionService.getMySubscription(userIdOf(req)) }, "Pago verificado");
  } catch (error) {
    next(error);
  }
}

export async function checkoutResendAccess(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await checkoutService.resendAccessEmail(requireString(req.body?.email, "email"));
    successResponse(res, result, "Si el correo tiene una suscripción activa, te reenviamos el acceso");
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
    const raw = req.body?.amount;
    const amount = raw === undefined || raw === null || raw === "" ? undefined : Number(raw);
    if (amount !== undefined && !Number.isFinite(amount)) throw new CustomError("Monto inválido", 400);
    const result = await service.refundNuveiPayment(requireString(req.params.id, "id"), amount);
    successResponse(res, result, "Reembolso procesado");
  } catch (error) {
    next(error);
  }
}

export async function adminResendReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    successResponse(res, await service.resendReceipt(requireString(req.params.id, "id")), "Comprobante enviado");
  } catch (error) {
    next(error);
  }
}

export async function adminResendRefundEmail(req: Request, res: Response, next: NextFunction) {
  try {
    successResponse(res, await service.resendRefundEmail(requireString(req.params.id, "id")), "Correo de reembolso enviado");
  } catch (error) {
    next(error);
  }
}

export async function adminRefundPreview(req: Request, res: Response, next: NextFunction) {
  try {
    successResponse(res, await service.getRefundPreview(requireString(req.params.id, "id")), "Política de reembolso");
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
