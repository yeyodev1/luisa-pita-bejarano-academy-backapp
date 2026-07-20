import crypto from "crypto";
import { User } from "../models/User";
import { ManualPayment } from "../models/ManualPayment";
import { CustomError } from "../errors/customError.error";
import { hashPassword } from "../helpers/password.helper";
import { generateVerificationToken } from "../helpers/token.helper";
import { LessonProgress } from "../models/LessonProgress";
import { LessonComment } from "../models/LessonComment";
import { UserAchievement } from "../models/UserAchievement";
import {
  sendAdminInviteEmail,
  sendAccessExtendedEmail,
} from "../helpers/email.helper";

function sanitizeAdminUser(user: InstanceType<typeof User>) {
  return {
    id: user._id.toString(),
    name: user.name,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    subscriptionStatus: user.subscriptionStatus,
    accessUntil: user.accessUntil ?? null,
    foundingMember: user.foundingMember ?? false,
    isVerified: user.isVerified,
    createdAt: user.createdAt,
  };
}

function generateRandomPassword(length = 12): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";
  return Array.from(crypto.randomBytes(length))
    .map((byte) => chars[byte % chars.length])
    .join("");
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

export async function createUser(
  name: string,
  lastName: string,
  email: string,
  role: "user" | "admin",
  accessMonths: number | undefined,
  password: string | undefined,
  frontendUrl: string,
) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new CustomError("Email already registered", 409);
  }

  const plainPassword = password?.trim() || generateRandomPassword();
  const hashedPassword = await hashPassword(plainPassword);
  const verificationToken = generateVerificationToken();
  const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const accessUntil =
    role === "user" && accessMonths && accessMonths > 0
      ? addMonths(new Date(), accessMonths)
      : null;

  const user = await User.create({
    name: name.trim(),
    lastName: lastName.trim(),
    email: normalizedEmail,
    password: hashedPassword,
    role,
    isVerified: false,
    verificationToken,
    verificationTokenExpires,
    subscriptionStatus: accessUntil ? "active" : "none",
    accessUntil,
  });

  const verificationLink = `${frontendUrl}/verificar-email?token=${verificationToken}`;
  await sendAdminInviteEmail(
    normalizedEmail,
    user.name,
    plainPassword,
    verificationLink,
  );

  return sanitizeAdminUser(user);
}

export async function listUsers(filters: {
  role?: string;
  subscriptionStatus?: string;
  search?: string;
  page?: string | number;
  limit?: string | number;
}) {
  const query: Record<string, unknown> = {};
  if (filters.role) query.role = filters.role;
  if (filters.subscriptionStatus)
    query.subscriptionStatus = filters.subscriptionStatus;

  if (filters.search && filters.search.trim()) {
    const searchRegex = new RegExp(filters.search.trim(), "i");
    query.$or = [
      { name: searchRegex },
      { lastName: searchRegex },
      { email: searchRegex },
    ];
  }

  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.max(1, Math.min(100, Number(filters.limit) || 20));
  const skip = (page - 1) * limit;

  const [users, total] = await Promise.all([
    User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(query),
  ]);

  return {
    users: users.map((user) => ({
      id: user._id.toString(),
      name: user.name,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      subscriptionStatus: user.subscriptionStatus,
      accessUntil: user.accessUntil ?? null,
      foundingMember: user.foundingMember ?? false,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function deleteUser(id: string) {
  const user = await User.findById(id);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  await Promise.all([
    ManualPayment.deleteMany({ user: id }),
    LessonProgress.deleteMany({ user: id }),
    LessonComment.deleteMany({ user: id }),
    UserAchievement.deleteMany({ user: id }),
  ]);
  await User.findByIdAndDelete(id);

  return { deleted: true };
}

export async function extendAccess(id: string, months: number) {
  if (!Number.isFinite(months) || months <= 0) {
    throw new CustomError("Invalid months value", 400);
  }

  const user = await User.findById(id);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const baseDate =
    user.accessUntil && user.accessUntil > new Date()
      ? user.accessUntil
      : new Date();
  const newAccessUntil = addMonths(baseDate, months);

  user.accessUntil = newAccessUntil;
  user.subscriptionStatus = "active";
  await user.save();

  await sendAccessExtendedEmail(user.email, user.name, newAccessUntil);

  return sanitizeAdminUser(user);
}

export async function revokeAccess(id: string) {
  const user = await User.findById(id);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  user.accessUntil = null;
  user.subscriptionStatus = "none";
  await user.save();

  return sanitizeAdminUser(user);
}

export async function setFoundingMember(id: string, foundingMember: boolean) {
  const user = await User.findById(id);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  user.foundingMember = foundingMember;
  await user.save();

  return sanitizeAdminUser(user);
}
