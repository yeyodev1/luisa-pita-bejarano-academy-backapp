import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import * as service from "../services/memberAcademy.service";

type Handler = (req: AuthRequest, userId: string) => Promise<unknown>;
const run =
  (message: string, handler: Handler, status = 200) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new CustomError("Unauthorized", 401);
      successResponse(
        res,
        await handler(req, req.user.userId),
        message,
        status,
      );
    } catch (error) {
      next(error);
    }
  };

export const listCourses = run(
  "Courses retrieved successfully",
  (_req, userId) => service.listCourses(userId),
);
export const getCourse = run("Course retrieved successfully", (req, userId) =>
  service.getCourse(String(req.params.identifier), userId),
);
export const getLesson = run("Lesson retrieved successfully", (req, userId) =>
  service.getLesson(String(req.params.id), userId),
);
export const updateProgress = run(
  "Progress updated successfully",
  (req, userId) =>
    service.updateProgress(String(req.params.id), userId, req.body),
);
export const getCourseProgress = run(
  "Course progress retrieved successfully",
  (req, userId) => service.getCourseProgress(String(req.params.id), userId),
);
export const listCalendar = run(
  "Calendar events retrieved successfully",
  (req) => service.listCalendar(req.query),
);
export const getCalendar = run("Calendar event retrieved successfully", (req) =>
  service.getCalendarEvent(String(req.params.id)),
);
export const listRecipes = run("Recipes retrieved successfully", (req) =>
  service.listRecipes(req.query),
);
export const getRecipe = run("Recipe retrieved successfully", (req) =>
  service.getRecipe(String(req.params.identifier)),
);
export const listAchievements = run(
  "Achievements retrieved successfully",
  (_req, userId) => service.listAchievements(userId),
);
export const getAchievement = run(
  "Achievement retrieved successfully",
  (req, userId) => service.getAchievement(String(req.params.id), userId),
);
export const listComments = run(
  "Comments retrieved successfully",
  (req, userId) =>
    service.listComments(String(req.params.lessonId), userId, req.query),
);
export const createComment = run(
  "Comment submitted for moderation",
  (req, userId) =>
    service.createComment(String(req.params.lessonId), userId, req.body.body),
  201,
);
export const updateComment = run(
  "Comment updated successfully",
  (req, userId) =>
    service.updateComment(String(req.params.id), userId, req.body.body),
);
export const deleteComment = run(
  "Comment deleted successfully",
  (req, userId) => service.deleteComment(String(req.params.id), userId),
);

// ── Recorded Classes ──────────────────────────────────────────────────────────
export const listRecordedClasses = run(
  "Recorded classes retrieved successfully",
  (req) => service.listRecordedClasses(req.query),
);
export const getRecordedClass = run(
  "Recorded class retrieved successfully",
  (req) => service.getRecordedClass(String(req.params.id)),
);
