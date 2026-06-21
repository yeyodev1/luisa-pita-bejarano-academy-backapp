import axios, { AxiosError } from "axios";
import crypto from "crypto";
import { Payment } from "../models/Payment";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { hashPassword } from "../helpers/password.helper";
import { sendPaymentWelcomeEmail } from "../helpers/email.helper";

const PAYPHONE_BASE_URL = "https://pay.payphonetodoesposible.com/api/button";
const PAYPHONE_BOX_CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

function getAuthHeaders() {
  return {
    Authorization: `Bearer ${process.env.PAYPHONE_TOKEN}`,
    "Content-Type": "application/json",
  };
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function planMonths(plan: "monthly" | "annual"): number {
  return plan === "annual" ? 12 : 1;
}

function generatePassword() {
  return crypto.randomBytes(8).toString("hex");
}

async function findOrCreateGuestUser(input: {
  email: string;
  name: string;
  lastName: string;
}) {
  const normalizedEmail = input.email.toLowerCase().trim();
  let user = await User.findOne({ email: normalizedEmail });

  if (user) {
    return { user, isNew: false, plainPassword: null };
  }

  const plainPassword = generatePassword();
  user = await User.create({
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

async function preparePaymentRecord(
  plan: "monthly" | "annual",
  amountEnvVar: string | undefined,
  guestData: { email: string; name: string; lastName: string },
) {
  const amount = Number(amountEnvVar);
  if (!Number.isFinite(amount)) {
    throw new CustomError("Invalid price configuration", 500);
  }

  const { user, isNew, plainPassword } = await findOrCreateGuestUser(guestData);
  const userId = user._id.toString();

  const amountCents = Math.round(amount * 100);
  const clientTransactionId = `${userId}-${Date.now()}`;

  await Payment.create({
    user: userId,
    plan,
    amount,
    currency: "USD",
    clientTransactionId,
    isNewUser: isNew,
    plainPassword,
  });

  return { amount, amountCents, clientTransactionId, isNewUser: isNew, plainPassword, userId };
}

function frontendUrl(origin?: string): string {
  return origin || process.env.FRONTEND_URL || "";
}

async function preparePayment(
  plan: "monthly" | "annual",
  amountEnvVar: string | undefined,
  reference: string,
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  const { amountCents, clientTransactionId, isNewUser, plainPassword, userId } =
    await preparePaymentRecord(plan, amountEnvVar, guestData);

  try {
    const response = await axios.post(
      `${PAYPHONE_BASE_URL}/Prepare`,
      {
        amount: amountCents,
        amountWithoutTax: amountCents,
        currency: "USD",
        clientTransactionId,
        storeId: process.env.PAYPHONE_STORE_ID,
        reference,
        responseUrl: `${frontendUrl(origin)}/pay-response`,
        cancellationUrl: `${frontendUrl(origin)}/`,
      },
      { headers: getAuthHeaders() },
    );

    const data = response.data as {
      paymentId?: string;
      payWithCard?: string;
      clientTransactionId?: string;
    };

    return {
      paymentId: data.paymentId,
      payWithCard: data.payWithCard,
      clientTransactionId: data.clientTransactionId ?? clientTransactionId,
      isNewUser,
      plainPassword,
      userId,
    };
  } catch (error) {
    const axiosError = error as AxiosError<{ message?: string }>;
    throw new CustomError(
      axiosError.response?.data?.message || "Error preparing payment",
      axiosError.response?.status || 500,
    );
  }
}

export async function prepareAnnualPayment(
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  return preparePayment(
    "annual",
    process.env.ANNUAL_PRICE,
    "Comunidad anual cerrada - Luisa Pita Bejarano",
    guestData,
    origin,
  );
}

export async function prepareMonthlyPayment(
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  return preparePayment(
    "monthly",
    process.env.MONTHLY_PRICE,
    "Mensualidad - Luisa Pita Bejarano Academy",
    guestData,
    origin,
  );
}

export async function prepareAnnualPaymentBox(
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  const { amountCents, clientTransactionId } = await preparePaymentRecord(
    "annual",
    process.env.ANNUAL_PRICE,
    guestData,
  );
  return {
    token: process.env.PAYPHONE_TOKEN,
    storeId: process.env.PAYPHONE_STORE_ID,
    amount: amountCents,
    amountWithoutTax: amountCents,
    currency: "USD",
    clientTransactionId,
    reference: "Comunidad anual cerrada - Luisa Pita Bejarano",
    responseUrl: `${frontendUrl(origin)}/pay-response`,
  };
}

export async function prepareMonthlyPaymentBox(
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  const { amountCents, clientTransactionId } = await preparePaymentRecord(
    "monthly",
    process.env.MONTHLY_PRICE,
    guestData,
  );
  return {
    token: process.env.PAYPHONE_TOKEN,
    storeId: process.env.PAYPHONE_STORE_ID,
    amount: amountCents,
    amountWithoutTax: amountCents,
    currency: "USD",
    clientTransactionId,
    reference: "Mensualidad - Luisa Pita Bejarano Academy",
    responseUrl: `${frontendUrl(origin)}/pay-response`,
  };
}

export async function confirmPayment(id: string, clientTxId: string) {
  try {
    const response = await axios.post(
      PAYPHONE_BOX_CONFIRM_URL,
      { id: Number(id), clientTxId },
      { headers: getAuthHeaders() },
    );

    const data = response.data as {
      statusCode?: number;
      transactionId?: number;
      message?: string;
    };

    const payment = await Payment.findOne({ clientTransactionId: clientTxId });
    if (!payment) {
      throw new CustomError("Transaction not found", 404);
    }

    let status: "approved" | "canceled" | "failed";
    if (data.statusCode === 3) status = "approved";
    else if (data.statusCode === 2) status = "canceled";
    else status = "failed";

    payment.status = status;
    payment.payphoneTransactionId = data.transactionId ?? null;
    payment.payphoneResponse = data;
    await payment.save();

      if (status === "approved") {
        const user = await User.findById(payment.user);
        if (user) {
          user.accessUntil = addMonths(new Date(), planMonths(payment.plan));
          user.subscriptionStatus = "active";
          await user.save();
        }

        let emailSent = false;
        if (payment.isNewUser && payment.plainPassword) {
          const loginUrl = `${process.env.FRONTEND_URL}/login`;
          try {
            await sendPaymentWelcomeEmail(
              user?.email || "",
              user?.name || "",
              payment.plainPassword,
              loginUrl,
            );
            emailSent = true;
          } catch (err) {
            console.error("Failed to send payment welcome email:", err);
          }
        }

        return { status, transactionId: data.transactionId, data, isNewUser: payment.isNewUser, plainPassword: payment.isNewUser ? payment.plainPassword : undefined, emailSent, email: user?.email };
      }

      return { status, transactionId: data.transactionId, data, isNewUser: false, plainPassword: undefined, emailSent: false, email: undefined };
  } catch (error) {
    if (error instanceof CustomError) throw error;
    const axiosError = error as AxiosError<{ message?: string }>;
    throw new CustomError(
      axiosError.response?.data?.message || "Error confirming payment",
      axiosError.response?.status || 500,
    );
  }
}

export async function resendWelcomeEmail(clientTransactionId: string) {
  const payment = await Payment.findOne({ clientTransactionId });
  if (!payment) {
    throw new CustomError("Transaction not found", 404);
  }

  if (payment.status !== "approved") {
    throw new CustomError("Payment is not approved", 400);
  }

  if (!payment.isNewUser || !payment.plainPassword) {
    throw new CustomError("No credentials available for this transaction", 400);
  }

  const user = await User.findById(payment.user);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const loginUrl = `${process.env.FRONTEND_URL}/login`;
  await sendPaymentWelcomeEmail(
    user.email,
    user.name,
    payment.plainPassword,
    loginUrl,
  );

  return { email: user.email };
}

export async function cancelPendingPayments(userId: string) {
  const result = await Payment.updateMany(
    { user: userId, status: "pending" },
    { status: "canceled" },
  );
  return { canceled: result.modifiedCount };
}

export async function cancelSubscription(userId: string) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  user.subscriptionStatus = "canceled";
  await user.save();

  return { email: user.email, subscriptionStatus: user.subscriptionStatus };
}
