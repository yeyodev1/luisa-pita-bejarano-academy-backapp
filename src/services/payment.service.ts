import axios, { AxiosError } from "axios";
import crypto from "crypto";
import { Payment } from "../models/Payment";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { hashPassword } from "../helpers/password.helper";
import {
  sendPaymentAccessEmail,
  sendPaymentWelcomeEmail,
} from "../helpers/email.helper";
import { sendPurchaseEvent } from "./metaPixel.service";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

const PAYPHONE_BASE_URL = "https://pay.payphonetodoesposible.com/api/button";
const PAYPHONE_BOX_CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

type PayphoneEnvironment = "test" | "prod";

function payphoneEnvironment(origin?: string): PayphoneEnvironment {
  if (origin?.includes("localhost") || origin?.includes("testing-storybrand")) return "test";
  return "prod";
}

function getPayphoneCredentials(environment: PayphoneEnvironment) {
  const testToken = process.env.PAYPHONE_TEST_TOKEN || process.env.PAYPHONE_TOKEN;
  const testStoreId = process.env.PAYPHONE_TEST_STORE_ID || process.env.PAYPHONE_STORE_ID;
  const token = environment === "test" ? testToken : process.env.PAYPHONE_TOKEN;
  const storeId = environment === "test" ? testStoreId : process.env.PAYPHONE_STORE_ID;
  if (!token || !storeId) throw new CustomError("Missing Payphone credentials", 500);
  return { token, storeId };
}

function getAuthHeaders(environment: PayphoneEnvironment) {
  const { token } = getPayphoneCredentials(environment);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
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
  plan: PaymentPlan,
  guestData: { email: string; name: string; lastName: string },
  environment: PayphoneEnvironment,
) {
  const amount = PAYMENT_PLANS[plan].amount;

  const { user, isNew, plainPassword } = await findOrCreateGuestUser(guestData);
  const userId = user._id.toString();

  const amountCents = Math.round(amount * 100);
  const clientTransactionId = `${environment}-${userId}-${Date.now()}`;

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
  plan: PaymentPlan,
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  const environment = payphoneEnvironment(origin);
  const credentials = getPayphoneCredentials(environment);
  const { amountCents, clientTransactionId, isNewUser, plainPassword, userId } =
    await preparePaymentRecord(plan, guestData, environment);

  try {
    const response = await axios.post(
      `${PAYPHONE_BASE_URL}/Prepare`,
      {
        amount: amountCents,
        amountWithoutTax: amountCents,
        currency: "USD",
        clientTransactionId,
        storeId: credentials.storeId,
        reference: PAYMENT_PLANS[plan].reference,
        responseUrl: `${frontendUrl(origin)}/pay-response`,
        cancellationUrl: `${frontendUrl(origin)}/`,
      },
      { headers: getAuthHeaders(environment) },
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
    guestData,
    origin,
  );
}

export async function preparePlanPayment(
  plan: PaymentPlan,
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  return preparePayment(plan, guestData, origin);
}

export async function preparePaymentBox(
  plan: PaymentPlan,
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  const environment = payphoneEnvironment(origin);
  const credentials = getPayphoneCredentials(environment);
  const { amountCents, clientTransactionId } = await preparePaymentRecord(
    plan,
    guestData,
    environment,
  );
  return {
    token: credentials.token,
    storeId: credentials.storeId,
    amount: amountCents,
    amountWithoutTax: amountCents,
    currency: "USD",
    clientTransactionId,
    reference: PAYMENT_PLANS[plan].reference,
    responseUrl: `${frontendUrl(origin)}/pay-response`,
  };
}

export async function prepareMonthlyPaymentBox(
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  return preparePaymentBox("monthly", guestData, origin);
}

export async function prepareAnnualPaymentBox(
  guestData: { email: string; name: string; lastName: string },
  origin?: string,
) {
  return preparePaymentBox("annual", guestData, origin);
}

export async function confirmPayment(id: string, clientTxId: string) {
  try {
    const confirmedPayment = await Payment.findOne({
      clientTransactionId: clientTxId,
      status: "approved",
    });
    if (confirmedPayment) {
      const user = await User.findById(confirmedPayment.user);
      return {
        status: "approved" as const,
        transactionId: confirmedPayment.payphoneTransactionId ?? undefined,
        data: confirmedPayment.payphoneResponse,
        isNewUser: confirmedPayment.isNewUser,
        plainPassword: confirmedPayment.plainPassword || undefined,
        emailSent: false,
        email: user?.email,
      };
    }

    const environment: PayphoneEnvironment = clientTxId.startsWith("test-") ? "test" : "prod";
    const response = await axios.post(
      PAYPHONE_BOX_CONFIRM_URL,
      { id: Number(id), clientTxId },
      { headers: getAuthHeaders(environment) },
    );

    const data = response.data as {
      statusCode?: number;
      transactionId?: number;
      message?: string;
    };

    if (!(await Payment.exists({ clientTransactionId: clientTxId }))) {
      throw new CustomError("Transaction not found", 404);
    }

    let status: "approved" | "canceled" | "failed";
    if (data.statusCode === 3) status = "approved";
    else if (data.statusCode === 2) status = "canceled";
    else status = "failed";

    const session = await Payment.startSession();
    let accessGranted = false;
    try {
      await session.withTransaction(async () => {
        accessGranted = false;
        const payment = await Payment.findOne({ clientTransactionId: clientTxId }).session(
          session,
        );
        if (!payment) throw new CustomError("Transaction not found", 404);

        if (status === "approved" && payment.status === "approved") return;

        payment.status = status;
        payment.payphoneTransactionId = data.transactionId ?? null;
        payment.payphoneResponse = data;

        if (status === "approved") {
          const user = await User.findById(payment.user).session(session);
          if (!user) throw new CustomError("User not found", 404);

          user.accessUntil = addMonths(new Date(), PAYMENT_PLANS[payment.plan].months);
          user.subscriptionStatus = "active";
          await user.save({ session });
          accessGranted = true;
        }

        await payment.save({ session });
      });
    } finally {
      await session.endSession();
    }

    const payment = await Payment.findOne({ clientTransactionId: clientTxId });
    if (!payment) throw new CustomError("Transaction not found", 404);

    if (status === "approved") {
      const user = await User.findById(payment.user);
      let emailSent = false;

      if (accessGranted && user) {
        const loginUrl = `${process.env.FRONTEND_URL}/login`;
        try {
          if (payment.plainPassword) {
            await sendPaymentWelcomeEmail(
              user.email,
              user.name,
              payment.plainPassword,
              loginUrl,
            );
          } else {
            await sendPaymentAccessEmail(user.email, user.name, loginUrl);
          }
          emailSent = true;
        } catch (err) {
          console.error("Failed to send payment access email:", err);
        }

        sendPurchaseEvent({
          email: user.email,
          value: payment.amount,
          currency: payment.currency || "USD",
          eventSourceUrl: process.env.FRONTEND_URL,
        }).catch((err) => console.error("[MetaPixel] Purchase event failed:", err));
      }

      return {
        status,
        transactionId: data.transactionId,
        data,
        isNewUser: payment.isNewUser,
        plainPassword: payment.plainPassword || undefined,
        emailSent,
        email: user?.email,
      };
    }

    return {
      status,
      transactionId: data.transactionId,
      data,
      isNewUser: false,
      plainPassword: undefined,
      emailSent: false,
      email: undefined,
    };
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

  const user = await User.findById(payment.user);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const loginUrl = `${process.env.FRONTEND_URL}/login`;
  if (payment.plainPassword) {
    await sendPaymentWelcomeEmail(
      user.email,
      user.name,
      payment.plainPassword,
      loginUrl,
    );
  } else {
    await sendPaymentAccessEmail(user.email, user.name, loginUrl);
  }

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
