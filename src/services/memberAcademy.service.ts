import { Course } from "../models/Course";
import { Lesson } from "../models/Lesson";
import { LessonProgress } from "../models/LessonProgress";
import { CalendarEvent } from "../models/CalendarEvent";
import { Recipe } from "../models/Recipe";
import { Achievement } from "../models/Achievement";
import { UserAchievement } from "../models/UserAchievement";
import { LessonComment } from "../models/LessonComment";
import { RecordedClass } from "../models/RecordedClass";
import { CustomError } from "../errors/customError.error";
import {
  pagination,
  requireObjectId,
  requireString,
} from "../helpers/validation.helper";
import { Types } from "mongoose";
import { cloudinary } from "../config/cloudinary";
import { IMediaAsset } from "../models/content.shared";
import { createDelivery as createBunnyDelivery } from "./bunnyStream.service";

type Query = Record<string, unknown>;

function withDeliveryUrl<T extends IMediaAsset | null | undefined>(asset: T) {
  if (!asset) return asset;
  if (asset.provider === "bunny")
    return { ...asset, deliveryUrl: createBunnyDelivery(asset.publicId).url };
  return {
    ...asset,
    deliveryUrl: cloudinary.url(asset.publicId, {
      resource_type: asset.resourceType,
      type: "authenticated",
      format: asset.format,
      sign_url: true,
      secure: true,
    }),
  };
}

export async function listCourses(userId: string) {
  const courses = await Course.find({ status: "published" })
    .sort({ order: 1, publishedAt: -1 })
    .lean();
  const courseIds = courses.map((course) => course._id);
  const [lessonCounts, completedCounts] = await Promise.all([
    Lesson.aggregate<{ _id: unknown; total: number }>([
      { $match: { course: { $in: courseIds }, status: "published" } },
      { $group: { _id: "$course", total: { $sum: 1 } } },
    ]),
    LessonProgress.aggregate<{ _id: unknown; completed: number }>([
      {
        $match: {
          user: new Types.ObjectId(requireObjectId(userId, "userId")),
          course: { $in: courseIds },
          completed: true,
        },
      },
      { $group: { _id: "$course", completed: { $sum: 1 } } },
    ]),
  ]);
  const totals = new Map(
    lessonCounts.map((item) => [String(item._id), item.total]),
  );
  const completed = new Map(
    completedCounts.map((item) => [String(item._id), item.completed]),
  );
  return courses.map((course) => {
    const totalLessons = totals.get(String(course._id)) || 0;
    const completedLessons = completed.get(String(course._id)) || 0;
    return {
      ...course,
      cover: withDeliveryUrl(course.cover),
      progress: {
        totalLessons,
        completedLessons,
        percent: totalLessons
          ? Math.round((completedLessons * 100) / totalLessons)
          : 0,
      },
    };
  });
}

export async function getCourse(identifier: string, userId: string) {
  const filter = /^[a-f\d]{24}$/i.test(identifier)
    ? { _id: identifier, status: "published" }
    : { slug: identifier, status: "published" };
  const course = await Course.findOne(filter).lean();
  if (!course) throw new CustomError("Course not found", 404);
  const [lessons, progress] = await Promise.all([
    Lesson.find({ course: course._id, status: "published" })
      .select("title slug summary order durationSeconds thumbnail publishedAt")
      .sort({ order: 1 })
      .lean(),
    LessonProgress.find({ course: course._id, user: userId }).lean(),
  ]);
  const byLesson = new Map(progress.map((item) => [String(item.lesson), item]));
  const lessonsWithProgress = lessons.map((lesson) => ({
    ...lesson,
    thumbnail: withDeliveryUrl(lesson.thumbnail),
    progress: byLesson.get(String(lesson._id)) || null,
  }));
  const completedLessons = progress.filter(
    (item) =>
      item.completed &&
      lessons.some((lesson) => String(lesson._id) === String(item.lesson)),
  ).length;
  return {
    ...course,
    cover: withDeliveryUrl(course.cover),
    lessons: lessonsWithProgress,
    progress: {
      totalLessons: lessons.length,
      completedLessons,
      percent: lessons.length
        ? Math.round((completedLessons * 100) / lessons.length)
        : 0,
    },
  };
}

export async function getLesson(id: string, userId: string) {
  requireObjectId(id);
  const lesson = await Lesson.findOne({ _id: id, status: "published" }).lean();
  if (
    !lesson ||
    !(await Course.exists({ _id: lesson.course, status: "published" }))
  )
    throw new CustomError("Lesson not found", 404);
  const progress = await LessonProgress.findOne({
    lesson: id,
    user: userId,
  }).lean();
  return {
    ...lesson,
    video: withDeliveryUrl(lesson.video),
    thumbnail: withDeliveryUrl(lesson.thumbnail),
    materials: lesson.materials.map((material) => withDeliveryUrl(material)),
    progress: progress || null,
  };
}

export async function updateProgress(
  lessonId: string,
  userId: string,
  body: Query,
) {
  requireObjectId(lessonId, "lessonId");
  const lesson = await Lesson.findOne({ _id: lessonId, status: "published" });
  if (
    !lesson ||
    !(await Course.exists({ _id: lesson.course, status: "published" }))
  )
    throw new CustomError("Lesson not found", 404);
  const current = await LessonProgress.findOne({
    lesson: lessonId,
    user: userId,
  });
  const watchedSeconds = Math.max(
    current?.watchedSeconds || 0,
    Math.max(0, Number(body.watchedSeconds) || 0),
  );
  const lastPositionSeconds = Math.max(
    0,
    Math.min(lesson.durationSeconds || Infinity, Number(body.lastPositionSeconds) || 0),
  );
  const calculatedPercent =
    lesson.durationSeconds > 0
      ? (watchedSeconds * 100) / lesson.durationSeconds
      : 0;
  const percent = Math.min(
    100,
    Math.max(
      current?.percent || 0,
      Number(body.percent) || 0,
      calculatedPercent,
    ),
  );
  const manualCompletion =
    typeof body.completed === "boolean"
      ? body.completed
      : current?.manualCompletion ?? null;
  const completed =
    manualCompletion === null
      ? Boolean(current?.completed || percent >= 80)
      : manualCompletion;
  const progress = await LessonProgress.findOneAndUpdate(
    { lesson: lessonId, user: userId },
    {
      $set: {
        course: lesson.course,
        watchedSeconds,
        lastPositionSeconds,
        percent: Math.round(percent * 100) / 100,
        completed,
        manualCompletion,
        completedAt: completed ? current?.completedAt || new Date() : null,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  const aggregate = await getCourseProgress(String(lesson.course), userId);
  return { progress, courseProgress: aggregate };
}

export async function getCourseProgress(courseId: string, userId: string) {
  requireObjectId(courseId, "courseId");
  const lessonIds = await Lesson.find({
    course: courseId,
    status: "published",
  }).distinct("_id");
  const progress = await LessonProgress.find({
    course: courseId,
    user: userId,
    lesson: { $in: lessonIds },
  }).lean();
  const completedLessons = progress.filter((item) => item.completed).length;
  return {
    courseId,
    totalLessons: lessonIds.length,
    completedLessons,
    percent: lessonIds.length
      ? Math.round((completedLessons * 100) / lessonIds.length)
      : 0,
    lessons: progress,
  };
}

export async function listCalendar(query: Query) {
  const { page, limit, skip } = pagination(query);
  const filter: Query = { status: "published" };
  if (query.from || query.to) {
    filter.startsAt = {
      ...(query.from ? { $gte: new Date(String(query.from)) } : {}),
      ...(query.to ? { $lte: new Date(String(query.to)) } : {}),
    };
  }
  const [events, total] = await Promise.all([
    CalendarEvent.find(filter)
      .sort({ startsAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    CalendarEvent.countDocuments(filter),
  ]);
  return {
    events: events.map((event) => ({
      ...event,
      cover: withDeliveryUrl(event.cover),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getCalendarEvent(id: string) {
  requireObjectId(id);
  const event = await CalendarEvent.findOne({
    _id: id,
    status: "published",
  }).lean();
  if (!event) throw new CustomError("Calendar event not found", 404);
  return { ...event, cover: withDeliveryUrl(event.cover) };
}

export async function listRecipes(query: Query) {
  const { page, limit, skip } = pagination(query);
  const [recipes, total] = await Promise.all([
    Recipe.find({ status: "published" })
      .sort({ order: 1, publishedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Recipe.countDocuments({ status: "published" }),
  ]);
  return {
    recipes: recipes.map((recipe) => ({
      ...recipe,
      cover: withDeliveryUrl(recipe.cover),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getRecipe(identifier: string) {
  const filter = /^[a-f\d]{24}$/i.test(identifier)
    ? { _id: identifier, status: "published" }
    : { slug: identifier, status: "published" };
  const recipe = await Recipe.findOne(filter).lean();
  if (!recipe) throw new CustomError("Recipe not found", 404);
  return { ...recipe, cover: withDeliveryUrl(recipe.cover) };
}

export async function listAchievements(userId: string) {
  const [achievements, earned] = await Promise.all([
    Achievement.find({ status: "published" }).sort({ order: 1 }).lean(),
    UserAchievement.find({ user: userId }).lean(),
  ]);
  const byAchievement = new Map(
    earned.map((item) => [String(item.achievement), item]),
  );
  return achievements.map((achievement) => ({
    ...achievement,
    icon: withDeliveryUrl(achievement.icon),
    earned: byAchievement.get(String(achievement._id)) || null,
  }));
}

export async function getAchievement(id: string, userId: string) {
  requireObjectId(id);
  const achievement = await Achievement.findOne({
    _id: id,
    status: "published",
  }).lean();
  if (!achievement) throw new CustomError("Achievement not found", 404);
  const earned = await UserAchievement.findOne({
    achievement: id,
    user: userId,
  }).lean();
  return {
    ...achievement,
    icon: withDeliveryUrl(achievement.icon),
    earned: earned || null,
  };
}

export async function listComments(
  lessonId: string,
  userId: string,
  query: Query,
) {
  requireObjectId(lessonId, "lessonId");
  const lesson = await Lesson.findOne({ _id: lessonId, status: "published" })
    .select("course")
    .lean();
  if (
    !lesson ||
    !(await Course.exists({ _id: lesson.course, status: "published" }))
  )
    throw new CustomError("Lesson not found", 404);
  const { page, limit, skip } = pagination(query);
  const filter = {
    lesson: lessonId,
    $or: [{ status: "published" }, { user: userId }],
  };
  const [comments, total] = await Promise.all([
    LessonComment.find(filter)
      .populate("user", "name lastName profilePicture")
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

export async function createComment(
  lessonId: string,
  userId: string,
  body: unknown,
) {
  requireObjectId(lessonId, "lessonId");
  const lesson = await Lesson.findOne({ _id: lessonId, status: "published" })
    .select("course")
    .lean();
  if (
    !lesson ||
    !(await Course.exists({ _id: lesson.course, status: "published" }))
  )
    throw new CustomError("Lesson not found", 404);
  return LessonComment.create({
    lesson: lessonId,
    user: userId,
    body: requireString(body, "body"),
  });
}

export async function updateComment(id: string, userId: string, body: unknown) {
  requireObjectId(id);
  const comment = await LessonComment.findOneAndUpdate(
    { _id: id, user: userId },
    {
      body: requireString(body, "body"),
      status: "pending",
      moderatedBy: null,
      moderatedAt: null,
    },
    { new: true, runValidators: true },
  );
  if (!comment) throw new CustomError("Comment not found", 404);
  return comment;
}

export async function deleteComment(id: string, userId: string) {
  requireObjectId(id);
  if (!(await LessonComment.findOneAndDelete({ _id: id, user: userId })))
    throw new CustomError("Comment not found", 404);
  return { deleted: true };
}

// ── Recorded Classes ──────────────────────────────────────────────────────────

export async function listRecordedClasses(query: Query) {
  const { page, limit, skip } = pagination(query);
  const [classes, total] = await Promise.all([
    RecordedClass.find({ status: "published" })
      .sort({ classDate: -1 })
      .skip(skip)
      .limit(limit),
    RecordedClass.countDocuments({ status: "published" }),
  ]);
  return {
    classes,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getRecordedClass(id: string) {
  requireObjectId(id);
  const cls = await RecordedClass.findOne({ _id: id, status: "published" });
  if (!cls) throw new CustomError("Recorded class not found", 404);
  return cls;
}
