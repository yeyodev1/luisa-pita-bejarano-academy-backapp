import { cloudinary } from "../config/cloudinary";
import { CustomError } from "../errors/customError.error";
import { Course } from "../models/Course";
import { Lesson } from "../models/Lesson";
import { CalendarEvent } from "../models/CalendarEvent";
import { Recipe } from "../models/Recipe";
import { Achievement } from "../models/Achievement";

export type ResourceType = "image" | "video" | "raw";
const resourceTypes = new Set<ResourceType>(["image", "video", "raw"]);
const categories = new Set([
  "courses",
  "lessons",
  "materials",
  "calendar",
  "recipes",
  "achievements",
]);
const rootFolder = "academy/content";

function requireCloudinaryConfig() {
  if (
    !process.env.CLOUDINARY_CLOUD_NAME ||
    !process.env.CLOUDINARY_API_KEY ||
    !process.env.CLOUDINARY_API_SECRET
  ) {
    throw new CustomError("Cloudinary is not configured", 503);
  }
}

function parseResourceType(value: unknown): ResourceType {
  if (!resourceTypes.has(value as ResourceType))
    throw new CustomError("Invalid resourceType", 400);
  return value as ResourceType;
}

function assertOwnedPublicId(publicId: string) {
  if (!publicId.startsWith(`${rootFolder}/`))
    throw new CustomError("Asset is outside the academy folder", 403);
}

function normalize(resource: Record<string, unknown>) {
  return {
    publicId: resource.public_id,
    resourceType: resource.resource_type,
    format: resource.format,
    bytes: resource.bytes,
    width: resource.width,
    height: resource.height,
    duration: resource.duration,
    originalFilename: resource.original_filename,
    createdAt: resource.created_at,
  };
}

async function isReferenced(publicId: string, publishedOnly: boolean) {
  const status = publishedOnly ? { status: "published" } : {};
  const [course, lesson, calendar, recipe, achievement] = await Promise.all([
    Course.exists({ ...status, "cover.publicId": publicId }),
    Lesson.findOne({
      ...status,
      $or: [
        { "video.publicId": publicId },
        { "thumbnail.publicId": publicId },
        { "materials.publicId": publicId },
      ],
    })
      .select("course")
      .lean(),
    CalendarEvent.exists({ ...status, "cover.publicId": publicId }),
    Recipe.exists({ ...status, "cover.publicId": publicId }),
    Achievement.exists({ ...status, "icon.publicId": publicId }),
  ]);
  if (publishedOnly && lesson) {
    return Boolean(
      await Course.exists({ _id: lesson.course, status: "published" }),
    );
  }
  return Boolean(course || lesson || calendar || recipe || achievement);
}

export function createUploadSignature(
  resourceTypeValue: unknown,
  categoryValue: unknown,
) {
  requireCloudinaryConfig();
  const resourceType = parseResourceType(resourceTypeValue);
  const category =
    typeof categoryValue === "string" && categories.has(categoryValue)
      ? categoryValue
      : "materials";
  const folder = `${rootFolder}/${category}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const type = "authenticated";
  // The Upload Widget always submits source=uw and requires it in the signature.
  const params = { folder, source: "uw", timestamp, type };
  const signature = cloudinary.utils.api_sign_request(
    params,
    process.env.CLOUDINARY_API_SECRET as string,
  );
  return {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    resourceType,
    uploadUrl: `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`,
    params: { ...params, signature, api_key: process.env.CLOUDINARY_API_KEY },
  };
}

export async function confirmUpload(body: Record<string, unknown>) {
  requireCloudinaryConfig();
  const publicId = typeof body.publicId === "string" ? body.publicId : "";
  const resourceType = parseResourceType(body.resourceType);
  assertOwnedPublicId(publicId);

  try {
    const resource = await cloudinary.api.resource(publicId, {
      resource_type: resourceType,
      type: "authenticated",
    });
    if (resource.type !== "authenticated")
      throw new CustomError("Asset is not authenticated", 400);
    return normalize(resource as Record<string, unknown>);
  } catch (error) {
    if (error instanceof CustomError) throw error;
    throw new CustomError("Cloudinary asset could not be verified", 400);
  }
}

export async function deleteAsset(
  publicIdValue: unknown,
  resourceTypeValue: unknown,
) {
  requireCloudinaryConfig();
  const publicId = typeof publicIdValue === "string" ? publicIdValue : "";
  const resourceType = parseResourceType(resourceTypeValue);
  assertOwnedPublicId(publicId);
  if (await isReferenced(publicId, false))
    throw new CustomError(
      "Asset is still referenced by academy content. Save the content change first",
      409,
    );
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: resourceType,
    type: "authenticated",
    invalidate: true,
  });
  return { publicId, result: result.result };
}

export async function createDeliveryUrl(
  publicIdValue: unknown,
  resourceTypeValue: unknown,
) {
  requireCloudinaryConfig();
  const publicId = typeof publicIdValue === "string" ? publicIdValue : "";
  const resourceType = parseResourceType(resourceTypeValue);
  assertOwnedPublicId(publicId);
  if (!(await isReferenced(publicId, true)))
    throw new CustomError("Published asset not found", 404);
  return {
    publicId,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    url: cloudinary.url(publicId, {
      resource_type: resourceType,
      type: "authenticated",
      sign_url: true,
      secure: true,
    }),
  };
}
