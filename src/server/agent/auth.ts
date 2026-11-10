import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "@/config/env";
import { getDb } from "@/db";
import { clientIp, jsonError } from "@/server/http";
import { consumeRateLimit } from "@/server/ratelimit";

/** Неуспешни опити за автентикация от един IP в минута, преди да върнем 429. */
const AUTH_FAILURES_PER_MIN = 20;

let warnedMissingKey = false;

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();

/**
 * Constant-time сравнение: сравняваме SHA-256 на двете стойности, така че времето не
 * зависи нито от съдържанието, нито от дължината на подадения ключ.
 */
export function isValidAgentKey(
  authorization: string | null,
  expected: string | undefined,
): boolean {
  if (!expected || !authorization) return false;
  const m = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  const provided = m?.[1] ?? "";
  return timingSafeEqual(digest(provided), digest(expected)) && provided.length > 0;
}

/**
 * Автентикация + rate limit за Agent API. Връща Response при отказ, иначе null.
 * Ключът никога не се логва.
 */
export async function guardAgentRequest(req: Request): Promise<Response | null> {
  const { AGENT_API_KEY, AGENT_API_RATE_LIMIT_PER_MIN } = env();
  const db = getDb();

  if (!AGENT_API_KEY && !warnedMissingKey) {
    warnedMissingKey = true;
    console.warn(
      "[agent-api] AGENT_API_KEY не е зададен — всички заявки към Agent API се отказват",
    );
  }

  if (!isValidAgentKey(req.headers.get("authorization"), AGENT_API_KEY)) {
    const rl = await consumeRateLimit(db, {
      scope: "agent:authfail",
      id: clientIp(req),
      limit: AUTH_FAILURES_PER_MIN,
      windowSec: 60,
    });
    if (!rl.allowed) {
      return jsonError(
        429,
        "rate_limited",
        "Твърде много неуспешни опити.",
        {},
        {
          "Retry-After": String(rl.retryAfterSec),
        },
      );
    }
    return jsonError(
      401,
      "unauthorized",
      "Липсва или е невалиден API ключ.",
      {},
      {
        "WWW-Authenticate": 'Bearer realm="agent-api"',
      },
    );
  }

  const rl = await consumeRateLimit(db, {
    scope: "agent:api",
    id: "n8n",
    limit: AGENT_API_RATE_LIMIT_PER_MIN,
    windowSec: 60,
  });
  if (!rl.allowed) {
    return jsonError(
      429,
      "rate_limited",
      "Твърде много заявки. Опитайте след малко.",
      {},
      {
        "Retry-After": String(rl.retryAfterSec),
      },
    );
  }
  return null;
}
