import dotenv from "dotenv";
import { dbConnect } from "./config/mongo";
import { createApp } from "./app";
import { seedAdmin } from "./scripts/seed-admin";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

const port = process.env.PORT || 8100;

async function main() {
  await dbConnect();
  await seedAdmin();

  const { app, server } = createApp();

  server.timeout = 10 * 60 * 1000;

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main();
