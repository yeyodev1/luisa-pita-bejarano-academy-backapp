export const PAYMENT_PLANS = {
  monthly: {
    months: 1,
    amount: 47,
    label: "Mensualidad",
    reference: "Acceso por 1 mes - Luisa Pita Bejarano Academy",
  },
  quarterly: {
    months: 3,
    amount: 97,
    label: "Plan de 3 meses",
    reference: "Acceso por 3 meses - Luisa Pita Bejarano Academy",
  },
  semiannual: {
    months: 6,
    amount: 247,
    label: "Plan de 6 meses",
    reference: "Acceso por 6 meses - Luisa Pita Bejarano Academy",
  },
  annual: {
    months: 12,
    amount: 400,
    label: "Anualidad",
    reference: "Acceso por 12 meses - Luisa Pita Bejarano Academy",
  },
} as const;

export type PaymentPlan = keyof typeof PAYMENT_PLANS;

export function isPaymentPlan(value: unknown): value is PaymentPlan {
  return typeof value === "string" && value in PAYMENT_PLANS;
}
