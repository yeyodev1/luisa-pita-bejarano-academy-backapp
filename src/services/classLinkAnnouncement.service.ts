import { sendMailBatch } from "../helpers/mailer";
import { User } from "../models/User";
import { formatRange, getMainClassSession } from "./weeklySchedule.service";

const BATCH_SIZE = 100;
const DEFAULT_EXTRA = ["diegorele13@gmail.com"];

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ] || c,
  );
}

type ClassInfo = { url: string; meetingId: string; passcode: string; range: string };

function buildEmail(name: string, info: ClassInfo) {
  const url = escapeHtml(info.url);
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #20231f; background: #fffdf7;">
      <p style="margin: 0 0 8px; color: #536d59; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Cambio de enlace</p>
      <h1 style="margin: 0 0 16px; color: #20231f; font-size: 28px; line-height: 1.2;">La clase ahora es por Zoom</h1>
      <p>Hola, ${escapeHtml(name)}.</p>
      <p>Desde hoy, la clase de Luisa Pita Bejarano de <strong>lunes a viernes, ${escapeHtml(info.range)}</strong> (hora Ecuador), es por Zoom. El enlace de Google Meet ya no se usa.</p>
      <p>Es el mismo enlace todos los días. Guárdalo:</p>
      <a href="${url}" style="display: inline-block; margin: 16px 0; padding: 14px 24px; color: #ffffff; background: #536d59; border-radius: 999px; font-weight: 700; text-decoration: none;">Entrar a Zoom</a>
      <p style="margin: 0;"><strong>ID de reunión:</strong> ${escapeHtml(info.meetingId)}</p>
      <p style="margin: 4px 0 0;"><strong>Código de acceso:</strong> ${escapeHtml(info.passcode)}</p>
      <p style="margin-top: 16px;">Los recordatorios de cada mañana también te llegarán con este enlace.</p>
      <p style="margin-top: 24px; color: #536d59; font-size: 13px;">Luisa Pita Bejarano Academy · Todos los horarios corresponden a Ecuador (UTC-5).</p>
    </div>
  `;
}

/** Aviso puntual a las alumnas activas: la clase diaria pasa a Zoom. */
export async function sendClassLinkAnnouncement(options: {
  dryRun?: boolean;
  test?: string;
}) {
  const session = await getMainClassSession();
  if (!session) throw new Error("No hay clase principal en el horario semanal");
  const info: ClassInfo = {
    url: session.meetingUrl,
    meetingId: session.meetingId,
    passcode: session.passcode,
    range: formatRange(session),
  };
  const SUBJECT = `Nuevo enlace de Zoom para la clase de ${info.range.split(" - ")[0]}`;
  const now = new Date();
  const students = await User.find({
    role: "user",
    isVerified: true,
    subscriptionStatus: "active",
    $or: [{ accessUntil: null }, { accessUntil: { $gt: now } }],
  })
    .select("name email")
    .lean();

  const byEmail = new Map<string, { name: string; email: string }>();
  for (const s of students) {
    byEmail.set(s.email.toLowerCase(), { name: s.name, email: s.email });
  }
  for (const email of DEFAULT_EXTRA) {
    if (!byEmail.has(email)) byEmail.set(email, { name: "", email });
  }

  const recipients = options.test
    ? [{ name: "Prueba", email: options.test.toLowerCase().trim() }]
    : [...byEmail.values()];
  const summary = {
    subject: SUBJECT,
    zoomUrl: info.url,
    activeStudents: students.length,
    totalRecipients: recipients.length,
    recipients: recipients.map((r) => r.email),
    test: options.test || null,
  };
  if (options.dryRun) return { ...summary, dryRun: true, sent: 0 };

  let sent = 0;
  const failed: string[] = [];
  const errors: string[] = [];
  const accounts: string[] = [];
  for (let offset = 0; offset < recipients.length; offset += BATCH_SIZE) {
    const batch = recipients.slice(offset, offset + BATCH_SIZE);
    try {
      const { account } = await sendMailBatch(
        batch.map((r) => ({
          to: r.email,
          subject: SUBJECT,
          html: buildEmail(r.name || "alumna", info),
        })),
      );
      accounts.push(account);
      sent += batch.length;
    } catch (err) {
      failed.push(...batch.map((r) => r.email));
      errors.push((err as Error).message);
    }
  }
  return { ...summary, dryRun: false, sent, failed, errors, accounts };
}
