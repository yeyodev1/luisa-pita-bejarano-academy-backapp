import dotenv from "dotenv";
import { dbConnect } from "../config/mongo";
import mongoose from "mongoose";
import { Course } from "../models/Course";
import { Lesson } from "../models/Lesson";
import { createHash } from "crypto";
import fs from "fs";
import path from "path";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const COURSE_DIR = "/Users/diegoreyes/Documents/cursos/bakano/marketing";
const COURSE_TITLE = "Estrategias de Crecimiento en Marketing y Ventas";
const COURSE_SLUG = "estrategias-crecimiento-marketing-ventas";
const COURSE_SUMMARY =
  "Curso fundamental sobre estrategias de crecimiento en marketing y ventas para pequeñas y medianas empresas.";
const COURSE_DESCRIPTION = `Este curso trata fundamentalmente sobre Estrategias de Crecimiento en Marketing y Ventas para pequeñas y medianas empresas (aquellas que facturan menos de un millón de dólares mensuales).

Los temas clave que se abordarán en el curso son:

**Diferenciación de roles:** Entender exactamente qué es marketing, qué son las ventas y en qué se diferencian.

**Enfoque de esfuerzos:** Aprender cuánta energía y recursos destinar a cada una de estas áreas.

**Estrategia de crecimiento:** Cómo dejar de ser un "desconocido" para el mercado masivo, captar la atención de quienes necesitan comprarte y conectar esos esfuerzos directamente con el aumento de la facturación de tu negocio para llevarlo al "siguiente nivel".`;

const LESSON_TITLES = [
  "Introducción al curso: Marketing vs Ventas",
  "Clase 2: Diferenciación de roles - Qué es marketing",
  "Clase 3: Qué son las ventas y cómo se diferencian del marketing",
  "Clase 4: Enfoque de esfuerzos - Energía y recursos",
  "Clase 5: Estrategia de crecimiento - De desconocido a reconocido",
  "Clase 6: Captar la atención del mercado masivo",
  "Clase 7: Conectar con quienes necesitan comprarte",
  "Clase 8: Aumentar la facturación de tu negocio",
  "Clase 9: Llevar tu negocio al siguiente nivel",
  "Clase 10: Conclusión y próximos pasos",
];

const BUNNY_API_KEY = process.env.BUNNY_STREAM_API_KEY;
const BUNNY_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID;

if (!BUNNY_API_KEY || !BUNNY_LIBRARY_ID) {
  console.error("BUNNY_STREAM_API_KEY and BUNNY_STREAM_LIBRARY_ID are required");
  process.exit(1);
}

async function bunnyRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}${endpoint}`, {
    ...options,
    headers: {
      Accept: "application/json",
      AccessKey: BUNNY_API_KEY!,
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    console.error(`Bunny API error: ${response.status}`, text);
    throw new Error(`Bunny API ${response.status}: ${text}`);
  }

  return response.status === 204 ? (null as T) : response.json();
}

async function uploadVideo(filePath: string, title: string) {
  const fileBuffer = fs.readFileSync(filePath);
  const fileSize = fileBuffer.length;

  // Step 1: Create video entry
  console.log("   📝 Creating video entry...");
  const video = await bunnyRequest<{ guid: string }>(`/videos`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });

  const videoId = video.guid;
  console.log(`   Video ID: ${videoId}`);

  // Step 2: Upload file using direct upload endpoint
  console.log("   📤 Uploading file to Bunny Stream...");
  const uploadResponse = await fetch(
    `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${videoId}`,
    {
      method: "PUT",
      headers: {
        AccessKey: BUNNY_API_KEY!,
        "Content-Type": "video/mp4",
        "Content-Length": String(fileSize),
      },
      body: fileBuffer,
    }
  );

  if (!uploadResponse.ok) {
    const error = await uploadResponse.text();
    throw new Error(`Upload failed: ${uploadResponse.status} - ${error}`);
  }

  console.log("   ⏳ Waiting for processing...");

  // Step 3: Wait for processing
  let attempts = 0;
  const maxAttempts = 120; // 10 minutes max
  while (attempts < maxAttempts) {
    await new Promise((r) => setTimeout(r, 5000));
    const videoInfo = await bunnyRequest<{
      status: number;
      encodeProgress: number;
      length: number;
      storageSize: number;
      width: number;
      height: number;
      dateUploaded: string;
    }>(`/videos/${videoId}`);

    console.log(`   Progress: ${videoInfo.encodeProgress}% (status: ${videoInfo.status})`);

    if (videoInfo.status === 4 || videoInfo.status === 8) {
      console.log(`   ✅ Video processed!`);
      return {
        provider: "bunny" as const,
        publicId: videoId,
        resourceType: "video" as const,
        format: "m3u8",
        bytes: videoInfo.storageSize || fileSize,
        width: videoInfo.width || undefined,
        height: videoInfo.height || undefined,
        duration: videoInfo.length || 0,
        originalFilename: path.basename(filePath),
        createdAt: videoInfo.dateUploaded,
      };
    }

    if (videoInfo.status === 5 || videoInfo.status === 6) {
      throw new Error("Video processing failed");
    }

    attempts++;
  }

  throw new Error("Video processing timeout");
}

async function main() {
  console.log("🔌 Connecting to MongoDB...");
  await dbConnect();
  console.log("✅ Connected to MongoDB");

  // Check if course exists
  let course = await Course.findOne({ slug: COURSE_SLUG });
  if (course) {
    console.log(`⚠️  Course already exists: ${course._id}`);
    console.log("🗑️  Deleting existing course and lessons...");
    const lessons = await Lesson.find({ course: course._id });
    for (const lesson of lessons) {
      if (lesson.video?.provider === "bunny" && lesson.video?.publicId) {
        console.log(`  🗑️  Deleting video: ${lesson.video.publicId}`);
        await bunnyRequest(`/videos/${lesson.video.publicId}`, { method: "DELETE" }).catch(
          console.error
        );
      }
      await Lesson.deleteOne({ _id: lesson._id });
    }
    await Course.deleteOne({ _id: course._id });
    console.log("✅ Existing course deleted");
  }

  // Create course
  console.log("\n📚 Creating course...");
  course = await Course.create({
    title: COURSE_TITLE,
    slug: COURSE_SLUG,
    summary: COURSE_SUMMARY,
    description: COURSE_DESCRIPTION,
    status: "published",
    order: 0,
    publishedAt: new Date(),
  });
  console.log(`✅ Course created: ${course._id}`);

  // Get video files sorted
  const files = fs
    .readdirSync(COURSE_DIR)
    .filter((f) => f.endsWith(".mp4"))
    .sort((a, b) => {
      // Sort by number in filename
      const numA = parseInt(a.match(/\d+/)?.[0] || "0");
      const numB = parseInt(b.match(/\d+/)?.[0] || "0");
      return numA - numB;
    });

  // Check existing lessons
  const existingLessons = await Lesson.find({ course: course!._id });
  const startIndex = existingLessons.length;

  console.log(`\n📁 Found ${files.length} video files`);
  console.log(`📚 Already uploaded: ${startIndex} lessons`);

  // Upload remaining videos
  for (let i = startIndex; i < files.length; i++) {
    const file = files[i];
    const lessonTitle = LESSON_TITLES[i] || `Clase ${i + 1}`;
    const fullPath = path.join(COURSE_DIR, file);

    console.log(`\n🎬 [${i + 1}/${files.length}] ${file}`);
    console.log(`   Title: ${lessonTitle}`);

    try {
      const asset = await uploadVideo(fullPath, `${lessonTitle} - ${COURSE_TITLE}`);

      // Create lesson
      const lesson = await Lesson.create({
        course: course!._id,
        title: lessonTitle,
        slug: `clase-${i + 1}`,
        summary: lessonTitle,
        content: "",
        status: "published",
        order: i,
        durationSeconds: asset.duration,
        video: asset,
        publishedAt: new Date(),
      });

      console.log(`   ✅ Lesson created: ${lesson._id}`);
    } catch (error) {
      console.error(`   ❌ Failed: ${error}`);
    }
  }

  console.log("\n🎉 All done!");
  console.log(`📚 Course ID: ${course?._id}`);
  console.log(`🔗 Admin URL: /admin/courses`);

  await mongoose.connection.close();
  console.log("👋 Disconnected from MongoDB");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
