import crypto from "crypto";
import { CustomError } from "../errors/customError.error";

/**
 * Nuvei LATAM (ex-Paymentez), red Datafast, Ecuador. Docs:
 * https://developers.paymentez.com/api/ — no confundir con la API global de
 * Nuvei (api.nuvei.com), que es otro producto.
 *
 * El comercio tiene dos productos, cada uno con su credencial:
 *  - Link to Pay (pago único): LUPIBEJARANOLTP-EC-SERVER → hosts noccapi.
 *  - Recurrencia (Add Card + débito con token): LUPIBEJARANO-PR-EC-CLIENT
 *    tokeniza la tarjeta en el navegador y LUPIBEJARANO-PR-EC-SERVER cobra.
 *    Todo lo de tarjetas (débito, reembolso, consulta) va por ccapi.
 */
const HOSTS = {
  stg: { ltp: "https://noccapi-stg.paymentez.com", card: "https://ccapi-stg.paymentez.com" },
  prod: { ltp: "https://noccapi.paymentez.com", card: "https://ccapi.paymentez.com" },
} as const;

export type NuveiEnvironment = keyof typeof HOSTS;
export type NuveiCredentialKind = "ltp" | "cardServer" | "cardClient";

export type NuveiCredential = { appCode: string; appKey: string };

/** IVA Ecuador. El monto de los planes ya lo incluye. */
export const NUVEI_VAT_RATE = 0.15;
export const NUVEI_TAX_PERCENTAGE = 15;

/** Tope por transacción autorizado por Nuvei para este comercio. */
export const NUVEI_MAX_AMOUNT = 700;

/**
 * Nuvei exige confirmación oficial de activación antes de operar. Mientras
 * NUVEI_ENABLED no sea "true" los endpoints responden 503 y no se cobra nada.
 */
export function isNuveiEnabled(): boolean {
  return process.env.NUVEI_ENABLED === "true";
}

export function nuveiEnvironment(): NuveiEnvironment {
  return process.env.NUVEI_ENV === "prod" ? "prod" : "stg";
}

export function nuveiBaseUrl(): string {
  return HOSTS[nuveiEnvironment()].ltp;
}

export function nuveiCardBaseUrl(): string {
  return HOSTS[nuveiEnvironment()].card;
}

const ENV_NAMES: Record<NuveiCredentialKind, [string, string]> = {
  ltp: ["NUVEI_APP_CODE", "NUVEI_APP_KEY"],
  cardServer: ["NUVEI_CARD_SERVER_APP_CODE", "NUVEI_CARD_SERVER_APP_KEY"],
  cardClient: ["NUVEI_CARD_CLIENT_APP_CODE", "NUVEI_CARD_CLIENT_APP_KEY"],
};

export function findNuveiCredentials(kind: NuveiCredentialKind): NuveiCredential | null {
  const [codeName, keyName] = ENV_NAMES[kind];
  const appCode = process.env[codeName];
  const appKey = process.env[keyName];
  return appCode && appKey ? { appCode, appKey } : null;
}

export function getNuveiCredentials(kind: NuveiCredentialKind = "ltp"): NuveiCredential {
  const credential = findNuveiCredentials(kind);
  if (!credential) {
    throw new CustomError(`Missing Nuvei credentials (${kind})`, 500);
  }
  return credential;
}

/** Suscripciones: requieren Nuvei activo y las dos credenciales de Recurrencia. */
export function areSubscriptionsEnabled(): boolean {
  return (
    isNuveiEnabled() &&
    findNuveiCredentials("cardServer") !== null &&
    findNuveiCredentials("cardClient") !== null
  );
}

/**
 * Auth-Token: base64(app_code;unix_timestamp;sha256(app_key + unix_timestamp)).
 * Se regenera en cada request — el timestamp caduca a los 15 segundos.
 */
export function buildAuthToken(kind: NuveiCredentialKind = "ltp"): string {
  const { appCode, appKey } = getNuveiCredentials(kind);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hash = crypto
    .createHash("sha256")
    .update(appKey + timestamp)
    .digest("hex");
  return Buffer.from(`${appCode};${timestamp};${hash}`).toString("base64");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * stoken del webhook. Es la única prueba de que la notificación viene de Nuvei.
 * Nuvei acepta dos algoritmos y cualquiera puede llegar:
 *  - nuevo: HMAC_SHA256(key=app_key, "transaction_id_application_code_user_id")
 *  - legado: md5("transaction_id_application_code_user_id_app_key")
 * El application_code es el de la transacción, que depende del producto, así
 * que se prueba contra cada credencial configurada con ese código.
 */
export function isValidStoken(
  received: string,
  transactionId: string,
  applicationCode: string | undefined,
  userId: string,
): boolean {
  if (!received) return false;
  const normalized = received.toLowerCase();
  const credentials = (Object.keys(ENV_NAMES) as NuveiCredentialKind[])
    .map(findNuveiCredentials)
    .filter((c): c is NuveiCredential => c !== null)
    .filter((c) => !applicationCode || c.appCode === applicationCode);

  return credentials.some(({ appCode, appKey }) => {
    const message = `${transactionId}_${appCode}_${userId}`;
    const hmac = crypto.createHmac("sha256", appKey).update(message).digest("hex");
    const md5 = crypto.createHash("md5").update(`${message}_${appKey}`).digest("hex");
    return safeEqual(normalized, hmac) || safeEqual(normalized, md5);
  });
}

/** Qué credencial es dueña de un application_code (para reembolsar con la correcta). */
export function credentialKindForAppCode(appCode: string | null | undefined): NuveiCredentialKind | null {
  if (!appCode) return null;
  const kinds = Object.keys(ENV_NAMES) as NuveiCredentialKind[];
  return kinds.find((kind) => findNuveiCredentials(kind)?.appCode === appCode) ?? null;
}

/** IVA contenido en un monto que ya lo incluye. */
export function vatIncludedIn(amount: number): number {
  return Math.round(amount * (NUVEI_VAT_RATE / (1 + NUVEI_VAT_RATE)) * 100) / 100;
}

/** Base imponible (monto sin IVA) de un monto que ya incluye IVA. */
export function taxableAmountOf(amount: number): number {
  return Math.round((amount - vatIncludedIn(amount)) * 100) / 100;
}

/**
 * Nuvei exige validar la aprobación con status + status_detail. En el webhook
 * status llega como "1" y en las respuestas de ccapi como "success".
 */
export function isApprovedTransaction(status: unknown, statusDetail: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return (s === "1" || s === "success") && String(statusDetail) === "3";
}
