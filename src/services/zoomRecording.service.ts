import crypto from "crypto";
import { RecordedClass } from "../models/RecordedClass";
import { CustomError } from "../errors/customError.error";
import { getMainClassSession } from "./weeklySchedule.service";
import { todayClassTitle } from "./missedClassEmail.service";
import { announceRecordedClass } from "./contentAnnouncement.service";

/**
 * Webhook de Zoom (`recording.completed`): cuando termina de procesarse la
 * grabación en la nube de la clase diaria, se publica sola en Clases grabadas
 * y se avisa por correo a las alumnas activas. Así nadie tiene que dejar una
 * computadora grabando ni subir el enlace a mano.
 *
 * Variables de entorno:
 * - ZOOM_WEBHOOK_SECRET_TOKEN (obligatoria): "Secret Token" de la app de Zoom.
 * - ZOOM_CLASS_MEETING_ID (opcional): ID de la reunión de la clase; por defecto
 *   el de la clase principal del horario semanal (admin).
 * - ZOOM_MIN_RECORDING_MINUTES (opcional, 10): ignora grabaciones más cortas
 *   (pruebas o reuniones que se cortaron).
 * - ZOOM_AUTO_ANNOUNCE ("false" para no enviar correo).
 */

const TZ = "America/Guayaquil";
const MAX_SKEW_SECONDS = 5 * 60;

type ZoomRecordingFile = { file_type?: string; status?: string };
type ZoomRecordingObject = {
  id?: number | string;
  uuid?: string;
  topic?: string;
  start_time?: string;
  duration?: number;
  share_url?: string;
  recording_play_passcode?: string;
  password?: string;
  recording_files?: ZoomRecordingFile[];
};
type ZoomEvent = {
  event?: string;
  payload?: { plainToken?: string; object?: ZoomRecordingObject };
};

function secret() {
  const value = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  if (!value) throw new CustomError("Zoom webhook is not configured", 503);
  return value;
}

const hmac = (key: string, message: string) =>
  crypto.createHmac("sha256", key).update(message).digest("hex");

/** Verifica x-zm-signature = v0=HMAC(secret, "v0:{timestamp}:{body}"). */
export function verifySignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
) {
  if (!timestamp || !signature)
    throw new CustomError("Missing Zoom signature", 401);
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_SKEW_SECONDS)
    throw new CustomError("Stale Zoom request", 401);
  const expected = `v0=${hmac(secret(), `v0:${timestamp}:${rawBody}`)}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b))
    throw new CustomError("Invalid Zoom signature", 401);
}

async function classMeetingId() {
  const fromEnv = process.env.ZOOM_CLASS_MEETING_ID;
  const id = fromEnv || (await getMainClassSession())?.meetingId || "";
  return id.replace(/\D/g, "");
}

function ecuadorParts(date: Date) {
  const day = date.toLocaleDateString("sv-SE", { timeZone: TZ });
  const time = date.toLocaleTimeString("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return { day, time };
}

/** Enlace para ver la grabación sin pedir el código de acceso. */
function playbackUrl(object: ZoomRecordingObject) {
  const url = object.share_url as string;
  const passcode = object.recording_play_passcode;
  if (!passcode || /[?&]pwd=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}pwd=${encodeURIComponent(passcode)}`;
}

async function publishRecording(object: ZoomRecordingObject) {
  if (String(object.id ?? "").replace(/\D/g, "") !== (await classMeetingId()))
    return { skipped: "otra reunión" };
  const minMinutes = Number(process.env.ZOOM_MIN_RECORDING_MINUTES || 10);
  if ((object.duration ?? 0) < minMinutes)
    return { skipped: `grabación de menos de ${minMinutes} min` };
  if (!object.uuid || !object.share_url || !object.start_time)
    return { skipped: "faltan datos de la grabación" };
  const hasVideo = (object.recording_files ?? []).some(
    (f) => f.file_type === "MP4",
  );
  if (!hasVideo) return { skipped: "la grabación no tiene video" };

  const start = new Date(object.start_time);
  const end = new Date(start.getTime() + (object.duration ?? 60) * 60000);
  const { day, time: startsAt } = ecuadorParts(start);
  const fields = {
    title: todayClassTitle(day),
    classDate: start,
    startsAt,
    endsAt: ecuadorParts(end).time,
    recordingUrl: playbackUrl(object),
    status: "published" as const,
    source: "zoom" as const,
    zoomMeetingUuid: object.uuid,
  };

  const already = await RecordedClass.findOne({
    zoomMeetingUuid: object.uuid,
  });
  if (already) return { skipped: "ya publicada", id: String(already._id) };

  // Si ese día ya había una clase cargada a mano (o un relleno con otra
  // grabación), se reemplaza por la grabación real en vez de duplicarla.
  const dayStart = new Date(`${day}T00:00:00-05:00`);
  const dayEnd = new Date(`${day}T23:59:59-05:00`);
  const sameDay = await RecordedClass.findOne({
    classDate: { $gte: dayStart, $lte: dayEnd },
    zoomMeetingUuid: { $exists: false },
  });
  const cls = sameDay
    ? await RecordedClass.findByIdAndUpdate(sameDay._id, fields, { new: true })
    : await RecordedClass.create(fields);
  if (!cls) return { skipped: "no se pudo guardar" };

  if (process.env.ZOOM_AUTO_ANNOUNCE !== "false")
    await announceRecordedClass(String(cls._id));
  return { published: String(cls._id), replaced: Boolean(sameDay) };
}

export async function handleZoomWebhook(
  body: ZoomEvent,
  rawBody: string,
  headers: { timestamp?: string; signature?: string },
) {
  verifySignature(rawBody, headers.timestamp, headers.signature);

  // Zoom valida la URL al guardar la app y cada 72 h.
  if (body.event === "endpoint.url_validation") {
    const plainToken = String(body.payload?.plainToken ?? "");
    return { plainToken, encryptedToken: hmac(secret(), plainToken) };
  }
  if (body.event === "recording.completed" && body.payload?.object) {
    const result = await publishRecording(body.payload.object);
    console.log("[Zoom] recording.completed:", JSON.stringify(result));
    return result;
  }
  return { ignored: body.event ?? "sin evento" };
}
