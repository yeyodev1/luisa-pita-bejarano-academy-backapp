import { RecordedClass, IRecordedClass } from "../models/RecordedClass";
import { todayClassTitle } from "./missedClassEmail.service";

const TZ = "America/Guayaquil";
const LIBRARY_START = "2026-07-21";
// Registro guardado con año 2005 por error: es el martes 28 de julio de 2026.
const MISDATED = { id: "6a6a53eaae32e8c444c929fe", date: "2026-07-28" };

export type RecordedClassGapsOptions = {
  /** Solo muestra qué haría. */
  dryRun?: boolean;
  /** Último día a rellenar (YYYY-MM-DD). Por defecto: hoy, hora Ecuador. */
  to?: string;
};

function ecuadorDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function weekdayOf(day: string) {
  return new Date(`${day}T12:00:00-05:00`).getUTCDay(); // 0 domingo … 6 sábado
}

function nextDay(day: string) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Rellena cada día de lunes a viernes sin clase grabada con una grabación
 * existente del mismo día de la semana, rotando entre ellas.
 */
export async function fillRecordedClassGaps(options: RecordedClassGapsOptions) {
  const to = options.to || ecuadorDay(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error(`Fecha inválida: ${to}`);

  // 1. Corregir el registro con fecha 2005
  const misdated = await RecordedClass.findById(MISDATED.id);
  const fixDate =
    misdated && ecuadorDay(misdated.classDate) !== MISDATED.date
      ? { id: MISDATED.id, from: ecuadorDay(misdated.classDate), to: MISDATED.date }
      : null;
  if (fixDate && !options.dryRun) {
    misdated!.classDate = new Date(`${MISDATED.date}T06:00:00-05:00`);
    await misdated!.save();
  }

  const published = await RecordedClass.find({ status: "published" }).sort({
    classDate: 1,
  });
  const dayOf = (c: IRecordedClass) =>
    fixDate && String(c._id) === MISDATED.id ? MISDATED.date : ecuadorDay(c.classDate);

  const taken = new Set(published.map(dayOf));

  // 2. Grabaciones originales por día de la semana (sin repetir la misma grabación)
  const sources = new Map<number, IRecordedClass[]>();
  const seenUrls = new Set<string>();
  for (const c of published) {
    const day = dayOf(c);
    if (day < LIBRARY_START || seenUrls.has(c.recordingUrl)) continue;
    seenUrls.add(c.recordingUrl);
    const wd = weekdayOf(day);
    if (!sources.has(wd)) sources.set(wd, []);
    sources.get(wd)!.push(c);
  }

  // 3. Huecos de lunes a viernes
  const cursor = new Map<number, number>();
  const plan: { date: string; title: string; sourceId: string; sourceTitle: string }[] = [];
  const skipped: string[] = [];
  for (let day = LIBRARY_START; day <= to; day = nextDay(day)) {
    const wd = weekdayOf(day);
    if (wd === 0 || wd === 6 || taken.has(day)) continue;
    const pool = sources.get(wd);
    if (!pool?.length) {
      skipped.push(day);
      continue;
    }
    const i = cursor.get(wd) ?? 0;
    cursor.set(wd, i + 1);
    const source = pool[i % pool.length];
    plan.push({
      date: day,
      title: todayClassTitle(day),
      sourceId: String(source._id),
      sourceTitle: source.title,
    });
  }

  if (!options.dryRun) {
    const byId = new Map(published.map((c) => [String(c._id), c]));
    await RecordedClass.insertMany(
      plan.map((p) => {
        const source = byId.get(p.sourceId)!;
        return {
          title: p.title,
          classDate: new Date(`${p.date}T06:00:00-05:00`),
          startsAt: source.startsAt || "06:00",
          endsAt: source.endsAt || "07:00",
          recordingUrl: source.recordingUrl,
          notesUrl: source.notesUrl || "",
          status: "published",
        };
      }),
    );
  }

  return {
    dryRun: Boolean(options.dryRun),
    to,
    fixDate,
    created: plan.length,
    plan,
    skipped,
  };
}
