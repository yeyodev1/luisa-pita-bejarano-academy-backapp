import {
  TechService,
  billingPeriods,
  techServiceStatuses,
} from "../models/TechService";
import {
  AdminRequest,
  requestPriorities,
  requestStatuses,
} from "../models/AdminRequest";
import { User } from "../models/User";
import { CustomError } from "../errors/customError.error";
import { asDate, requireObjectId } from "../helpers/validation.helper";
import { runInBackground, sendMail } from "../helpers/mailer";

type Body = Record<string, unknown>;

// ── Servicios ────────────────────────────────────────────────────────────────

/**
 * Lista inicial con lo que se conoce del stack. Lo que no se sabe (costos,
 * fechas de renovación) queda vacío para completarlo desde el admin.
 */
const BASE_SERVICES = [
  {
    name: "Dominio luisapitabejarano.com",
    category: "Dominio",
    provider: "Namecheap",
    purpose: "La dirección web de la academia y de los correos @luisapitabejarano.com.",
    url: "https://www.namecheap.com",
    costAmount: 15,
    billingPeriod: "anual",
    paidBy: "Tarjeta de Diego Reyes (Bakano)",
    status: "pendiente",
    notes: "Pendiente transferir la propiedad a la cuenta de Enrique. Si no se renueva, se pierde el dominio.",
  },
  {
    name: "Google Workspace",
    category: "Correo y oficina",
    provider: "Google",
    purpose: "Correo luisa@luisapitabejarano.com, Drive y Calendar.",
    url: "https://admin.google.com",
    billingPeriod: "anual",
  },
  {
    name: "Zoom",
    category: "Clases en vivo",
    provider: "Zoom",
    purpose: "Clase diaria de 6:00 a 7:00. Al terminar, la grabación se publica sola en Clases grabadas.",
    url: "https://zoom.us",
    billingPeriod: "anual",
    paidBy: "Luisa",
  },
  {
    name: "Vercel",
    category: "Hosting",
    provider: "Vercel",
    purpose: "Publica la página web y el servidor de la academia.",
    url: "https://vercel.com",
  },
  {
    name: "GitHub",
    category: "Código fuente",
    provider: "GitHub",
    purpose: "Código de la web y del servidor (repos luisa-pita-bejarano-academy-frontapp y -backapp).",
    url: "https://github.com",
    status: "pendiente",
    notes: "Pendiente dar acceso a la cuenta de Enrique.",
  },
  {
    name: "MongoDB Atlas",
    category: "Base de datos",
    provider: "MongoDB",
    purpose: "Guarda alumnas, pagos, cursos, recetas y valoraciones.",
    url: "https://cloud.mongodb.com",
  },
  {
    name: "Cloudinary",
    category: "Fotos",
    provider: "Cloudinary",
    purpose: "Fotos: portadas, recetas, fotos de perfil y de valoraciones.",
    url: "https://cloudinary.com",
  },
  {
    name: "Bunny Stream",
    category: "Videos",
    provider: "Bunny.net",
    purpose: "Videos de los cursos.",
    url: "https://bunny.net",
    billingPeriod: "por uso",
  },
  {
    name: "Resend",
    category: "Correos automáticos",
    provider: "Resend",
    purpose: "Recordatorios de clase, avisos de clases y recetas nuevas, comprobantes y recuperación de contraseña.",
    url: "https://resend.com",
    billingPeriod: "mensual",
    notes: "El plan gratis llega al límite cada mes por los recordatorios diarios: recomendado pasar al plan pagado.",
  },
  {
    name: "Nuvei",
    category: "Pagos",
    provider: "Nuvei",
    purpose: "Cobros con tarjeta y suscripciones mensuales.",
    billingPeriod: "por uso",
  },
  {
    name: "Payphone",
    category: "Pagos",
    provider: "Payphone",
    purpose: "Links de pago para cobros puntuales.",
    url: "https://payphone.app",
    billingPeriod: "por uso",
  },
  {
    name: "CRM",
    category: "CRM",
    provider: "Bakano (HighLevel)",
    purpose: "Contactos, conversaciones y seguimiento de clientas.",
    billingPeriod: "mensual",
  },
];

function str(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function serviceInput(body: Body) {
  const input: Body = {};
  if (body.name !== undefined) {
    if (!str(body.name)) throw new CustomError("Ponle un nombre al servicio.", 400);
    input.name = str(body.name);
  }
  for (const field of [
    "category",
    "provider",
    "purpose",
    "url",
    "accountEmail",
    "currency",
    "paidBy",
    "notes",
  ])
    if (body[field] !== undefined) input[field] = str(body[field]);
  if (body.costAmount !== undefined) {
    if (body.costAmount === null || body.costAmount === "") input.costAmount = null;
    else {
      const cost = Number(body.costAmount);
      if (!Number.isFinite(cost) || cost < 0)
        throw new CustomError("El costo no es válido.", 400);
      input.costAmount = cost;
    }
  }
  if (body.billingPeriod !== undefined) {
    if (!billingPeriods.includes(body.billingPeriod as never))
      throw new CustomError("Periodo de cobro no válido.", 400);
    input.billingPeriod = body.billingPeriod;
  }
  if (body.status !== undefined) {
    if (!techServiceStatuses.includes(body.status as never))
      throw new CustomError("Estado no válido.", 400);
    input.status = body.status;
  }
  if (body.renewsAt !== undefined)
    input.renewsAt = body.renewsAt ? asDate(body.renewsAt, "renewsAt") : null;
  if (body.order !== undefined) input.order = Number(body.order) || 0;
  return input;
}

export function listServices() {
  return TechService.find().sort({ order: 1, category: 1, name: 1 }).lean();
}

/** Carga la lista base sin pisar lo que ya exista (idempotente por nombre). */
export async function seedServices() {
  let created = 0;
  for (const [index, service] of BASE_SERVICES.entries()) {
    const result = await TechService.updateOne(
      { name: service.name },
      { $setOnInsert: { ...service, order: index } },
      { upsert: true },
    );
    created += result.upsertedCount;
  }
  return { created, services: await listServices() };
}

export async function createService(body: Body) {
  if (!str(body.name)) throw new CustomError("Ponle un nombre al servicio.", 400);
  if (await TechService.exists({ name: str(body.name) }))
    throw new CustomError("Ya existe un servicio con ese nombre.", 409);
  return TechService.create(serviceInput(body));
}

export async function updateService(id: string, body: Body) {
  requireObjectId(id);
  const service = await TechService.findByIdAndUpdate(id, serviceInput(body), {
    new: true,
    runValidators: true,
  });
  if (!service) throw new CustomError("Servicio no encontrado.", 404);
  return service;
}

export async function deleteService(id: string) {
  requireObjectId(id);
  if (!(await TechService.findByIdAndDelete(id)))
    throw new CustomError("Servicio no encontrado.", 404);
  return { deleted: true };
}

// ── Solicitudes ──────────────────────────────────────────────────────────────

async function adminName(userId: string) {
  const user = await User.findById(userId).select("name lastName email").lean();
  if (!user) return "Admin";
  return `${user.name ?? ""} ${user.lastName ?? ""}`.trim() || user.email;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Aviso al equipo técnico (REQUESTS_NOTIFY_EMAIL, separado por comas). */
async function notifyNewRequest(request: {
  title: string;
  description: string;
  priority: string;
  createdByName: string;
}) {
  const to = (process.env.REQUESTS_NOTIFY_EMAIL || "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (!to.length) return;
  const base = (process.env.FRONTEND_URL || "https://luisapitabejarano.com").replace(/\/$/, "");
  await runInBackground(
    sendMail({
      to,
      subject: `${request.priority === "urgente" ? "[URGENTE] " : ""}Nueva solicitud: ${request.title}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 28px; color: #20231f; background: #fffdf7;">
          <p style="margin: 0 0 8px; color: #536d59; font-size: 12px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;">Backoffice</p>
          <h1 style="margin: 0 0 16px; font-size: 22px;">${escapeHtml(request.title)}</h1>
          <p><strong>De:</strong> ${escapeHtml(request.createdByName)}</p>
          <p style="white-space: pre-line;">${escapeHtml(request.description || "Sin descripción.")}</p>
          <a href="${base}/admin/backoffice" style="display: inline-block; margin-top: 8px; padding: 14px 24px; color: #ffffff; background: #536d59; border-radius: 999px; font-weight: 700; text-decoration: none;">Abrir solicitudes</a>
        </div>
      `,
    }),
    "aviso de solicitud",
  );
}

export function listRequests() {
  return AdminRequest.find().sort({ createdAt: -1 }).limit(200).lean();
}

export async function createRequest(userId: string, body: Body) {
  const title = str(body.title);
  if (!title) throw new CustomError("Escribe qué necesitas en el título.", 400);
  const priority = requestPriorities.includes(body.priority as never)
    ? (body.priority as (typeof requestPriorities)[number])
    : "normal";
  const request = await AdminRequest.create({
    title,
    description: str(body.description),
    priority,
    createdBy: userId,
    createdByName: await adminName(userId),
  });
  await notifyNewRequest(request);
  return request;
}

export async function updateRequest(id: string, body: Body) {
  requireObjectId(id);
  const request = await AdminRequest.findById(id);
  if (!request) throw new CustomError("Solicitud no encontrada.", 404);
  if (body.title !== undefined) {
    if (!str(body.title)) throw new CustomError("El título no puede quedar vacío.", 400);
    request.title = str(body.title);
  }
  if (body.description !== undefined) request.description = str(body.description);
  if (body.priority !== undefined) {
    if (!requestPriorities.includes(body.priority as never))
      throw new CustomError("Prioridad no válida.", 400);
    request.priority = body.priority as (typeof requestPriorities)[number];
  }
  if (body.status !== undefined) {
    if (!requestStatuses.includes(body.status as never))
      throw new CustomError("Estado no válido.", 400);
    request.status = body.status as (typeof requestStatuses)[number];
    request.completedAt = request.status === "hecha" ? new Date() : null;
  }
  return request.save();
}

export async function addRequestNote(userId: string, id: string, body: Body) {
  requireObjectId(id);
  const text = str(body.body);
  if (!text) throw new CustomError("La nota está vacía.", 400);
  const request = await AdminRequest.findByIdAndUpdate(
    id,
    {
      $push: {
        notes: { authorName: await adminName(userId), body: text, createdAt: new Date() },
      },
    },
    { new: true },
  );
  if (!request) throw new CustomError("Solicitud no encontrada.", 404);
  return request;
}

export async function deleteRequest(id: string) {
  requireObjectId(id);
  if (!(await AdminRequest.findByIdAndDelete(id)))
    throw new CustomError("Solicitud no encontrada.", 404);
  return { deleted: true };
}
