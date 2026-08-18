import axios, { AxiosError } from "axios";
import crypto from "crypto";
import { Payment } from "../models/Payment";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { hashPassword } from "../helpers/password.helper";
import { grantPlanAccess } from "../helpers/access.helper";
import {
  sendPaymentAccessEmail,
  sendPaymentWelcomeEmail,
} from "../helpers/email.helper";
import { sendPurchaseEvent } from "./metaPixel.service";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";
import {
  NUVEI_MAX_AMOUNT,
  buildAuthToken,
  buildStoken,
  isNuveiEnabled,
  nuveiBaseUrl,
  nuveiEnvironment,
  vatIncludedIn,
} from "../config/nuvei";

type GuestData = { email: string; name: string; lastName: string };

/**
 * Nuvei permite diferidos; el código exacto depende de la configuración del
 * comercio en Datafast. Este comercio tiene corriente + diferido con intereses
 * a 3 meses. 0 = permitir cuotas, -1 = solo corriente.
 */
function installmentsType(): number {
  const raw = Number(process.env.NUVEI_INSTALLMENTS_TYPE);
  return Number.isFinite(raw) ? raw : 0;
}

function assertEnabled() {
  if (!isNuveiEnabled()) {
    throw new CustomError(
      "Nuvei aún no está habilitado. Falta la confirmación oficial de activación del comercio.",
      503,
    );
  }
}

async function findOrCreateGuestUser(input: GuestData) {
  const normalizedEmail = input.email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) return { user: existing, isNew: false, plainPassword: null };

  const plainPassword = crypto.randomBytes(8).toString("hex");
  const user = await User.create({
    name: input.name.trim(),
    lastName: input.lastName.trim(),
    email: normalizedEmail,
    password: await hashPassword(plainPassword),
    isVerified: true,
    verificationToken: null,
    verificationTokenExpires: null,
    subscriptionStatus: "none",
    accessUntil: null,
  });
  return { user, isNew: true, plainPassword };
}

function frontendUrl(origin?: string): string {
  return origin || process.env.FRONTEND_URL || "";
}

/**
 * Crea el link de pago y el registro `pending`. El registro se crea ANTES de
 * redirigir para que el webhook siempre encuentre a qué transacción aplicar.
 */
export async function createPaymentLink(
  plan: PaymentPlan,
  guestData: GuestData,
  origin?: string,
) {
  assertEnabled();

  const { amount, reference } = PAYMENT_PLANS[plan];
  if (amount > NUVEI_MAX_AMOUNT) {
    throw new CustomError(
      `El plan excede el límite de $${NUVEI_MAX_AMOUNT} autorizado por Nuvei`,
      400,
    );
  }

  const { user, isNew, plainPassword } = await findOrCreateGuestUser(guestData);
  const userId = user._id.toString();
  const env = nuveiEnvironment();
  const devReference = `nuvei-${env}-${userId}-${Date.now()}`;
  const base = frontendUrl(origin);

  const payload = {
    user: {
      id: userId,
      email: user.email,
      name: user.name,
      last_name: user.lastName || user.name,
    },
    order: {
      dev_reference: devReference,
      description: reference,
      amount,
      vat: vatIncludedIn(amount),
      installments_type: installmentsType(),
      currency: "USD",
    },
    configuration: {
      partial_payment: false,
      expiration_days: 1,
      allowed_payment_methods: ["All"],
      success_url: `${base}/pago/nuvei?ref=${devReference}&status=success`,
      failure_url: `${base}/pago/nuvei?ref=${devReference}&status=failure`,
      pending_url: `${base}/pago/nuvei?ref=${devReference}&status=pending`,
      review_url: `${base}/pago/nuvei?ref=${devReference}&status=review`,
    },
  };

  await Payment.create({
    user: userId,
    plan,
    amount,
    currency: "USD",
    gateway: "nuvei",
    clientTransactionId: devReference,
    isNewUser: isNew,
    plainPassword,
  });

  try {
    const response = await axios.post(
      `${nuveiBaseUrl()}/linktopay/init_order/`,
      payload,
      { headers: { "Auth-Token": buildAuthToken(), "Content-Type": "application/json" } },
    );

    const data = response.data as {
      payment?: { payment_url?: string; payment_qr?: string; id?: string };
    };
    const paymentUrl = data.payment?.payment_url;
    if (!paymentUrl) {
      throw new CustomError("Nuvei no devolvió un link de pago", 502);
    }

    await Payment.updateOne(
      { clientTransactionId: devReference },
      { $set: { nuveiLinkId: data.payment?.id ?? null, nuveiResponse: data } },
    );

    return {
      paymentUrl,
      paymentQr: data.payment?.payment_qr,
      devReference,
      amount,
      isNewUser: isNew,
    };
  } catch (error) {
    await Payment.updateOne(
      { clientTransactionId: devReference },
      { $set: { status: "failed" } },
    );
    if (error instanceof CustomError) throw error;
    const axiosError = error as AxiosError;
    console.error("[Nuvei] init_order failed:", axiosError.response?.data ?? axiosError.message);
    throw new CustomError("No se pudo generar el link de pago", 502);
  }
}

type NuveiWebhookBody = {
  transaction?: {
    id?: string;
    status?: string;
    status_detail?: string | number;
    dev_reference?: string;
    stoken?: string;
    amount?: string | number;
    authorization_code?: string;
    message?: string;
  };
  user?: { id?: string; email?: string };
};

/** status: 0 pendiente · 1 aprobada · 2 cancelada · 4 rechazada · 5 expirada */
function mapStatus(status?: string): "pending" | "approved" | "canceled" | "failed" {
  switch (String(status)) {
    case "1":
      return "approved";
    case "0":
      return "pending";
    case "2":
      return "canceled";
    default:
      return "failed";
  }
}

/**
 * Confirmación servidor-a-servidor. Es la fuente de verdad: el retorno del
 * navegador solo consulta el estado ya persistido aquí.
 */
export async function handleWebhook(body: NuveiWebhookBody) {
  const transaction = body.transaction;
  const devReference = transaction?.dev_reference;
  const transactionId = transaction?.id;
  const userId = body.user?.id;

  if (!devReference || !transactionId || !userId) {
    throw new CustomError("Webhook inválido", 400);
  }

  const expectedStoken = buildStoken(transactionId, userId);
  const receivedStoken = String(transaction?.stoken ?? "");
  const expectedBuffer = Buffer.from(expectedStoken);
  const receivedBuffer = Buffer.from(receivedStoken);
  const stokenOk =
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
  if (!stokenOk) {
    throw new CustomError("Firma del webhook inválida", 401);
  }

  const status = mapStatus(transaction?.status);

  const session = await Payment.startSession();
  let accessGranted = false;
  try {
    await session.withTransaction(async () => {
      accessGranted = false;
      const payment = await Payment.findOne({
        clientTransactionId: devReference,
        gateway: "nuvei",
      }).session(session);
      if (!payment) throw new CustomError("Transacción no encontrada", 404);

      // Idempotencia: Nuvei reintenta el webhook hasta recibir 200.
      if (payment.status === "approved") return;

      payment.status = status;
      payment.nuveiTransactionId = transactionId;
      payment.nuveiResponse = body;

      if (status === "approved") {
        const user = await User.findById(payment.user).session(session);
        if (!user) throw new CustomError("Usuario no encontrado", 404);
        await grantPlanAccess(user, payment.plan, { session });
        accessGranted = true;
      }

      await payment.save({ session });
    });
  } finally {
    await session.endSession();
  }

  if (!accessGranted) return { status, accessGranted: false };

  const payment = await Payment.findOne({ clientTransactionId: devReference });
  const user = payment ? await User.findById(payment.user) : null;
  if (payment && user) {
    const loginUrl = `${process.env.FRONTEND_URL}/login`;
    try {
      if (payment.plainPassword) {
        await sendPaymentWelcomeEmail(user.email, user.name, payment.plainPassword, loginUrl);
      } else {
        await sendPaymentAccessEmail(user.email, user.name, loginUrl);
      }
    } catch (err) {
      console.error("[Nuvei] Failed to send access email:", err);
    }

    sendPurchaseEvent({
      email: user.email,
      value: payment.amount,
      currency: payment.currency || "USD",
      eventSourceUrl: process.env.FRONTEND_URL,
    }).catch((err) => console.error("[Nuvei] Meta Pixel purchase failed:", err));
  }

  return { status, accessGranted: true };
}

/** Estado para la vista de retorno del navegador. No consulta a Nuvei. */
export async function getPaymentStatus(devReference: string) {
  const payment = await Payment.findOne({
    clientTransactionId: devReference,
    gateway: "nuvei",
  });
  if (!payment) throw new CustomError("Transacción no encontrada", 404);

  const user = await User.findById(payment.user);
  return {
    status: payment.status,
    plan: payment.plan,
    amount: payment.amount,
    transactionId: payment.nuveiTransactionId ?? undefined,
    isNewUser: payment.isNewUser,
    plainPassword: payment.plainPassword || undefined,
    email: user?.email,
  };
}
