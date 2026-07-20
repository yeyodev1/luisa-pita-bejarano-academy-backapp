import { Request } from "express";
import type { IUser } from "../models/User";

export interface JwtPayload {
  userId: string;
  email: string;
  accountType: string;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
  currentUser?: IUser;
  file?: Express.Multer.File;
}
