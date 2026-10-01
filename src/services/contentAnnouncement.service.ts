import { User } from "../models/User";
import { Recipe } from "../models/Recipe";
import { RecordedClass } from "../models/RecordedClass";
import { sendMailBatch, runInBackground, MailPayload } from "../helpers/mailer";

/**
 * Correo a las alumnas activas cuando se publica una receta o una clase
 * grabada. Cada contenido se anuncia una sola vez: `announcedAt` se marca de
 * forma atómica antes de enviar, así un doble clic o una edición posterior no
 * vuelve a disparar el correo.
 */

const BATCH_SIZE = 100;

type Recipient = { name: string; email: string };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function appUrl(path: string) {
  const base = (
    process.env.FRONTEND_URL || "https://luisapitabejarano.com"
  ).replace(/\/$/, "");
  return `${base}${path}`;
}

async function activeStudents(): Promise<Recipient[]> {
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
  for (const s of students)
    byEmail.set(s.email.toLowerCase(), { name: s.name, email: s.email });
  return [...byEmail.values()];
}

function layout(input: {
  kicker: string;
  title: string;
  name: string;
  intro: string;
  card: string;
  ctaLabel: string;
  ctaUrl: string;
}) {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #20231f; background: #fffdf7;">
      <p style="margin: 0 0 8px; color: #536d59; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">${input.kicker}</p>
      <h1 style="margin: 0 0 16px; color: #20231f; font-size: 26px; line-height: 1.2;">${input.title}</h1>
      <p>Hola, ${escapeHtml(input.name)}.</p>
      <p>${input.intro}</p>
      <div style="margin: 16px 0; padding: 16px 18px; background: #ffffff; border: 1px solid #e3e0d3; border-radius: 12px;">${input.card}</div>
      <a href="${escapeHtml(input.ctaUrl)}" style="display: inline-block; margin: 8px 0; padding: 14px 24px; color: #ffffff; background: #536d59; border-radius: 999px; font-weight: 700; text-decoration: none;">${input.ctaLabel}</a>
      <p style="margin-top: 24px; color: #536d59; font-size: 13px;">Luisa Pita Bejarano Academy · Todos los horarios corresponden a Ecuador (UTC-5).</p>
    </div>
  `;
}

async function sendToStudents(
  build: (recipient: Recipient) => MailPayload,
  label: string,
) {
  const recipients = await activeStudents();
  let sent = 0;
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    try {
      await sendMailBatch(batch.map(build));
      sent += batch.length;
    } catch (error) {
      console.error(`[Anuncio] ${label}: falló un lote`, error);
    }
  }
  console.log(`[Anuncio] ${label}: ${sent}/${recipients.length} correos`);
}

/** Marca el anuncio y, solo si este llamado lo marcó, envía en segundo plano. */
export async function announceRecipe(recipeId: string) {
  const recipe = await Recipe.findOneAndUpdate(
    { _id: recipeId, status: "published", announcedAt: null },
    { $set: { announcedAt: new Date() } },
    { new: true },
  ).lean();
  if (!recipe) return false;

  const title = escapeHtml(recipe.title);
  const minutes = (recipe.prepMinutes || 0) + (recipe.cookMinutes || 0);
  const details = [
    minutes ? `${minutes} min` : "",
    recipe.servings ? `${recipe.servings} porciones` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const card = `
    <p style="margin: 0 0 4px; font-weight: 700; font-size: 16px;">${title}</p>
    ${recipe.summary ? `<p style="margin: 0 0 4px; font-size: 14px;">${escapeHtml(recipe.summary)}</p>` : ""}
    ${details ? `<p style="margin: 0; color: #536d59; font-size: 14px;">${details}</p>` : ""}
  `;

  await runInBackground(
    sendToStudents(
      (r) => ({
        to: r.email,
        subject: `Nueva receta: ${recipe.title}`,
        html: layout({
          kicker: "Receta nueva",
          title: "Ya tienes una receta nueva",
          name: r.name,
          intro: "Acabamos de publicar una receta en tu academia:",
          card,
          ctaLabel: "Ver la receta",
          ctaUrl: appUrl("/app/recetas"),
        }),
      }),
      `receta ${recipe.title}`,
    ),
    "anuncio de receta",
  );
  return true;
}

export async function announceRecordedClass(classId: string) {
  const cls = await RecordedClass.findOneAndUpdate(
    { _id: classId, status: "published", announcedAt: null },
    { $set: { announcedAt: new Date() } },
    { new: true },
  ).lean();
  if (!cls) return false;

  const dateLabel = cls.classDate.toLocaleDateString("es-EC", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Guayaquil",
  });
  const card = `
    <p style="margin: 0 0 4px; font-weight: 700; font-size: 16px;">${escapeHtml(cls.title)}</p>
    <p style="margin: 0; color: #536d59; font-size: 14px;">Clase del ${escapeHtml(dateLabel)}</p>
  `;

  await runInBackground(
    sendToStudents(
      (r) => ({
        to: r.email,
        subject: `Nueva clase grabada: ${cls.title}`,
        html: layout({
          kicker: "Clase grabada",
          title: "Ya está disponible una clase grabada",
          name: r.name,
          intro:
            "Subimos una nueva clase grabada a tu biblioteca. Hazla cuando quieras:",
          card,
          ctaLabel: "Ver la clase",
          ctaUrl: appUrl("/app/clases-grabadas"),
        }),
      }),
      `clase ${cls.title}`,
    ),
    "anuncio de clase grabada",
  );
  return true;
}
