import { RecordedClass } from "../models/RecordedClass";

// Clase del martes 21 de julio de 2026, 6:00 am – 7:00 am hora Ecuador (UTC-5)
// 6:00 am ECT = 11:00 am UTC
const SEED_CLASSES = [
  {
    title: "Clase de Luisa Pita Bejarano — Martes 21 de julio",
    classDate: new Date("2026-07-21T11:00:00.000Z"), // 6:00 AM Ecuador
    startsAt: "06:00",
    endsAt: "07:00",
    recordingUrl:
      "https://drive.google.com/file/d/1v7MUE03u5YPwiVR4VDoKGa1xyiPmra7_/view?usp=sharing",
    notesUrl:
      "https://docs.google.com/document/d/1xuH8MTlKT2mXp3Q17kbhOMFNJ1PtlQU7uRGhvCZOzaQ/edit?usp=sharing",
    status: "published" as const,
  },
];

export async function seedRecordedClasses() {
  try {
    for (const cls of SEED_CLASSES) {
      const existing = await RecordedClass.findOne({
        title: cls.title,
        classDate: cls.classDate,
      });
      if (existing) {
        console.log(`Recorded class already exists: ${cls.title}`);
        continue;
      }
      await RecordedClass.create(cls);
      console.log(`Recorded class seeded: ${cls.title}`);
    }
  } catch (error) {
    console.error("Error seeding recorded classes:", error);
  }
}
