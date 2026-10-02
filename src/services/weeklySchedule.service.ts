import { WeeklySession, IWeeklySession } from "../models/WeeklySession";
import { CustomError } from "../errors/customError.error";
import { requireObjectId, slugify } from "../helpers/validation.helper";

type Body = Record<string, unknown>;

/** Valores iniciales: se crean solos la primera vez que se consulta el horario. */
const DEFAULT_SESSIONS = [
  {
    key: "weekday-class",
    title: "Clase de Luisa Pita Bejarano",
    days: [1, 2, 3, 4, 5],
    startTime: "06:00",
    endTime: "07:00",
    meetingUrl:
      "https://us06web.zoom.us/j/83322853984?pwd=7wX7AFxC5vbEa6939OvOfWO9uR54xc.1",
    meetingId: "833 2285 3984",
    passcode: "353621",
    color: "#536d59",
    icon: "fa-person-running",
    isMainClass: true,
    order: 0,
  },
  {
    key: "monday-cafecito",
    title: "Cafecito con Luisa Pita Bejarano",
    days: [1],
    startTime: "16:00",
    endTime: "17:00",
    meetingUrl: "https://meet.google.com/evz-dpuc-nho",
    meetingId: "",
    passcode: "",
    color: "#a66f32",
    icon: "fa-mug-hot",
    isMainClass: false,
    order: 1,
  },
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

async function ensureDefaults() {
  if (await WeeklySession.exists({})) return;
  await WeeklySession.insertMany(DEFAULT_SESSIONS, { ordered: false }).catch(
    () => undefined,
  );
}

export async function listWeeklySessions(options: { activeOnly?: boolean } = {}) {
  await ensureDefaults();
  return WeeklySession.find(options.activeOnly ? { active: true } : {})
    .sort({ order: 1, startTime: 1 })
    .lean();
}

/** Reunión cuyas grabaciones de Zoom se publican como clase grabada. */
export async function getMainClassSession() {
  await ensureDefaults();
  return WeeklySession.findOne({ isMainClass: true }).lean();
}

/** "06:00" → "6:00 a. m." */
export function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h < 12 ? "a. m." : "p. m.";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatRange(session: Pick<IWeeklySession, "startTime" | "endTime">) {
  return `${formatTime(session.startTime)} - ${formatTime(session.endTime)}`;
}

function sessionInput(body: Body, partial: boolean) {
  const input: Partial<IWeeklySession> = {};
  const has = (field: string) => body[field] !== undefined;

  if (!partial || has("title")) {
    if (typeof body.title !== "string" || !body.title.trim())
      throw new CustomError("Escribe el nombre de la sesión", 400);
    input.title = body.title.trim();
  }
  if (!partial || has("days")) {
    const days = Array.isArray(body.days)
      ? [...new Set(body.days.map(Number))].filter((d) => d >= 0 && d <= 6)
      : [];
    if (!days.length) throw new CustomError("Elige al menos un día", 400);
    input.days = days.sort();
  }
  for (const field of ["startTime", "endTime"] as const) {
    if (partial && !has(field)) continue;
    const value = String(body[field] ?? "").trim();
    if (!TIME.test(value))
      throw new CustomError("La hora debe tener el formato HH:mm", 400);
    input[field] = value;
  }
  if (!partial || has("meetingUrl")) {
    const url = String(body.meetingUrl ?? "").trim();
    if (!/^https:\/\//.test(url))
      throw new CustomError("El enlace de la reunión debe empezar con https://", 400);
    input.meetingUrl = url;
  }
  for (const field of ["meetingId", "passcode", "color", "icon"] as const) {
    if (has(field)) input[field] = String(body[field]).trim();
  }
  for (const field of ["active", "reminders", "isMainClass"] as const) {
    if (has(field)) input[field] = Boolean(body[field]);
  }
  if (has("order")) input.order = Number(body.order) || 0;
  return input;
}

function assertTimes(session: Pick<IWeeklySession, "startTime" | "endTime">) {
  if (session.endTime <= session.startTime)
    throw new CustomError("La hora de fin debe ser después de la de inicio", 400);
}

async function keepSingleMainClass(id: unknown) {
  await WeeklySession.updateMany(
    { _id: { $ne: id }, isMainClass: true },
    { $set: { isMainClass: false } },
  );
}

export async function createWeeklySession(body: Body) {
  const input = sessionInput(body, false);
  assertTimes(input as IWeeklySession);
  let key = slugify(input.title!) || "sesion";
  if (await WeeklySession.exists({ key })) key = `${key}-${Date.now()}`;
  const session = await WeeklySession.create({ ...input, key });
  if (session.isMainClass) await keepSingleMainClass(session._id);
  return session;
}

export async function updateWeeklySession(id: string, body: Body) {
  requireObjectId(id);
  const session = await WeeklySession.findById(id);
  if (!session) throw new CustomError("Sesión no encontrada", 404);
  session.set(sessionInput(body, true));
  assertTimes(session);
  await session.save();
  if (session.isMainClass) await keepSingleMainClass(session._id);
  return session;
}

export async function deleteWeeklySession(id: string) {
  requireObjectId(id);
  const session = await WeeklySession.findByIdAndDelete(id);
  if (!session) throw new CustomError("Sesión no encontrada", 404);
  return { deleted: true };
}
