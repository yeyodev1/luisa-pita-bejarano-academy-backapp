import { NextFunction, Response } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { successResponse } from "../helpers/response.helper";
import * as service from "../services/bunnyStream.service";

export async function createUpload(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    successResponse(
      res,
      await service.createUpload(req.body.title),
      "Bunny upload created successfully",
      201,
    );
  } catch (error) {
    next(error);
  }
}

export async function confirm(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    successResponse(
      res,
      { asset: await service.confirmUpload(req.params.id, req.body) },
      "Bunny upload confirmed successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function status(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    successResponse(res, await service.getVideo(req.params.id), "Bunny video retrieved successfully");
  } catch (error) {
    next(error);
  }
}
