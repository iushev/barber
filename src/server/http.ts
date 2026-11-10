import "server-only";
import { env } from "@/config/env";
import { isBookingError } from "@/server/booking/errors";

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    [extra: string]: unknown;
  };
}

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** Единен формат на грешките: `{ "error": { "code", "message", ... } }`. */
export function jsonError(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Response {
  const body: ApiErrorBody = { error: { code, message, ...extra } };
  return json(body, status, headers);
}

/**
 * Превръща грешка в HTTP отговор. Домейн грешките (BookingError) се връщат с техния
 * код и съобщение; всичко друго е 500 без вътрешни детайли. В логовете — само тип,
 * код и съобщение (без тела на заявки → без лични данни).
 */
export function errorResponse(err: unknown, context: string): Response {
  if (isBookingError(err)) {
    const extra: Record<string, unknown> = {};
    if (err.details.alternatives) extra.alternatives = err.details.alternatives;
    if (err.details.fields) extra.fields = err.details.fields;
    const headers: Record<string, string> = {};
    if (err.details.retryAfterSec) headers["Retry-After"] = String(err.details.retryAfterSec);
    return jsonError(err.httpStatus, err.code, err.message, extra, headers);
  }
  const e = err as { name?: string; code?: string; message?: string };
  console.error(
    `[${context}] неочаквана грешка: ${e?.name ?? "Error"}${e?.code ? ` (${e.code})` : ""}: ${e?.message ?? String(err)}`,
  );
  return jsonError(500, "internal_error", "Възникна вътрешна грешка. Опитайте отново по-късно.");
}

/**
 * IP адрес на клиента. X-Forwarded-For е нормализиран от docker/forwarded-headers.mjs:
 * без доверен прокси съдържа само адреса на сокета; с TRUST_PROXY=true последният
 * елемент е проксито, а предпоследният — клиентът, както го е видяло проксито.
 */
export function clientIp(req: Request): string {
  const parts = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "unknown";
  if (env().TRUST_PROXY && parts.length >= 2) return parts[parts.length - 2]!;
  return parts[parts.length - 1]!;
}

/** Чете JSON тяло с ограничение на размера. Връща `undefined` при невалиден JSON. */
export async function readJsonBody(req: Request, maxBytes = 8 * 1024): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return undefined;
  const text = await req.text();
  if (text.length > maxBytes) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
