import { Course } from "../models/Course";
import { Lesson } from "../models/Lesson";
import { LessonProgress } from "../models/LessonProgress";
import { CalendarEvent } from "../models/CalendarEvent";
import { Recipe } from "../models/Recipe";
import { Achievement } from "../models/Achievement";
import { UserAchievement } from "../models/UserAchievement";
import { LessonComment } from "../models/LessonComment";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import {
  asDate,
  pagination,
  requireObjectId,
  requireString,
  slugify,
} from "../helpers/validation.helper";
import { contentStatuses } from "../models/content.shared";
import { deleteAsset } from "./cloudinaryAsset.service";
import { deleteVideo } from "./bunnyStream.service";

type Body = Record<string, unknown>;
type AssetRef = {
  publicId: string;
  resourceType: "image" | "video" | "raw";
  provider?: "cloudinary" | "bunny";
};

async function cleanupAssets(assets: Array<AssetRef | null | undefined>) {
  const unique = Array.from(
    new Map(
      assets.filter(Boolean).map((asset) => [asset!.publicId, asset!]),
    ).values(),
  );
  await Promise.allSettled(
    unique.map((asset) =>
      asset.provider === "bunny"
        ? deleteVideo(asset.publicId)
        : deleteAsset(asset.publicId, asset.resourceType),
    ),
  );
}

function pick(body: Body, fields: string[]): Body {
  return Object.fromEntries(
    fields
      .filter((field) => body[field] !== undefined)
      .map((field) => [field, body[field]]),
  );
}

function contentInput(body: Body, fields: string[], existingSlug?: string) {
  const input = pick(body, fields);
  if (body.title !== undefined)
    input.title = requireString(body.title, "title");
  if (body.slug !== undefined || (body.title !== undefined && !existingSlug)) {
    input.slug = slugify(requireString(body.slug ?? body.title, "slug"));
  }
  if (
    body.status !== undefined &&
    !contentStatuses.includes(body.status as never)
  ) {
    throw new CustomError("Invalid status", 400);
  }
  if (body.status === "published" && fields.includes("publishedAt"))
    input.publishedAt = new Date();
  return input;
}

async function ensureUniqueSlug(
  model: typeof Course | typeof Recipe | typeof Achievement,
  slug: unknown,
  excludeId?: string,
) {
  if (slug === undefined) return;
  const query: Body = { slug };
  if (excludeId) query._id = { $ne: excludeId };
  if (await model.exists(query))
    throw new CustomError("Slug already exists", 409);
}

export async function listCourses(query: Body) {
  const { page, limit, skip } = pagination(query);
  const filter: Body = query.status ? { status: query.status } : {};
  const [courses, total] = await Promise.all([
    Course.find(filter)
      .sort({ order: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Course.countDocuments(filter),
  ]);
  return {
    courses,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getCourse(id: string) {
  requireObjectId(id);
  const [course, lessons] = await Promise.all([
    Course.findById(id).lean(),
    Lesson.find({ course: id }).sort({ order: 1 }).lean(),
  ]);
  if (!course) throw new CustomError("Course not found", 404);
  return { ...course, lessons };
}

export async function createCourse(body: Body) {
  const input = contentInput(body, [
    "title",
    "slug",
    "summary",
    "description",
    "status",
    "order",
    "cover",
    "publishedAt",
  ]);
  if (!input.title) throw new CustomError("title is required", 400);
  if (!input.slug) input.slug = slugify(input.title as string);
  await ensureUniqueSlug(Course, input.slug);
  return Course.create(input);
}

export async function updateCourse(id: string, body: Body) {
  requireObjectId(id);
  const course = await Course.findById(id);
  if (!course) throw new CustomError("Course not found", 404);
  const input = contentInput(
    body,
    [
      "title",
      "slug",
      "summary",
      "description",
      "status",
      "order",
      "cover",
      "publishedAt",
    ],
    course.slug,
  );
  await ensureUniqueSlug(Course, input.slug, id);
  Object.assign(course, input);
  return course.save();
}

export async function deleteCourse(id: string) {
  requireObjectId(id);
  const course = await Course.findById(id);
  if (!course) throw new CustomError("Course not found", 404);
  const lessons = await Lesson.find({ course: id });
  const lessonIds = lessons.map((lesson) => lesson._id);
  await Promise.all([
    LessonComment.deleteMany({ lesson: { $in: lessonIds } }),
    LessonProgress.deleteMany({ course: id }),
    Lesson.deleteMany({ course: id }),
    course.deleteOne(),
  ]);
  await cleanupAssets([
    course.cover,
    ...lessons.flatMap((lesson) => [
      lesson.video,
      lesson.thumbnail,
      ...lesson.materials,
    ]),
  ]);
  return { deleted: true };
}

export async function reorderCourses(courseIds: unknown) {
  if (!Array.isArray(courseIds) || courseIds.length === 0)
    throw new CustomError("courseIds is required", 400);
  const ids = courseIds.map((courseId) =>
    requireObjectId(courseId, "courseId"),
  );
  if (new Set(ids).size !== ids.length)
    throw new CustomError("courseIds must be unique", 400);
  const count = await Course.countDocuments({ _id: { $in: ids } });
  if (count !== ids.length)
    throw new CustomError("One or more courses do not exist", 400);
  await Course.bulkWrite(
    ids.map((courseId, order) => ({
      updateOne: { filter: { _id: courseId }, update: { $set: { order } } },
    })),
  );
  return Course.find().sort({ order: 1 }).lean();
}

export async function listLessons(courseId: string) {
  requireObjectId(courseId, "courseId");
  if (!(await Course.exists({ _id: courseId })))
    throw new CustomError("Course not found", 404);
  return Lesson.find({ course: courseId })
    .sort({ order: 1, createdAt: 1 })
    .lean();
}

export async function getLesson(id: string) {
  requireObjectId(id);
  const lesson = await Lesson.findById(id).lean();
  if (!lesson) throw new CustomError("Lesson not found", 404);
  return lesson;
}

export async function createLesson(courseId: string, body: Body) {
  requireObjectId(courseId, "courseId");
  if (!(await Course.exists({ _id: courseId })))
    throw new CustomError("Course not found", 404);
  const input = contentInput(body, [
    "title",
    "slug",
    "summary",
    "content",
    "status",
    "order",
    "durationSeconds",
    "video",
    "thumbnail",
    "materials",
    "publishedAt",
  ]);
  if (!input.title) throw new CustomError("title is required", 400);
  if (!input.slug) input.slug = slugify(input.title as string);
  if (await Lesson.exists({ course: courseId, slug: input.slug }))
    throw new CustomError("Slug already exists in this course", 409);
  return Lesson.create({ ...input, course: courseId });
}

export async function updateLesson(id: string, body: Body) {
  requireObjectId(id);
  const lesson = await Lesson.findById(id);
  if (!lesson) throw new CustomError("Lesson not found", 404);
  const input = contentInput(
    body,
    [
      "title",
      "slug",
      "summary",
      "content",
      "status",
      "order",
      "durationSeconds",
      "video",
      "thumbnail",
      "materials",
      "publishedAt",
    ],
    lesson.slug,
  );
  if (
    input.slug &&
    (await Lesson.exists({
      course: lesson.course,
      slug: input.slug,
      _id: { $ne: id },
    }))
  ) {
    throw new CustomError("Slug already exists in this course", 409);
  }
  Object.assign(lesson, input);
  return lesson.save();
}

export async function deleteLesson(id: string) {
  requireObjectId(id);
  const lesson = await Lesson.findById(id);
  if (!lesson) throw new CustomError("Lesson not found", 404);
  await Promise.all([
    LessonProgress.deleteMany({ lesson: id }),
    LessonComment.deleteMany({ lesson: id }),
    lesson.deleteOne(),
  ]);
  await cleanupAssets([lesson.video, lesson.thumbnail, ...lesson.materials]);
  return { deleted: true };
}

export async function reorderLessons(courseId: string, lessonIds: unknown) {
  requireObjectId(courseId, "courseId");
  if (!Array.isArray(lessonIds) || lessonIds.length === 0)
    throw new CustomError("lessonIds is required", 400);
  const ids = lessonIds.map((id) => requireObjectId(id, "lessonId"));
  if (new Set(ids).size !== ids.length)
    throw new CustomError("lessonIds must be unique", 400);
  const count = await Lesson.countDocuments({
    _id: { $in: ids },
    course: courseId,
  });
  if (count !== ids.length)
    throw new CustomError(
      "One or more lessons do not belong to this course",
      400,
    );
  await Lesson.bulkWrite(
    ids.map((id, order) => ({
      updateOne: {
        filter: { _id: id, course: courseId },
        update: { $set: { order } },
      },
    })),
  );
  return Lesson.find({ course: courseId }).sort({ order: 1 }).lean();
}

export async function listCalendar(query: Body) {
  const { page, limit, skip } = pagination(query);
  const filter: Body = query.status ? { status: query.status } : {};
  const [events, total] = await Promise.all([
    CalendarEvent.find(filter)
      .sort({ startsAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CalendarEvent.countDocuments(filter),
  ]);
  return {
    events,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function createCalendarEvent(body: Body) {
  const input = contentInput(body, [
    "title",
    "description",
    "startsAt",
    "endsAt",
    "timezone",
    "meetingUrl",
    "status",
    "cover",
  ]);
  input.title = requireString(body.title, "title");
  const startsAt = asDate(body.startsAt, "startsAt");
  const endsAt = body.endsAt ? asDate(body.endsAt, "endsAt") : null;
  input.startsAt = startsAt;
  if (endsAt) input.endsAt = endsAt;
  if (endsAt && endsAt <= startsAt)
    throw new CustomError("endsAt must be after startsAt", 400);
  input.timezone =
    typeof body.timezone === "string" && body.timezone.trim()
      ? body.timezone.trim()
      : "UTC";
  input.meetingUrl =
    typeof body.meetingUrl === "string"
      ? body.meetingUrl.trim()
      : process.env.DEFAULT_MEETING_URL || "";
  return CalendarEvent.create(input);
}

export async function getCalendarEvent(id: string) {
  requireObjectId(id);
  const event = await CalendarEvent.findById(id).lean();
  if (!event) throw new CustomError("Calendar event not found", 404);
  return event;
}

export async function updateCalendarEvent(id: string, body: Body) {
  requireObjectId(id);
  const event = await CalendarEvent.findById(id);
  if (!event) throw new CustomError("Calendar event not found", 404);
  const input = contentInput(body, [
    "title",
    "description",
    "startsAt",
    "endsAt",
    "timezone",
    "meetingUrl",
    "status",
    "cover",
  ]);
  if (body.startsAt !== undefined)
    input.startsAt = asDate(body.startsAt, "startsAt");
  if (body.endsAt !== undefined)
    input.endsAt = body.endsAt === null ? null : asDate(body.endsAt, "endsAt");
  Object.assign(event, input);
  if (event.endsAt && event.endsAt <= event.startsAt)
    throw new CustomError("endsAt must be after startsAt", 400);
  return event.save();
}

export async function deleteCalendarEvent(id: string) {
  requireObjectId(id);
  const event = await CalendarEvent.findByIdAndDelete(id);
  if (!event) throw new CustomError("Calendar event not found", 404);
  await cleanupAssets([event.cover]);
  return { deleted: true };
}

export function getCalendarConfig() {
  return {
    defaultMeetingUrl: process.env.DEFAULT_MEETING_URL || "",
    defaultTimezone: process.env.DEFAULT_TIMEZONE || "UTC",
  };
}

export async function listRecipes(query: Body) {
  const { page, limit, skip } = pagination(query);
  const filter: Body = query.status ? { status: query.status } : {};
  const [recipes, total] = await Promise.all([
    Recipe.find(filter).sort({ order: 1 }).skip(skip).limit(limit).lean(),
    Recipe.countDocuments(filter),
  ]);
  return {
    recipes,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getRecipe(id: string) {
  requireObjectId(id);
  const recipe = await Recipe.findById(id).lean();
  if (!recipe) throw new CustomError("Recipe not found", 404);
  return recipe;
}

export async function createRecipe(body: Body) {
  const input = contentInput(body, [
    "title",
    "slug",
    "summary",
    "description",
    "ingredients",
    "instructions",
    "prepMinutes",
    "cookMinutes",
    "servings",
    "status",
    "order",
    "cover",
    "publishedAt",
  ]);
  if (!input.title) throw new CustomError("title is required", 400);
  if (!input.slug) input.slug = slugify(input.title as string);
  await ensureUniqueSlug(Recipe, input.slug);
  return Recipe.create(input);
}

export async function updateRecipe(id: string, body: Body) {
  requireObjectId(id);
  const recipe = await Recipe.findById(id);
  if (!recipe) throw new CustomError("Recipe not found", 404);
  const input = contentInput(
    body,
    [
      "title",
      "slug",
      "summary",
      "description",
      "ingredients",
      "instructions",
      "prepMinutes",
      "cookMinutes",
      "servings",
      "status",
      "order",
      "cover",
      "publishedAt",
    ],
    recipe.slug,
  );
  await ensureUniqueSlug(Recipe, input.slug, id);
  Object.assign(recipe, input);
  return recipe.save();
}

export async function deleteRecipe(id: string) {
  requireObjectId(id);
  const recipe = await Recipe.findByIdAndDelete(id);
  if (!recipe)
    throw new CustomError("Recipe not found", 404);
  await cleanupAssets([recipe.cover]);
  return { deleted: true };
}

export async function listAchievements(query: Body) {
  const { page, limit, skip } = pagination(query);
  const filter: Body = query.status ? { status: query.status } : {};
  const [achievements, total] = await Promise.all([
    Achievement.find(filter).sort({ order: 1 }).skip(skip).limit(limit).lean(),
    Achievement.countDocuments(filter),
  ]);
  return {
    achievements,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function createAchievement(body: Body) {
  const input = contentInput(body, [
    "title",
    "slug",
    "description",
    "status",
    "order",
    "icon",
  ]);
  if (!input.title) throw new CustomError("title is required", 400);
  if (!input.slug) input.slug = slugify(input.title as string);
  await ensureUniqueSlug(Achievement, input.slug);
  return Achievement.create(input);
}

export async function getAchievement(id: string) {
  requireObjectId(id);
  const achievement = await Achievement.findById(id).lean();
  if (!achievement) throw new CustomError("Achievement not found", 404);
  return achievement;
}

export async function updateAchievement(id: string, body: Body) {
  requireObjectId(id);
  const achievement = await Achievement.findById(id);
  if (!achievement) throw new CustomError("Achievement not found", 404);
  const input = contentInput(
    body,
    ["title", "slug", "description", "status", "order", "icon"],
    achievement.slug,
  );
  await ensureUniqueSlug(Achievement, input.slug, id);
  Object.assign(achievement, input);
  return achievement.save();
}

export async function deleteAchievement(id: string) {
  requireObjectId(id);
  const achievement = await Achievement.findByIdAndDelete(id);
  if (!achievement)
    throw new CustomError("Achievement not found", 404);
  await UserAchievement.deleteMany({ achievement: id });
  await cleanupAssets([achievement.icon]);
  return { deleted: true };
}

export async function awardAchievement(achievementId: string, body: Body) {
  requireObjectId(achievementId, "achievementId");
  const userId = requireObjectId(body.userId, "userId");
  const [achievement, user] = await Promise.all([
    Achievement.exists({ _id: achievementId }),
    User.exists({ _id: userId }),
  ]);
  if (!achievement) throw new CustomError("Achievement not found", 404);
  if (!user) throw new CustomError("User not found", 404);
  return UserAchievement.findOneAndUpdate(
    { achievement: achievementId, user: userId },
    {
      $set: {
        notes: typeof body.notes === "string" ? body.notes.trim() : "",
        awardedAt: new Date(),
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).populate("achievement");
}

export async function revokeAchievement(achievementId: string, userId: string) {
  requireObjectId(achievementId, "achievementId");
  requireObjectId(userId, "userId");
  await UserAchievement.deleteOne({ achievement: achievementId, user: userId });
  return { deleted: true };
}

export async function listComments(query: Body) {
  const { page, limit, skip } = pagination(query);
  const filter: Body = {};
  if (query.status) filter.status = query.status;
  if (query.lessonId)
    filter.lesson = requireObjectId(query.lessonId, "lessonId");
  const [comments, total] = await Promise.all([
    LessonComment.find(filter)
      .populate("user", "name lastName profilePicture")
      .populate("lesson", "title course")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    LessonComment.countDocuments(filter),
  ]);
  return {
    comments,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function moderateComment(
  id: string,
  status: unknown,
  adminId: string,
) {
  requireObjectId(id);
  if (status !== "published" && status !== "rejected" && status !== "pending")
    throw new CustomError("Invalid comment status", 400);
  const comment = await LessonComment.findByIdAndUpdate(
    id,
    { status, moderatedBy: adminId, moderatedAt: new Date() },
    { new: true },
  );
  if (!comment) throw new CustomError("Comment not found", 404);
  return comment;
}

export async function deleteComment(id: string) {
  requireObjectId(id);
  if (!(await LessonComment.findByIdAndDelete(id)))
    throw new CustomError("Comment not found", 404);
  return { deleted: true };
}
