import "dotenv/config";
import { dbConnect } from "../config/mongo";
import { Payment } from "../models/Payment";
import { ManualPayment } from "../models/ManualPayment";
import { User } from "../models/User";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Uso: pnpm ts-node src/scripts/fix-access.ts <email>");
    process.exit(1);
  }

  await dbConnect();

  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    console.error("Usuario no encontrado:", email);
    process.exit(1);
  }

  const [latestPayphone, latestManual] = await Promise.all([
    Payment.findOne({ user: user._id, status: "approved" })
      .sort({ updatedAt: -1 })
      .lean(),
    ManualPayment.findOne({ user: user._id, status: "approved" })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  type PaymentLike = { plan: PaymentPlan; date: Date };

  const candidates: PaymentLike[] = [];
  if (latestPayphone) {
    candidates.push({
      plan: latestPayphone.plan,
      date: new Date(latestPayphone.updatedAt),
    });
  }
  if (latestManual) {
    candidates.push({
      plan: latestManual.plan,
      date: new Date(latestManual.createdAt),
    });
  }

  if (candidates.length === 0) {
    console.error("No hay pagos aprobados para este usuario.");
    process.exit(1);
  }

  candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
  const latest = candidates[0];

  const newAccessUntil = addMonths(latest.date, PAYMENT_PLANS[latest.plan].months);

  console.log("Usuario:", user.email);
  console.log("Plan usado:", latest.plan);
  console.log("Fecha del último pago:", latest.date.toISOString());
  console.log("accessUntil anterior:", user.accessUntil?.toISOString() ?? "null");
  console.log("accessUntil nuevo:", newAccessUntil.toISOString());

  user.accessUntil = newAccessUntil;
  await user.save();

  console.log("✅ Acceso corregido.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
