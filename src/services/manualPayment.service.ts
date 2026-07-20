import { cloudinary } from "../config/cloudinary";
import { ManualPayment } from "../models/ManualPayment";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { sendManualPaymentReceiptEmail } from "../helpers/email.helper";
import { PAYMENT_PLANS, PaymentPlan } from "../config/paymentPlans";

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export async function createManualPayment(
  userId: string,
  plan: PaymentPlan,
  amount: number,
  notes: string,
  imageBuffer: Buffer,
  mimeType: string,
  adminId: string,
) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const dataUri = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  const publicId = `academy/payment-receipts/receipt-${userId}-${Date.now()}`;

  const uploadResult = await cloudinary.uploader.upload(dataUri, {
    folder: "academy/payment-receipts",
    public_id: publicId,
    overwrite: true,
    resource_type: "image",
  });

  const payment = await ManualPayment.create({
    user: userId,
    plan,
    amount,
    currency: "USD",
    status: "approved",
    receiptImage: uploadResult.secure_url,
    receiptPublicId: uploadResult.public_id,
    notes: notes || "",
    createdBy: adminId,
  });

  // El acceso se calcula desde la fecha del pago registrado, no se acumula
  // con acceso futuro existente. Así un plan anual siempre da 12 meses.
  const accessUntil = addMonths(new Date(), PAYMENT_PLANS[plan].months);

  user.subscriptionStatus = "active";
  user.accessUntil = accessUntil;
  await user.save();

  await sendManualPaymentReceiptEmail(
    user.email,
    user.name,
    plan,
    amount,
    accessUntil,
    uploadResult.secure_url,
  );

  return payment;
}

export async function listManualPayments(filters: {
  userId?: string;
  status?: string;
  search?: string;
  page?: string | number;
  limit?: string | number;
}) {
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;

  if (filters.userId) {
    query.user = filters.userId;
  } else if (filters.search?.trim()) {
    const searchRegex = new RegExp(filters.search.trim(), "i");
    const matchingUsers = await User.find({
      $or: [
        { name: searchRegex },
        { lastName: searchRegex },
        { email: searchRegex },
      ],
    }).select("_id").lean();
    const userIds = matchingUsers.map((u) => u._id.toString());
    if (userIds.length === 0) {
      return {
        payments: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      };
    }
    query.user = { $in: userIds };
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
  const skip = (page - 1) * limit;

  const [payments, total] = await Promise.all([
    ManualPayment.find(query)
      .populate("user", "name lastName email")
      .populate("createdBy", "name lastName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ManualPayment.countDocuments(query),
  ]);

  return {
    payments: payments.map((payment) => ({
      id: payment._id.toString(),
      user: payment.user,
      plan: payment.plan,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      receiptImage: payment.receiptImage,
      notes: payment.notes,
      createdBy: payment.createdBy,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function deleteManualPayment(paymentId: string) {
  const payment = await ManualPayment.findById(paymentId);
  if (!payment) {
    throw new CustomError("Payment not found", 404);
  }

  if (payment.receiptPublicId) {
    await cloudinary.uploader.destroy(payment.receiptPublicId);
  }

  await ManualPayment.findByIdAndDelete(paymentId);
  return payment;
}

export async function getUserPaymentHistory(userId: string) {
  const [manualPayments, payphonePayments] = await Promise.all([
    ManualPayment.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean(),
    (await import("../models/Payment")).Payment.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean(),
  ]);

  const history = [
    ...manualPayments.map((payment) => ({
      id: payment._id.toString(),
      type: "manual" as const,
      plan: payment.plan,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      receiptImage: payment.receiptImage,
      notes: payment.notes,
      createdAt: payment.createdAt,
    })),
    ...payphonePayments.map((payment) => ({
      id: payment._id.toString(),
      type: "payphone" as const,
      plan: payment.plan,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      payphoneTransactionId: payment.payphoneTransactionId,
      clientTransactionId: payment.clientTransactionId,
      createdAt: payment.createdAt,
    })),
  ];

  history.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return history;
}
