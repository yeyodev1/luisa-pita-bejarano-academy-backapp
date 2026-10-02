import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import * as service from "../services/backoffice.service";

type Handler = (req: AuthRequest, userId: string) => Promise<unknown>;
const run =
  (message: string, handler: Handler, status = 200) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new CustomError("Unauthorized", 401);
      successResponse(res, await handler(req, req.user.userId), message, status);
    } catch (error) {
      next(error);
    }
  };
const id = (req: AuthRequest) => String(req.params.id);

export const listServices = run("Services retrieved", () => service.listServices());
export const seedServices = run("Base services loaded", () => service.seedServices());
export const createService = run(
  "Service created",
  (req) => service.createService(req.body),
  201,
);
export const updateService = run("Service updated", (req) =>
  service.updateService(id(req), req.body),
);
export const deleteService = run("Service deleted", (req) =>
  service.deleteService(id(req)),
);

export const listRequests = run("Requests retrieved", () => service.listRequests());
export const createRequest = run(
  "Request created",
  (req, userId) => service.createRequest(userId, req.body),
  201,
);
export const updateRequest = run("Request updated", (req) =>
  service.updateRequest(id(req), req.body),
);
export const addRequestNote = run(
  "Note added",
  (req, userId) => service.addRequestNote(userId, id(req), req.body),
  201,
);
export const deleteRequest = run("Request deleted", (req) =>
  service.deleteRequest(id(req)),
);
