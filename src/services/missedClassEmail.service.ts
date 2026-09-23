import { Resend } from "resend";
import { User } from "../models/User";
import { RecordedClass, IRecordedClass } from "../models/RecordedClass";
import { CustomError } from "../errors/customError.error";

const TZ = "America/Guayaquil";
const BATCH_SIZE = 100;
const DEFAULT_EXTRA = ["diegorele13@gmail.com"];

export type MissedClassEmailOptions = {
  /** Solo lista clases, clase elegida y destinatarias. No envía. */
  dryRun?: boolean;
  /** Envía únicamente a este correo (prueba de diseño). */
  test?: string;
  /** Fuerza la clase grabada a usar. Por defecto: primera clase de un jueves. */
  classId?: string;
  /** Correos adicionales además de las alumnas activas. */
  extra?: string[];
  /** Fecha de la clase faltante (YYYY-MM-DD). Por defecto: hoy, hora Ecuador. */
  missed?: string;
  /** "missed" (hoy no hubo clase) o "exclusive" (la clase de hoy es una exclusiva grabada). */
  variant?: EmailVariant;
  /** Publica la clase elegida en la biblioteca como clase de hoy (solo en envío real). */
  publishAsToday?: boolean;
};

export type EmailVariant = "missed" | "exclusive";

type Recipient = { name: string; email: string };

function escapeHtml(value: string) {
  return value.replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ] || c,
  );
}

function ecuadorWeekday(date: Date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "long" })
    .format(date)
    .toLowerCase();
}

function ecuadorLongDate(date: Date) {
  return new Intl.DateTimeFormat("es-EC", {
    timeZone: TZ,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

function todayEcuador() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function buildMissedClassEmail(input: {
  name: string;
  missedDateLabel: string;
  cls: IRecordedClass;
  libraryUrl: string;
  variant?: EmailVariant;
}) {
  if (input.variant === "exclusive") return buildExclusiveClassEmail(input);
  const name = escapeHtml(input.name);
  const title = escapeHtml(input.cls.title);
  const recordingUrl = escapeHtml(input.cls.recordingUrl);
  const notesUrl = input.cls.notesUrl ? escapeHtml(input.cls.notesUrl) : "";
  const libraryUrl = escapeHtml(input.libraryUrl);

  const subject =
    "Hoy no tuvimos clase — te dejamos una clase exclusiva grabada en vivo";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #20231f; background: #fffdf7;">
      <p style="margin: 0 0 8px; color: #536d59; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Aviso de clase</p>
      <h1 style="margin: 0 0 16px; color: #20231f; font-size: 26px; line-height: 1.2;">Hoy no tuvimos clase en vivo</h1>
      <p>Hola, ${name}.</p>
      <p>Hoy, <strong>${escapeHtml(input.missedDateLabel)}</strong>, no se realizó la clase en vivo de las 6:00 a. m. Te pedimos disculpas por el inconveniente.</p>
      <p>Para que no pierdas el ritmo, te dejamos una <strong>clase exclusiva grabada en vivo</strong> para que la veas cuando quieras:</p>
      <div style="margin: 16px 0; padding: 16px 18px; background: #ffffff; border: 1px solid #e3e0d3; border-radius: 12px;">
        <p style="margin: 0 0 4px; font-weight: 700; font-size: 16px;">${title}</p>
        <p style="margin: 0; color: #536d59; font-size: 14px;">Duración aproximada: 1 hora</p>
      </div>
      <a href="${recordingUrl}" style="display: inline-block; margin: 8px 8px 8px 0; padding: 14px 24px; color: #ffffff; background: #536d59; border-radius: 999px; font-weight: 700; text-decoration: none;">Ver la grabación</a>
      ${
        notesUrl
          ? `<a href="${notesUrl}" style="display: inline-block; margin: 8px 0; padding: 14px 24px; color: #536d59; background: #ffffff; border: 2px solid #536d59; border-radius: 999px; font-weight: 700; text-decoration: none;">Notas de la clase</a>`
          : ""
      }
      <p style="margin-top: 20px;">También puedes encontrar todas las clases grabadas en tu biblioteca: <a href="${libraryUrl}" style="color: #536d59;">${libraryUrl}</a></p>
      <p>Nos vemos en la próxima clase en vivo, de lunes a viernes a las 6:00 a. m.</p>
      <p style="margin-top: 24px; color: #536d59; font-size: 13px;">Luisa Pita Bejarano Academy · Todos los horarios corresponden a Ecuador (UTC-5).</p>
    </div>
  `;

  return { subject, html };
}

function buildExclusiveClassEmail(input: {
  name: string;
  missedDateLabel: string;
  cls: IRecordedClass;
  libraryUrl: string;
}) {
  const name = escapeHtml(input.name);
  const recordingUrl = escapeHtml(input.cls.recordingUrl);
  const notesUrl = input.cls.notesUrl ? escapeHtml(input.cls.notesUrl) : "";
  const libraryUrl = escapeHtml(input.libraryUrl);
  const dateLabel = escapeHtml(input.missedDateLabel);

  const subject = "Tu clase de hoy es una clase exclusiva grabada en vivo";

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #20231f; background: #fffdf7;">
      <p style="margin: 0 0 8px; color: #536d59; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Clase exclusiva</p>
      <h1 style="margin: 0 0 16px; color: #20231f; font-size: 26px; line-height: 1.2;">Tu clase de hoy es una clase exclusiva</h1>
      <p>Hola, ${name}.</p>
      <p>Hoy, <strong>${dateLabel}</strong>, tu clase es una <strong>clase exclusiva grabada en vivo</strong>, solo para alumnas de la academia. Puedes verla cuando quieras, a tu ritmo.</p>
      <div style="margin: 16px 0; padding: 16px 18px; background: #ffffff; border: 1px solid #e3e0d3; border-radius: 12px;">
        <p style="margin: 0 0 4px; font-weight: 700; font-size: 16px;">Clase exclusiva · ${dateLabel}</p>
        <p style="margin: 0; color: #536d59; font-size: 14px;">Duración aproximada: 1 hora</p>
      </div>
      <a href="${recordingUrl}" style="display: inline-block; margin: 8px 8px 8px 0; padding: 14px 24px; color: #ffffff; background: #536d59; border-radius: 999px; font-weight: 700; text-decoration: none;">Ver la clase</a>
      ${
        notesUrl
          ? `<a href="${notesUrl}" style="display: inline-block; margin: 8px 0; padding: 14px 24px; color: #536d59; background: #ffffff; border: 2px solid #536d59; border-radius: 999px; font-weight: 700; text-decoration: none;">Notas de la clase</a>`
          : ""
      }
      <p style="margin-top: 20px;">También la encuentras en tu biblioteca de clases grabadas: <a href="${libraryUrl}" style="color: #536d59;">${libraryUrl}</a></p>
      <p>Nos vemos en la próxima clase en vivo, de lunes a viernes a las 6:00 a. m.</p>
      <p style="margin-top: 24px; color: #536d59; font-size: 13px;">Luisa Pita Bejarano Academy · Todos los horarios corresponden a Ecuador (UTC-5).</p>
    </div>
  `;

  return { subject, html };
}

function todayClassTitle(date: string) {
  const d = new Date(`${date}T12:00:00-05:00`);
  const weekday = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, weekday: "long" }).format(d);
  const rest = new Intl.DateTimeFormat("es-EC", { timeZone: TZ, day: "numeric", month: "long" }).format(d);
  return `Clase de Luisa Pita Bejarano — ${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${rest}`;
}

/** Crea (una sola vez) la clase de hoy en la biblioteca con la grabación elegida. */
async function publishClassAsToday(source: IRecordedClass, date: string) {
  const classDate = new Date(`${date}T06:00:00-05:00`);
  const existing = await RecordedClass.findOne({
    classDate,
    recordingUrl: source.recordingUrl,
  });
  if (existing) return { cls: existing, created: false };
  const cls = await RecordedClass.create({
    title: todayClassTitle(date),
    classDate,
    startsAt: source.startsAt || "06:00",
    endsAt: source.endsAt || "07:00",
    recordingUrl: source.recordingUrl,
    notesUrl: source.notesUrl || "",
    status: "published",
  });
  return { cls, created: true };
}

export async function sendMissedClassEmail(options: MissedClassEmailOptions) {
  const extra = (options.extra ?? DEFAULT_EXTRA)
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);

  // 1. Clases grabadas publicadas
  const classes = await RecordedClass.find({ status: "published" }).sort({
    classDate: 1,
  });
  const classList = classes.map((c) => ({
    id: String(c._id),
    weekday: ecuadorWeekday(c.classDate),
    date: c.classDate.toISOString().slice(0, 10),
    title: c.title,
  }));

  let chosen: IRecordedClass | undefined;
  if (options.classId) {
    chosen = classes.find((c) => String(c._id) === options.classId);
    if (!chosen) {
      throw new CustomError(
        `No existe clase publicada con id ${options.classId}`,
        404,
      );
    }
  } else {
    chosen = classes.find((c) => ecuadorWeekday(c.classDate) === "thursday");
    if (!chosen) {
      throw new CustomError(
        "No se encontró ninguna clase grabada de un jueves. Indica classId.",
        404,
      );
    }
  }

  // 2. Destinatarias: alumnas activas (no admins)
  const now = new Date();
  const students = await User.find({
    role: "user",
    isVerified: true,
    subscriptionStatus: "active",
    $or: [{ accessUntil: null }, { accessUntil: { $gt: now } }],
  })
    .select("name email")
    .lean();

  const byEmail = new Map<string, Recipient>();
  for (const s of students) {
    byEmail.set(s.email.toLowerCase(), { name: s.name, email: s.email });
  }
  for (const email of extra) {
    if (byEmail.has(email)) continue;
    const existing = await User.findOne({ email }).select("name").lean();
    byEmail.set(email, { name: existing?.name || "", email });
  }

  let recipients = [...byEmail.values()];
  if (options.test) {
    recipients = [{ name: "Prueba", email: options.test.toLowerCase().trim() }];
  }

  const missedDate = options.missed || todayEcuador();
  const missedDateLabel = ecuadorLongDate(
    new Date(`${missedDate}T12:00:00-05:00`),
  );
  const frontendUrl =
    process.env.FRONTEND_URL || "https://luisapitabejarano.com";
  const libraryUrl = `${frontendUrl.replace(/\/$/, "")}/app/clases-grabadas`;

  const summary = {
    classes: classList,
    chosenClass: {
      id: String(chosen._id),
      title: chosen.title,
      date: ecuadorLongDate(chosen.classDate),
      recordingUrl: chosen.recordingUrl,
      notesUrl: chosen.notesUrl || null,
    },
    missedDate,
    missedDateLabel,
    subject: buildMissedClassEmail({
      name: "alumna",
      missedDateLabel,
      cls: chosen,
      libraryUrl,
      variant: options.variant,
    }).subject,
    variant: options.variant || "missed",
    publishAsToday: Boolean(options.publishAsToday),
    activeStudents: students.length,
    extra,
    totalRecipients: recipients.length,
    recipients: recipients.map((r) => r.email),
    test: options.test || null,
  };

  if (options.dryRun) {
    return { ...summary, dryRun: true, sent: 0, failed: [] as string[] };
  }

  // 3. Publicar la grabación como clase de hoy (solo envío real)
  let publishedClass: { id: string; title: string; created: boolean } | null =
    null;
  if (options.publishAsToday && !options.test) {
    const { cls, created } = await publishClassAsToday(chosen, missedDate);
    publishedClass = { id: String(cls._id), title: cls.title, created };
  }

  // 4. Envío
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM_EMAIL as string;
  let sent = 0;
  const failed: string[] = [];
  const errors: string[] = [];

  for (let offset = 0; offset < recipients.length; offset += BATCH_SIZE) {
    const batch = recipients.slice(offset, offset + BATCH_SIZE);
    const payload = batch.map((r) => {
      const email = buildMissedClassEmail({
        name: r.name || "alumna",
        missedDateLabel,
        cls: chosen!,
        libraryUrl,
        variant: options.variant,
      });
      return { from, to: r.email, subject: email.subject, html: email.html };
    });

    const { error } = await resend.batch.send(payload);
    if (error) {
      failed.push(...batch.map((r) => r.email));
      errors.push(error.message);
      continue;
    }
    sent += batch.length;
  }

  return { ...summary, dryRun: false, publishedClass, sent, failed, errors };
}

/** Estado de entrega en Resend de los últimos correos con el asunto del aviso. */
export async function missedClassEmailStatus(limit = 50) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const { data, error } = await resend.emails.list({ limit });
  if (error) throw new CustomError(`Resend list error: ${error.message}`, 502);

  const subject = buildMissedClassEmail({
    name: "x",
    missedDateLabel: "x",
    cls: { title: "x", classDate: new Date(), startsAt: "", endsAt: "", recordingUrl: "x" } as IRecordedClass,
    libraryUrl: "x",
  }).subject;

  const items = (data?.data ?? [])
    .filter((e) => e.subject === subject)
    .map((e) => ({
      to: e.to,
      lastEvent: e.last_event,
      createdAt: e.created_at,
      id: e.id,
    }));

  const byEvent: Record<string, number> = {};
  for (const item of items) byEvent[item.lastEvent] = (byEvent[item.lastEvent] || 0) + 1;

  return { subject, total: items.length, byEvent, items };
}
