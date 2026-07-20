import { Request, Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import * as manualPaymentService from "../services/manualPayment.service";
import { isPaymentPlan } from "../config/paymentPlans";

export async function list(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await manualPaymentService.listManualPayments(req.query as {
      userId?: string;
      status?: string;
      search?: string;
      page?: string;
      limit?: string;
    });
    successResponse(res, result, "Manual payments retrieved successfully");
  } catch (error) {
    next(error);
  }
}

export async function remove(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new CustomError("Unauthorized", 401);

    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    await manualPaymentService.deleteManualPayment(id);
    successResponse(res, { deleted: true }, "Payment deleted successfully");
  } catch (error) {
    next(error);
  }
}

export async function create(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new CustomError("Unauthorized", 401);
    if (!req.file) {
      throw new CustomError("Receipt image is required", 400);
    }

    const { userId, plan, amount, notes } = req.body;
    if (!userId || !plan || !amount) {
      throw new CustomError("Incomplete data", 400);
    }

    if (!isPaymentPlan(plan)) {
      throw new CustomError("Invalid plan", 400);
    }

    const payment = await manualPaymentService.createManualPayment(
      userId,
      plan,
      Number(amount),
      notes || "",
      req.file.buffer,
      req.file.mimetype,
      req.user.userId,
    );

    successResponse(
      res,
      { payment },
      "Manual payment registered successfully",
      201,
    );
  } catch (error) {
    next(error);
  }
}

export async function history(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) throw new CustomError("Unauthorized", 401);

    const history = await manualPaymentService.getUserPaymentHistory(
      req.user.userId,
    );
    successResponse(res, { history }, "Payment history retrieved successfully");
  } catch (error) {
    next(error);
  }
}
