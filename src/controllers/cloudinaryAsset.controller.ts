import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { successResponse } from "../helpers/response.helper";
import * as service from "../services/cloudinaryAsset.service";
import * as bunnyStream from "../services/bunnyStream.service";

export async function signature(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    successResponse(
      res,
      service.createUploadSignature(req.body.resourceType, req.body.category),
      "Upload signature generated successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function confirm(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    successResponse(
      res,
      { asset: await service.confirmUpload(req.body) },
      "Upload confirmed successfully",
    );
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
    successResponse(
      res,
      req.body.provider === "bunny"
        ? await bunnyStream.deleteVideo(req.body.publicId)
        : await service.deleteAsset(req.body.publicId, req.body.resourceType),
      "Asset deleted successfully",
    );
  } catch (error) {
    next(error);
  }
}

export async function deliveryUrl(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    successResponse(
      res,
      req.body.provider === "bunny"
        ? await bunnyStream.createAuthorizedDelivery(req.body.publicId)
        : await service.createDeliveryUrl(req.body.publicId, req.body.resourceType),
      "Delivery URL generated successfully",
    );
  } catch (error) {
    next(error);
  }
}
