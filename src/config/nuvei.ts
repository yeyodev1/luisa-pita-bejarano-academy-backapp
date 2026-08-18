import crypto from "crypto";
import { CustomError } from "../errors/customError.error";

/**
 * Nuvei LATAM (ex-Paymentez) — modalidad Link to Pay.
 * Credencial del comercio: LUPIBEJARANOLTP-EC-SERVER (red Datafast, Ecuador).
 *
 * Link to Pay usa los hosts noccapi; los de tarjetas (ccapi) son otro producto.
 */
const LTP_URLS = {
  stg: "https://noccapi-stg.paymentez.com",
  prod: "https://noccapi.paymentez.com",
} as const;

export type NuveiEnvironment = keyof typeof LTP_URLS;

/** IVA Ecuador. El monto de los planes ya lo incluye. */
export const NUVEI_VAT_RATE = 0.15;

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
  return LTP_URLS[nuveiEnvironment()];
}

export function getNuveiCredentials() {
  const appCode = process.env.NUVEI_APP_CODE;
  const appKey = process.env.NUVEI_APP_KEY;
  if (!appCode || !appKey) {
    throw new CustomError("Missing Nuvei credentials", 500);
  }
  return { appCode, appKey };
}

/**
 * Auth-Token: base64(app_code;unix_timestamp;sha256(app_key + unix_timestamp)).
 * Se regenera en cada request — el timestamp caduca.
 */
export function buildAuthToken(): string {
  const { appCode, appKey } = getNuveiCredentials();
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const hash = crypto
    .createHash("sha256")
    .update(appKey + timestamp)
    .digest("hex");
  return Buffer.from(`${appCode};${timestamp};${hash}`).toString("base64");
}

/**
 * stoken del webhook: md5(transaction_id_app_code_user_id_app_key).
 * Es la única prueba de que la notificación viene de Nuvei.
 */
export function buildStoken(transactionId: string, userId: string): string {
  const { appCode, appKey } = getNuveiCredentials();
  return crypto
    .createHash("md5")
    .update(`${transactionId}_${appCode}_${userId}_${appKey}`)
    .digest("hex");
}

/** IVA contenido en un monto que ya lo incluye. */
export function vatIncludedIn(amount: number): number {
  return Math.round(amount * (NUVEI_VAT_RATE / (1 + NUVEI_VAT_RATE)) * 100) / 100;
}
