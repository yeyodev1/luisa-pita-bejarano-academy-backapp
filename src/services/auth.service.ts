import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { hashPassword, comparePassword } from "../helpers/password.helper";
import {
  generateAccessToken,
  generateVerificationToken,
  generateResetToken,
} from "../helpers/token.helper";
import {
  sendVerificationEmail,
  sendLoginEmail,
  sendPasswordResetEmail,
  sendPasswordResetConfirmationEmail,
} from "../helpers/email.helper";
import { cloudinary } from "../config/cloudinary";

function sanitizeUser(user: InstanceType<typeof User>) {
  return {
    id: user._id.toString(),
    name: user.name,
    lastName: user.lastName,
    email: user.email,
    profilePicture: user.profilePicture || null,
    role: user.role,
    isVerified: user.isVerified,
    subscriptionStatus: user.subscriptionStatus,
    accessUntil: user.accessUntil ?? null,
    foundingMember: user.foundingMember ?? false,
  };
}

export async function register(
  name: string,
  lastName: string,
  email: string,
  password: string,
  frontendUrl: string,
) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new CustomError("Email already registered", 409);
  }

  const hashedPassword = await hashPassword(password);
  const verificationToken = generateVerificationToken();
  const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await User.create({
    name: name.trim(),
    lastName: lastName.trim(),
    email: normalizedEmail,
    password: hashedPassword,
    verificationToken,
    verificationTokenExpires,
  });

  await sendVerificationEmail(normalizedEmail, verificationToken, frontendUrl);

  return { email: normalizedEmail };
}

export async function verifyEmail(token: string) {
  const user = await User.findOne({
    verificationToken: token,
    verificationTokenExpires: { $gt: new Date() },
  });

  if (!user) {
    throw new CustomError("Invalid or expired token", 400);
  }

  user.isVerified = true;
  user.verificationToken = null;
  user.verificationTokenExpires = null;
  await user.save();

  const accessToken = generateAccessToken({
    userId: user._id.toString(),
    email: user.email,
    accountType: user.role,
  });

  return { user: sanitizeUser(user), token: accessToken };
}

export async function login(email: string, password: string) {
  const user = await User.findOne({ email: email.toLowerCase().trim() });
  if (!user) {
    throw new CustomError("Invalid credentials", 401);
  }

  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) {
    throw new CustomError("Invalid credentials", 401);
  }

  if (!user.isVerified) {
    throw new CustomError("Account not verified. Check your email.", 403);
  }

  const token = generateAccessToken({
    userId: user._id.toString(),
    email: user.email,
    accountType: user.role,
  });

  sendLoginEmail(user.email, user.name).catch(() => {});

  return { token, user: sanitizeUser(user) };
}

export async function getMe(userId: string) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("User not found", 404);
  }
  return sanitizeUser(user);
}

export async function updateProfile(
  userId: string,
  payload: { name?: string; lastName?: string; email?: string },
) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  if (payload.name) user.name = payload.name.trim();
  if (payload.lastName) user.lastName = payload.lastName.trim();
  if (payload.email) {
    const normalizedEmail = payload.email.toLowerCase().trim();
    const existing = await User.findOne({
      email: normalizedEmail,
      _id: { $ne: userId },
    });
    if (existing) {
      throw new CustomError("Email already registered", 409);
    }
    user.email = normalizedEmail;
  }

  await user.save();
  return sanitizeUser(user);
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const isMatch = await comparePassword(currentPassword, user.password);
  if (!isMatch) {
    throw new CustomError("Current password is incorrect", 401);
  }

  user.password = await hashPassword(newPassword);
  await user.save();
}

export async function uploadProfilePicture(
  userId: string,
  fileBuffer: Buffer,
  fileMimeType: string,
) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const dataUri = `data:${fileMimeType};base64,${fileBuffer.toString("base64")}`;

  const result = await cloudinary.uploader.upload(dataUri, {
    folder: "academy/profile-pictures",
    public_id: `user-${userId}`,
    overwrite: true,
    resource_type: "image",
    transformation: [
      { width: 400, height: 400, crop: "fill", gravity: "face" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });

  user.profilePicture = result.secure_url;
  await user.save();

  return sanitizeUser(user);
}

export async function deleteProfilePicture(userId: string) {
  const user = await User.findById(userId);
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  try {
    await cloudinary.uploader.destroy(
      `academy/profile-pictures/user-${userId}`,
    );
  } catch {
    // Ignore Cloudinary errors — image may not exist
  }

  user.profilePicture = undefined;
  await user.save();

  return sanitizeUser(user);
}

export async function forgotPassword(email: string, frontendUrl: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    throw new CustomError("User not found", 404);
  }

  const resetToken = generateResetToken();
  const resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);

  user.resetToken = resetToken;
  user.resetTokenExpires = resetTokenExpires;
  await user.save();

  const resetUrl = `${frontendUrl}/restablecer-contrasena?token=${resetToken}`;
  await sendPasswordResetEmail(user.email, user.name, resetUrl);

  return { email: normalizedEmail };
}

export async function resetPassword(token: string, newPassword: string) {
  const user = await User.findOne({
    resetToken: token,
    resetTokenExpires: { $gt: new Date() },
  });

  if (!user) {
    throw new CustomError("Invalid or expired token", 400);
  }

  user.password = await hashPassword(newPassword);
  user.resetToken = null;
  user.resetTokenExpires = null;
  user.passwordPending = false;
  await user.save();

  sendPasswordResetConfirmationEmail(user.email, user.name).catch((err) => {
    console.error("Failed to send password reset confirmation email:", err);
  });

  return { email: user.email };
}
