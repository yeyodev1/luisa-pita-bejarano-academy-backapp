import { ClientSession } from "mongoose";
import { IUser } from "../models/User";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

/**
 * Otorga acceso por la duración del plan. `extend` continúa desde el
 * accessUntil vigente en lugar de reiniciar desde hoy (renovación anticipada).
 */
export async function grantPlanAccess(
  user: IUser,
  plan: PaymentPlan,
  options: { session?: ClientSession; extend?: boolean } = {},
) {
  const { months } = PAYMENT_PLANS[plan];
  const now = new Date();
  const base =
    options.extend && user.accessUntil && user.accessUntil > now
      ? user.accessUntil
      : now;

  user.accessUntil = addMonths(base, months);
  user.subscriptionStatus = "active";
  await user.save(options.session ? { session: options.session } : undefined);
  return user;
}
