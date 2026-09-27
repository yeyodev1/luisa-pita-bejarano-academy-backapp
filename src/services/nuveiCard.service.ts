import axios, { AxiosError } from "axios";
import { CustomError } from "../errors/customError.error";
import {
  NUVEI_TAX_PERCENTAGE,
  NuveiCredentialKind,
  buildAuthToken,
  nuveiCardBaseUrl,
  taxableAmountOf,
  vatIncludedIn,
} from "../config/nuvei";

/**
 * Cliente de la API de tarjetas de Nuvei LATAM (ccapi). Solo habla con Nuvei;
 * la lógica de negocio (accesos, correos) vive en los servicios que lo usan.
 * https://developers.paymentez.com/api/#payment-methods-cards
 */

export type NuveiTransaction = {
  id?: string;
  status?: string;
  current_status?: string;
  status_detail?: number | string;
  authorization_code?: string | null;
  amount?: number | string;
  dev_reference?: string;
  message?: string | null;
  payment_date?: string | null;
  carrier_code?: string | null;
};

export type NuveiCardInfo = {
  token?: string;
  status?: string;
  bin?: string;
  number?: string;
  type?: string;
  expiry_month?: string;
  expiry_year?: string;
  transaction_reference?: string | null;
  holder_name?: string;
};

type NuveiErrorBody = { error?: { type?: string; help?: string; description?: string } };

function headers(kind: NuveiCredentialKind) {
  return { "Auth-Token": buildAuthToken(kind), "Content-Type": "application/json" };
}

/** Traduce el error de Nuvei a algo accionable sin filtrar datos internos. */
function nuveiError(error: unknown, action: string): CustomError {
  if (error instanceof CustomError) return error;
  const axiosError = error as AxiosError<NuveiErrorBody>;
  const body = axiosError.response?.data;
  console.error(`[Nuvei] ${action} failed:`, body ?? axiosError.message);
  const type = body?.error?.type;
  return new CustomError(type ? `Nuvei: ${type}` : `No se pudo ${action}`, 502);
}

export type DebitInput = {
  user: { id: string; email: string; ip?: string };
  amount: number;
  description: string;
  devReference: string;
  cardToken: string;
};

/**
 * Débito con token (Recurrencia). No lleva 3DS: la credencial de Recurrencia
 * no lo soporta. Devuelve la transacción aunque sea rechazada; solo lanza si
 * Nuvei no respondió.
 */
export async function debitWithToken(input: DebitInput) {
  try {
    const { data } = await axios.post<{ transaction?: NuveiTransaction; card?: NuveiCardInfo }>(
      `${nuveiCardBaseUrl()}/v2/transaction/debit/`,
      {
        user: {
          id: input.user.id,
          email: input.user.email,
          ...(input.user.ip ? { ip_address: input.user.ip } : {}),
        },
        order: {
          amount: input.amount,
          description: input.description.slice(0, 250),
          dev_reference: input.devReference,
          vat: vatIncludedIn(input.amount),
          taxable_amount: taxableAmountOf(input.amount),
          tax_percentage: NUVEI_TAX_PERCENTAGE,
        },
        card: { token: input.cardToken },
      },
      { headers: headers("cardServer"), timeout: 45_000 },
    );
    return { transaction: data.transaction ?? {}, card: data.card ?? {} };
  } catch (error) {
    // Un 4xx con cuerpo de transacción (tarjeta rechazada) sigue siendo respuesta.
    const body = (error as AxiosError<{ transaction?: NuveiTransaction; card?: NuveiCardInfo }>)
      .response?.data;
    if (body?.transaction) return { transaction: body.transaction, card: body.card ?? {} };
    throw nuveiError(error, "procesar el cobro");
  }
}

/**
 * Reembolso total. Requisito bancario obligatorio de Nuvei. Se hace con la
 * credencial dueña de la transacción (Link to Pay o Recurrencia).
 */
export async function refundTransaction(transactionId: string, kind: NuveiCredentialKind) {
  try {
    const { data } = await axios.post<{
      status?: string;
      detail?: string;
      transaction?: NuveiTransaction;
    }>(
      `${nuveiCardBaseUrl()}/v2/transaction/refund/`,
      { transaction: { id: transactionId }, more_info: true },
      { headers: headers(kind), timeout: 45_000 },
    );
    return { status: data.status ?? "failure", detail: data.detail ?? "", transaction: data.transaction };
  } catch (error) {
    throw nuveiError(error, "reembolsar la transacción");
  }
}

/** Estado actual de una transacción según Nuvei. */
export async function getTransaction(transactionId: string, kind: NuveiCredentialKind) {
  try {
    const { data } = await axios.get<{ transaction?: NuveiTransaction; card?: NuveiCardInfo }>(
      `${nuveiCardBaseUrl()}/v2/transaction/${encodeURIComponent(transactionId)}`,
      { headers: headers(kind), timeout: 20_000 },
    );
    return { transaction: data.transaction ?? {}, card: data.card ?? {} };
  } catch (error) {
    throw nuveiError(error, "consultar la transacción");
  }
}

/**
 * Verifica una transacción pendiente. La credencial CLIENT de Recurrencia pide
 * OTP al agregar la tarjeta; también lo pide Diners en ciertos casos.
 */
export async function verifyTransaction(input: {
  userId: string;
  transactionId: string;
  type: "BY_OTP" | "BY_AMOUNT" | "BY_AUTH_CODE";
  value: string;
}) {
  try {
    const { data } = await axios.post<{
      status?: number | string;
      status_detail?: number | string;
      transaction_id?: string;
      message?: string;
    }>(
      `${nuveiCardBaseUrl()}/v2/transaction/verify`,
      {
        user: { id: input.userId },
        transaction: { id: input.transactionId },
        type: input.type,
        value: input.value,
      },
      { headers: headers("cardServer"), timeout: 30_000 },
    );
    return data;
  } catch (error) {
    throw nuveiError(error, "verificar la tarjeta");
  }
}

/** Tarjetas guardadas de un usuario. Sirve para validar el token que manda el navegador. */
export async function listCards(userId: string) {
  try {
    const { data } = await axios.get<{ cards?: NuveiCardInfo[] }>(
      `${nuveiCardBaseUrl()}/v2/card/list`,
      { headers: headers("cardServer"), params: { uid: userId }, timeout: 20_000 },
    );
    return data.cards ?? [];
  } catch (error) {
    throw nuveiError(error, "consultar las tarjetas");
  }
}

export async function deleteCard(userId: string, cardToken: string) {
  try {
    await axios.post(
      `${nuveiCardBaseUrl()}/v2/card/delete/`,
      { card: { token: cardToken }, user: { id: userId } },
      { headers: headers("cardServer"), timeout: 20_000 },
    );
  } catch (error) {
    throw nuveiError(error, "eliminar la tarjeta");
  }
}
