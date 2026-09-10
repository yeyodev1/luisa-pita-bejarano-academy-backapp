/**
 * Correo masivo a las alumnas activas por la clase que no se dictó hoy.
 * Envoltorio CLI de src/services/missedClassEmail.service.ts.
 * En producción se dispara por HTTP: GET /api/cron/missed-class-email (Bearer CRON_SECRET).
 *
 * Uso local:
 *   pnpm email:missed-class --dry-run
 *   pnpm email:missed-class --test=correo@dominio.com
 *   pnpm email:missed-class --send
 * Flags opcionales: --class=<id> --extra=<a,b> --missed=<YYYY-MM-DD>
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { sendMissedClassEmail, MissedClassEmailOptions } from "../services/missedClassEmail.service";

dotenv.config();
dotenv.config({ path: ".env.local", override: true });

function parseArgs(): MissedClassEmailOptions & { send: boolean } {
  const opts: MissedClassEmailOptions & { send: boolean } = { send: false };
  for (const raw of process.argv.slice(2)) {
    const [key, value] = raw.split("=");
    if (key === "--dry-run") opts.dryRun = true;
    else if (key === "--send") opts.send = true;
    else if (key === "--test") opts.test = value;
    else if (key === "--class") opts.classId = value;
    else if (key === "--missed") opts.missed = value;
    else if (key === "--extra") opts.extra = value ? value.split(",") : [];
  }
  return opts;
}

async function main() {
  const opts = parseArgs();
  if (!opts.dryRun && !opts.send && !opts.test) {
    console.error("Indica --dry-run, --test=<email> o --send.");
    process.exit(1);
  }
  await dbConnect();
  const result = await sendMissedClassEmail(opts);
  console.log(JSON.stringify(result, null, 2));
  await mongoose.connection.close();
  process.exit(result.failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
