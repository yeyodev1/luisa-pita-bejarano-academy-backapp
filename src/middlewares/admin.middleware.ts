import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";

export function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  if (!req.currentUser) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  if (req.currentUser.role !== "admin") {
    res.status(403).json({ message: "Forbidden: admin access required" });
    return;
  }

  next();
}
