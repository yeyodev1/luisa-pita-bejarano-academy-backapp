import { createHash } from "crypto";
import { CustomError } from "../errors/customError.error";
import { Lesson } from "../models/Lesson";
import { Course } from "../models/Course";

interface BunnyVideo {
  guid: string;
  title: string;
  status: number;
  encodeProgress: number;
  length: number;
  width: number;
  height: number;
  storageSize: number;
  dateUploaded: string;
}

const apiBase = "https://video.bunnycdn.com";
const videoIdPattern = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;

function config() {
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const apiKey = process.env.BUNNY_STREAM_API_KEY;
  if (!libraryId || !apiKey)
    throw new CustomError("Bunny Stream is not configured", 503);
  return { libraryId, apiKey };
}

function requireVideoId(value: unknown) {
  if (typeof value !== "string" || !videoIdPattern.test(value))
    throw new CustomError("Invalid Bunny video ID", 400);
  return value;
}

async function request<T>(path: string, options: RequestInit = {}) {
  const { libraryId, apiKey } = config();
  const response = await fetch(`${apiBase}/library/${libraryId}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      AccessKey: apiKey,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const details = await response.text();
    console.error("Bunny Stream request failed", response.status, details);
    if (response.status === 404) throw new CustomError("Bunny video not found", 404);
    throw new CustomError("Bunny Stream request failed", 502);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

export async function createUpload(titleValue: unknown) {
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  if (!title) throw new CustomError("title is required", 400);
  const { libraryId, apiKey } = config();
  const video = await request<BunnyVideo>("/videos", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  const expirationTime = Math.floor(Date.now() / 1000) + 86400;
  const signature = createHash("sha256")
    .update(`${libraryId}${apiKey}${expirationTime}${video.guid}`)
    .digest("hex");
  return {
    videoId: video.guid,
    libraryId,
    expirationTime,
    signature,
    uploadUrl: `${apiBase}/tusupload`,
  };
}

export async function getVideo(videoIdValue: unknown) {
  const videoId = requireVideoId(videoIdValue);
  return request<BunnyVideo>(`/videos/${videoId}`);
}

export async function confirmUpload(videoIdValue: unknown, body: Record<string, unknown>) {
  const video = await getVideo(videoIdValue);
  if (video.status !== 4 && video.status !== 8)
    throw new CustomError("Bunny video is not ready for playback", 409);
  return {
    provider: "bunny" as const,
    publicId: video.guid,
    resourceType: "video" as const,
    format: "m3u8",
    bytes: video.storageSize || Math.max(0, Number(body.bytes) || 0),
    width: video.width || undefined,
    height: video.height || undefined,
    duration: video.length || Math.max(0, Number(body.duration) || 0),
    originalFilename:
      typeof body.originalFilename === "string" ? body.originalFilename.trim() : video.title,
    createdAt: video.dateUploaded,
  };
}

export async function deleteVideo(videoIdValue: unknown) {
  const videoId = requireVideoId(videoIdValue);
  if (await Lesson.exists({ "video.publicId": videoId, "video.provider": "bunny" }))
    throw new CustomError(
      "Asset is still referenced by academy content. Save the content change first",
      409,
    );
  await request(`/videos/${videoId}`, { method: "DELETE" });
  return { publicId: videoId, result: "deleted" };
}

export function createDelivery(videoIdValue: unknown) {
  const videoId = requireVideoId(videoIdValue);
  const { libraryId } = config();
  const tokenKey = process.env.BUNNY_STREAM_TOKEN_AUTH_KEY;
  if (!tokenKey)
    throw new CustomError("Bunny Stream embed token authentication is not configured", 503);
  const expires = Math.floor(Date.now() / 1000) + 14400;
  const token = createHash("sha256")
    .update(`${tokenKey}${videoId}${expires}`)
    .digest("hex");
  return {
    provider: "bunny" as const,
    publicId: videoId,
    url: `https://iframe.mediadelivery.net/embed/${libraryId}/${videoId}?token=${token}&expires=${expires}&preload=true&responsive=true`,
  };
}

export async function createAuthorizedDelivery(videoIdValue: unknown) {
  const videoId = requireVideoId(videoIdValue);
  const lesson = await Lesson.findOne({
    status: "published",
    "video.publicId": videoId,
    "video.provider": "bunny",
  })
    .select("course")
    .lean();
  if (!lesson || !(await Course.exists({ _id: lesson.course, status: "published" })))
    throw new CustomError("Published asset not found", 404);
  return createDelivery(videoId);
}
