import dotenv from "dotenv";
import { dbConnect } from "../config/mongo";
import mongoose from "mongoose";
import { Course } from "../models/Course";
import { Lesson } from "../models/Lesson";
import * as bunny from "../services/bunnyStream.service";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

async function main() {
  console.log("🔌 Connecting to MongoDB (Luisa Pita Bejarano)...");
  await dbConnect();
  console.log("✅ Connected");

  const course = await Course.findOne({ slug: "estrategias-crecimiento-marketing-ventas" });
  if (!course) {
    console.log("⚠️  Course not found, nothing to delete");
    process.exit(0);
  }

  console.log(`🗑️  Deleting course: ${course.title}`);
  const lessons = await Lesson.find({ course: course._id });
  console.log(`   Found ${lessons.length} lessons`);

  for (const lesson of lessons) {
    if (lesson.video?.provider === "bunny" && lesson.video?.publicId) {
      console.log(`   🗑️  Deleting Bunny video: ${lesson.video.publicId}`);
      await bunny.deleteVideo(lesson.video.publicId).catch(console.error);
    }
    await Lesson.deleteOne({ _id: lesson._id });
  }

  await Course.deleteOne({ _id: course._id });
  console.log("✅ Course and all lessons deleted from Luisa Pita Bejarano Academy");

  await mongoose.connection.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
