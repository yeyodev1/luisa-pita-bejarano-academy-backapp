import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";
import { User } from "../models/User";

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "No token provided" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string,
    ) as JwtPayload;
    if (!decoded.userId) {
      res.status(401).json({ message: "Invalid or expired token" });
      return;
    }

    const currentUser = await User.findById(decoded.userId);
    if (!currentUser) {
      res.status(401).json({ message: "User no longer exists" });
      return;
    }

    req.user = {
      ...decoded,
      email: currentUser.email,
      // Keep the legacy JWT field available, but use the current DB role.
      accountType: currentUser.role,
    };
    req.currentUser = currentUser;
    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }
}

export function requireActiveAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  const user = req.currentUser;
  if (!user) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (user.role === "admin") {
    next();
    return;
  }

  const hasAccess =
    user.subscriptionStatus === "active" &&
    (user.accessUntil === null || user.accessUntil.getTime() > Date.now());

  if (!hasAccess) {
    res.status(403).json({ message: "An active subscription is required" });
    return;
  }

  next();
}
