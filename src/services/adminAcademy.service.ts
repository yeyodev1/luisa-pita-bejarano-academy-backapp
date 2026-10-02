import { Course } from "../models/Course";
import { Lesson } from "../models/Lesson";
import { LessonProgress } from "../models/LessonProgress";
import { CalendarEvent } from "../models/CalendarEvent";
import { Recipe } from "../models/Recipe";
import { Achievement } from "../models/Achievement";
import { UserAchievement } from "../models/UserAchievement";
import { LessonComment } from "../models/LessonComment";
import { User } from "../models/User";
import { RecordedClass } from "../models/RecordedClass";
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
import {
  announceRecipe,
  announceRecordedClass,
} from "./contentAnnouncement.service";
import { cloudinary } from "../config/cloudinary";
import { IMediaAsset } from "../models/content.shared";

type Body = Record<string, unknown>;
type Query = Record<string, unknown>;
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

// ── Cursos y clases: validación en español y publishedAt estable ─────────────

/** Valida el título antes de contentInput para devolver mensajes claros. */
function assertTitle(body: Body, label: "curso" | "clase", required: boolean) {
  if (body.title === undefined && !required) return;
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title)
    throw new CustomError(
      label === "curso"
        ? "Escribe el nombre del curso."
        : "Escribe el título de la clase.",
      400,
    );
  if (!body.slug && !slugify(title))
    throw new CustomError(
      `El ${label === "curso" ? "nombre del curso" : "título de la clase"} debe tener al menos una letra o un número.`,
      400,
    );
}

/** publishedAt = la primera vez que se publica, no en cada guardado. */
function firstPublishedAt(
  input: Body,
  existing?: { status?: string; publishedAt?: Date | null },
) {
  if (
    input.status === "published" &&
    existing?.status !== "published" &&
    !existing?.publishedAt
  )
    input.publishedAt = new Date();
}

const COURSE_FIELDS = [
  "title",
  "slug",
  "summary",
  "description",
  "status",
  "order",
  "cover",
];

const LESSON_FIELDS = [
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
];

async function ensureUniqueCourseSlug(slug: unknown, excludeId?: string) {
  try {
    await ensureUniqueSlug(Course, slug, excludeId);
  } catch {
    throw new CustomError(
      "Ya existe un curso con ese nombre. Usa un nombre distinto.",
      409,
    );
  }
}

/** Dos clases con el mismo título en un curso: se numera la URL en vez de fallar. */
async function availableLessonSlug(
  courseId: unknown,
  base: string,
  excludeId?: string,
) {
  let slug = base;
  for (let n = 2; ; n += 1) {
    const query: Body = { course: courseId, slug };
    if (excludeId) query._id = { $ne: excludeId };
    if (!(await Lesson.exists(query))) return slug;
    slug = `${base}-${n}`;
  }
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
    // El admin ve la portada aunque el curso siga en borrador.
    courses: courses.map((c) => ({ ...c, cover: coverPreview(c.cover) })),
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
  return { ...course, cover: coverPreview(course.cover), lessons };
}

export async function createCourse(body: Body) {
  assertTitle(body, "curso", true);
  const input = contentInput(body, COURSE_FIELDS);
  if (!input.slug) input.slug = slugify(input.title as string);
  await ensureUniqueCourseSlug(input.slug);
  firstPublishedAt(input);
  return Course.create(input);
}

export async function updateCourse(id: string, body: Body) {
  requireObjectId(id);
  const course = await Course.findById(id);
  if (!course) throw new CustomError("Course not found", 404);
  assertTitle(body, "curso", false);
  const input = contentInput(body, COURSE_FIELDS, course.slug);
  await ensureUniqueCourseSlug(input.slug, id);
  firstPublishedAt(input, course);
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
  assertTitle(body, "clase", true);
  const input = contentInput(body, LESSON_FIELDS);
  input.slug = await availableLessonSlug(
    courseId,
    (input.slug as string) || slugify(input.title as string),
  );
  firstPublishedAt(input);
  return Lesson.create({ ...input, course: courseId });
}

export async function updateLesson(id: string, body: Body) {
  requireObjectId(id);
  const lesson = await Lesson.findById(id);
  if (!lesson) throw new CustomError("Lesson not found", 404);
  assertTitle(body, "clase", false);
  const input = contentInput(body, LESSON_FIELDS, lesson.slug);
  if (input.slug)
    input.slug = await availableLessonSlug(
      lesson.course,
      input.slug as string,
      id,
    );
  firstPublishedAt(input, lesson);
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

// El admin necesita ver la portada aunque la receta siga en borrador.
function coverPreview(cover: IMediaAsset | null | undefined) {
  if (!cover || cover.provider === "bunny") return cover;
  return {
    ...cover,
    deliveryUrl: cloudinary.url(cover.publicId, {
      resource_type: cover.resourceType,
      type: "authenticated",
      format: cover.format,
      sign_url: true,
      secure: true,
      transformation: [{ width: 800, crop: "limit" }],
    }),
  };
}

const RECIPE_FIELDS = [
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
];

async function ensureUniqueRecipeSlug(slug: unknown, excludeId?: string) {
  try {
    await ensureUniqueSlug(Recipe, slug, excludeId);
  } catch {
    throw new CustomError(
      "Ya existe una receta con ese título. Cambia un poco el título.",
      409,
    );
  }
}

/** Avisa por correo solo si se pidió y la receta quedó publicada. */
async function maybeAnnounceRecipe(
  recipe: { _id: unknown; status: string },
  body: Body,
) {
  if (body.notify === true && recipe.status === "published")
    await announceRecipe(String(recipe._id));
}

export async function listRecipes(query: Body) {
  const { page, limit, skip } = pagination(query);
  const filter: Body = query.status ? { status: query.status } : {};
  const [recipes, total] = await Promise.all([
    Recipe.find(filter)
      .sort({ order: 1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Recipe.countDocuments(filter),
  ]);
  return {
    recipes: recipes.map((r) => ({ ...r, cover: coverPreview(r.cover) })),
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
  if (typeof body.title !== "string" || !body.title.trim())
    throw new CustomError("Ponle un título a la receta.", 400);
  const input = contentInput(body, RECIPE_FIELDS);
  if (!input.slug) input.slug = slugify(input.title as string);
  await ensureUniqueRecipeSlug(input.slug);
  if (input.status === "published") input.publishedAt = new Date();
  const recipe = await Recipe.create(input);
  await maybeAnnounceRecipe(recipe, body);
  return recipe;
}

export async function updateRecipe(id: string, body: Body) {
  requireObjectId(id);
  const recipe = await Recipe.findById(id);
  if (!recipe) throw new CustomError("Recipe not found", 404);
  const wasPublished = recipe.status === "published";
  const input = contentInput(body, RECIPE_FIELDS, recipe.slug);
  await ensureUniqueRecipeSlug(input.slug, id);
  // La fecha de publicación es la primera vez que se publicó, no cada guardado.
  if (input.status === "published" && !wasPublished && !recipe.publishedAt)
    input.publishedAt = new Date();
  Object.assign(recipe, input);
  const saved = await recipe.save();
  await maybeAnnounceRecipe(saved, body);
  return saved;
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

// ── Recorded Classes ──────────────────────────────────────────────────────────

export async function listRecordedClasses(query: Query) {
  const { page, limit, skip } = pagination(query);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  const [classes, total] = await Promise.all([
    RecordedClass.find(filter).sort({ classDate: -1 }).skip(skip).limit(limit),
    RecordedClass.countDocuments(filter),
  ]);
  return {
    classes,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getRecordedClass(id: string) {
  requireObjectId(id);
  const cls = await RecordedClass.findById(id);
  if (!cls) throw new CustomError("Recorded class not found", 404);
  return cls;
}

export async function createRecordedClass(body: Body) {
  const title = requireString(body.title, "title");
  const recordingUrl = requireString(body.recordingUrl, "recordingUrl");
  const classDate = asDate(body.classDate, "classDate");
  const startsAt = requireString(body.startsAt ?? "06:00", "startsAt");
  const endsAt = requireString(body.endsAt ?? "07:00", "endsAt");
  const notesUrl =
    body.notesUrl !== undefined ? String(body.notesUrl).trim() : "";
  const status = (
    body.status &&
    (contentStatuses as readonly unknown[]).includes(body.status)
      ? body.status
      : "published"
  ) as "published" | "draft" | "archived";
  const cls = await RecordedClass.create({
    title,
    classDate,
    startsAt,
    endsAt,
    recordingUrl,
    notesUrl,
    status,
  });
  if (body.notify === true && cls.status === "published")
    await announceRecordedClass(String(cls._id));
  return cls;
}

export async function updateRecordedClass(id: string, body: Body) {
  requireObjectId(id);
  const allowed = [
    "title",
    "classDate",
    "startsAt",
    "endsAt",
    "recordingUrl",
    "notesUrl",
    "status",
  ];
  const update = pick(body, allowed);
  if (update.title !== undefined) update.title = requireString(update.title, "title");
  if (update.recordingUrl !== undefined) update.recordingUrl = requireString(update.recordingUrl, "recordingUrl");
  if (update.classDate !== undefined) update.classDate = asDate(update.classDate, "classDate");
  if (
    update.status !== undefined &&
    !(contentStatuses as readonly unknown[]).includes(update.status)
  ) throw new CustomError("Invalid status", 400);
  if (update.status !== undefined)
    update.status = update.status as "published" | "draft" | "archived";
  const cls = await RecordedClass.findByIdAndUpdate(id, update, { new: true, runValidators: true });
  if (!cls) throw new CustomError("Recorded class not found", 404);
  if (body.notify === true && cls.status === "published")
    await announceRecordedClass(String(cls._id));
  return cls;
}

export async function deleteRecordedClass(id: string) {
  requireObjectId(id);
  if (!(await RecordedClass.findByIdAndDelete(id)))
    throw new CustomError("Recorded class not found", 404);
  return { deleted: true };
}
