import { Response, NextFunction } from "express";
import { AuthRequest } from "../types/AuthRequest";
import { CustomError } from "../errors/customError.error";
import { successResponse } from "../helpers/response.helper";
import * as service from "../services/adminAcademy.service";

type Handler = (req: AuthRequest) => Promise<unknown> | unknown;
const run =
  (message: string, handler: Handler, status = 200) =>
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      successResponse(res, await handler(req), message, status);
    } catch (error) {
      next(error);
    }
  };
const id = (req: AuthRequest) => String(req.params.id);

export const listCourses = run("Courses retrieved successfully", (req) =>
  service.listCourses(req.query),
);
export const getCourse = run("Course retrieved successfully", (req) =>
  service.getCourse(id(req)),
);
export const createCourse = run(
  "Course created successfully",
  (req) => service.createCourse(req.body),
  201,
);
export const reorderCourses = run("Courses reordered successfully", (req) =>
  service.reorderCourses(req.body.courseIds),
);
export const updateCourse = run("Course updated successfully", (req) =>
  service.updateCourse(id(req), req.body),
);
export const deleteCourse = run("Course deleted successfully", (req) =>
  service.deleteCourse(id(req)),
);
export const listLessons = run("Lessons retrieved successfully", (req) =>
  service.listLessons(String(req.params.courseId)),
);
export const getLesson = run("Lesson retrieved successfully", (req) =>
  service.getLesson(id(req)),
);
export const createLesson = run(
  "Lesson created successfully",
  (req) => service.createLesson(String(req.params.courseId), req.body),
  201,
);
export const updateLesson = run("Lesson updated successfully", (req) =>
  service.updateLesson(id(req), req.body),
);
export const deleteLesson = run("Lesson deleted successfully", (req) =>
  service.deleteLesson(id(req)),
);
export const reorderLessons = run("Lessons reordered successfully", (req) =>
  service.reorderLessons(String(req.params.courseId), req.body.lessonIds),
);
export const listCalendar = run(
  "Calendar events retrieved successfully",
  (req) => service.listCalendar(req.query),
);
export const calendarConfig = run(
  "Calendar config retrieved successfully",
  () => service.getCalendarConfig(),
);
export const getCalendar = run("Calendar event retrieved successfully", (req) =>
  service.getCalendarEvent(id(req)),
);
export const createCalendar = run(
  "Calendar event created successfully",
  (req) => service.createCalendarEvent(req.body),
  201,
);
export const updateCalendar = run(
  "Calendar event updated successfully",
  (req) => service.updateCalendarEvent(id(req), req.body),
);
export const deleteCalendar = run(
  "Calendar event deleted successfully",
  (req) => service.deleteCalendarEvent(id(req)),
);
export const listRecipes = run("Recipes retrieved successfully", (req) =>
  service.listRecipes(req.query),
);
export const getRecipe = run("Recipe retrieved successfully", (req) =>
  service.getRecipe(id(req)),
);
export const createRecipe = run(
  "Recipe created successfully",
  (req) => service.createRecipe(req.body),
  201,
);
export const updateRecipe = run("Recipe updated successfully", (req) =>
  service.updateRecipe(id(req), req.body),
);
export const deleteRecipe = run("Recipe deleted successfully", (req) =>
  service.deleteRecipe(id(req)),
);
export const listAchievements = run(
  "Achievements retrieved successfully",
  (req) => service.listAchievements(req.query),
);
export const getAchievement = run("Achievement retrieved successfully", (req) =>
  service.getAchievement(id(req)),
);
export const createAchievement = run(
  "Achievement created successfully",
  (req) => service.createAchievement(req.body),
  201,
);
export const updateAchievement = run(
  "Achievement updated successfully",
  (req) => service.updateAchievement(id(req), req.body),
);
export const deleteAchievement = run(
  "Achievement deleted successfully",
  (req) => service.deleteAchievement(id(req)),
);
export const awardAchievement = run("Achievement awarded successfully", (req) =>
  service.awardAchievement(id(req), req.body),
);
export const revokeAchievement = run(
  "Achievement revoked successfully",
  (req) => service.revokeAchievement(id(req), String(req.params.userId)),
);
export const listComments = run("Comments retrieved successfully", (req) =>
  service.listComments(req.query),
);
export const moderateComment = run("Comment moderated successfully", (req) => {
  if (!req.user) throw new CustomError("Unauthorized", 401);
  return service.moderateComment(id(req), req.body.status, req.user.userId);
});
export const deleteComment = run("Comment deleted successfully", (req) =>
  service.deleteComment(id(req)),
);

// ── Recorded Classes ──────────────────────────────────────────────────────────
export const listRecordedClasses = run(
  "Recorded classes retrieved successfully",
  (req) => service.listRecordedClasses(req.query),
);
export const getRecordedClass = run(
  "Recorded class retrieved successfully",
  (req) => service.getRecordedClass(id(req)),
);
export const createRecordedClass = run(
  "Recorded class created successfully",
  (req) => service.createRecordedClass(req.body),
  201,
);
export const updateRecordedClass = run(
  "Recorded class updated successfully",
  (req) => service.updateRecordedClass(id(req), req.body),
);
export const deleteRecordedClass = run(
  "Recorded class deleted successfully",
  (req) => service.deleteRecordedClass(id(req)),
);
