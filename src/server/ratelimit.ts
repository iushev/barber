/**
 * Rate limit с фиксиран прозорец, съхраняван в Postgres (таблица `rate_limits`).
 * Идентификаторите (IP, телефон, chat session) се хешират — в БД няма лични данни в явен вид.
 */
import { createHash } from "node:crypto";
import { lt, sql } from "drizzle-orm";
import { rateLimits } from "@/db/schema";
import type { Executor } from "@/server/db-types";

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  limit: number;
  retryAfterSec: number;
}

export interface RateLimitOptions {
  scope: string;
  id: string;
  limit: number;
  windowSec: number;
  now?: Date;
}

export function hashIdentifier(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, 32);
}

export async function consumeRateLimit(
  db: Executor,
  opts: RateLimitOptions,
): Promise<RateLimitResult> {
  const nowMs = (opts.now ?? new Date()).getTime();
  const windowMs = opts.windowSec * 1000;
  const windowStart = Math.floor(nowMs / windowMs) * windowMs;
  const expiresAt = new Date(windowStart + windowMs);
  const key = `${opts.scope}:${hashIdentifier(opts.id)}:${windowStart}`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, expiresAt })
    .onConflictDoUpdate({ target: rateLimits.key, set: { count: sql`${rateLimits.count} + 1` } })
    .returning({ count: rateLimits.count });

  // Евтино почистване на изтекли броячи (~1% от заявките).
  if (Math.random() < 0.01) {
    await db.delete(rateLimits).where(lt(rateLimits.expiresAt, new Date(nowMs)));
  }

  const count = row?.count ?? 1;
  return {
    allowed: count <= opts.limit,
    count,
    limit: opts.limit,
    retryAfterSec: Math.max(1, Math.ceil((expiresAt.getTime() - nowMs) / 1000)),
  };
}
