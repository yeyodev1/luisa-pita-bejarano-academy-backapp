import { ClientSession } from "mongoose";
import { IUser } from "../models/User";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

type GrantOptions = {
  session?: ClientSession;
  /**
   * Suma sobre el acceso vigente en vez de reiniciar desde hoy. Solo lo usa la
   * extensión manual del admin: una compra siempre reinicia, para que un plan
   * anual dé exactamente 12 meses (ver createManualPayment).
   */
  extend?: boolean;
};

export async function grantAccessMonths(
  user: IUser,
  months: number,
  options: GrantOptions = {},
) {
  const now = new Date();
  const base =
    options.extend && user.accessUntil && user.accessUntil > now
      ? user.accessUntil
      : now;

  user.accessUntil = addMonths(base, months);
  user.subscriptionStatus = "active";
  await user.save(options.session ? { session: options.session } : undefined);
  return user.accessUntil;
}

/** Otorga el acceso que corresponde a un plan comprado. */
export function grantPlanAccess(
  user: IUser,
  plan: PaymentPlan,
  options: GrantOptions = {},
) {
  return grantAccessMonths(user, PAYMENT_PLANS[plan].months, options);
}
