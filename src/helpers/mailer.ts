import { Resend } from "resend";

/**
 * Envío de correos con respaldo. Primero intenta con la cuenta principal de
 * Resend (RESEND_API_KEY / RESEND_FROM_EMAIL, dominio de Luisa); si Resend la
 * rechaza (por ejemplo, cuota agotada) reintenta con la cuenta de respaldo
 * (RESEND_FALLBACK_API_KEY / RESEND_FALLBACK_FROM_EMAIL). Solo lanza si fallan
 * las dos, para que ningún aviso importante se pierda en silencio.
 */

type MailAccount = { label: "principal" | "respaldo"; client: Resend; from: string };

export type MailPayload = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

let cached: MailAccount[] | null = null;

function accounts(): MailAccount[] {
  if (cached) return cached;
  const list: MailAccount[] = [];
  const primaryKey = process.env.RESEND_API_KEY;
  const primaryFrom = process.env.RESEND_FROM_EMAIL;
  if (primaryKey && primaryFrom) list.push({ label: "principal", client: new Resend(primaryKey), from: primaryFrom });
  const fallbackKey = process.env.RESEND_FALLBACK_API_KEY;
  const fallbackFrom = process.env.RESEND_FALLBACK_FROM_EMAIL || primaryFrom;
  if (fallbackKey && fallbackFrom && fallbackKey !== primaryKey) {
    list.push({ label: "respaldo", client: new Resend(fallbackKey), from: fallbackFrom });
  }
  cached = list;
  return list;
}

function describe(error: unknown) {
  if (error && typeof error === "object" && "message" in error) return String((error as { message: unknown }).message);
  return String(error);
}

export async function sendMail(payload: MailPayload): Promise<{ id: string | null; account: string }> {
  const list = accounts();
  if (!list.length) throw new Error("Resend no está configurado");
  const failures: string[] = [];

  for (const account of list) {
    try {
      const { data, error } = await account.client.emails.send({ ...payload, from: account.from });
      if (!error) {
        if (account.label === "respaldo") console.warn("[Mailer] Enviado con la cuenta de respaldo:", payload.subject);
        return { id: data?.id ?? null, account: account.label };
      }
      failures.push(`${account.label}: ${error.message}`);
    } catch (err) {
      failures.push(`${account.label}: ${describe(err)}`);
    }
    console.error("[Mailer] Falló la cuenta", account.label, "→", failures[failures.length - 1]);
  }
  throw new Error(`Resend: ${failures.join(" | ")}`);
}

export async function sendMailBatch(payloads: MailPayload[]): Promise<{ account: string }> {
  const list = accounts();
  if (!list.length) throw new Error("Resend no está configurado");
  const failures: string[] = [];

  for (const account of list) {
    try {
      const { error } = await account.client.batch.send(payloads.map((p) => ({ ...p, from: account.from })));
      if (!error) {
        if (account.label === "respaldo") console.warn("[Mailer] Lote enviado con la cuenta de respaldo");
        return { account: account.label };
      }
      failures.push(`${account.label}: ${error.message}`);
    } catch (err) {
      failures.push(`${account.label}: ${describe(err)}`);
    }
    console.error("[Mailer] Falló el lote en la cuenta", account.label, "→", failures[failures.length - 1]);
  }
  throw new Error(`Resend batch: ${failures.join(" | ")}`);
}

/**
 * Tarea que no debe retrasar la respuesta al navegador (p. ej. correos tras un
 * pago). En Vercel se registra con waitUntil para que termine después de
 * responder. Si no hay waitUntil, se espera como máximo `maxWaitMs` y se sigue.
 * Siempre resuelve: los errores solo se registran.
 */
export function runInBackground(task: Promise<unknown>, label: string, maxWaitMs = 5000): Promise<void> {
  const guarded = task.then(
    () => undefined,
    (err) => console.error(`[Background] ${label}:`, err),
  );
  const context = (globalThis as Record<symbol, { get?: () => { waitUntil?: (p: Promise<unknown>) => void } } | undefined>)[
    Symbol.for("@vercel/request-context")
  ];
  const waitUntil = context?.get?.()?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil(guarded);
    return Promise.resolve();
  }
  return Promise.race([guarded, new Promise<void>((resolve) => setTimeout(resolve, maxWaitMs))]);
}
