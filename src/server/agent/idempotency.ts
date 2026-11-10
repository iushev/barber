/**
 * Идемпотентност за POST заявки (Agent API → създаване на резервация).
 *
 * - Ключът се „резервира“ с INSERT … ON CONFLICT DO NOTHING (атомарно, и при
 *   паралелни заявки само една изпълнява операцията).
 * - Успешният отговор (201) се записва и се връща при повторение със същия ключ.
 * - При грешка (409/422/…) редът се изтрива → повторен опит със същия ключ е позволен.
 * - Същият ключ с различно тяло → 422 `idempotency_key_reused`.
 * - Ако резервацията от записания отговор вече е отменена, ключът е „остарял“ и
 *   заявката се изпълнява наново (напр. клиентът отменя и записва същия час отново).
 * - Записите изтичат след IDEMPOTENCY_TTL_HOURS. Записаният отговор съдържа
 *   manageUrl (с тайния токен) — затова TTL-ът е кратък.
 */
import { createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { bookings, idempotencyKeys } from "@/db/schema";
import { BookingError } from "@/server/booking/errors";
import type { Executor } from "@/server/db-types";

/** Видими ASCII символи без интервали (напр. "sess:2026-11-12T10:00:00+02:00"). */
export const IDEMPOTENCY_KEY_RE = /^[\x21-\x7E]{8,200}$/;

const POLL_INTERVAL_MS = 200;
const POLL_ATTEMPTS = 25; // ~5 s

export interface IdempotentResult {
  status: number;
  body: unknown;
  bookingId?: string;
}

/** Каноничен JSON (сортирани ключове) → SHA-256. */
export function hashRequestBody(body: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withIdempotency(
  db: Executor,
  opts: { scope: string; key: string; requestHash: string; ttlMs: number; now?: () => Date },
  run: () => Promise<IdempotentResult>,
): Promise<IdempotentResult & { replayed: boolean }> {
  const now = opts.now ?? (() => new Date());
  const where = and(eq(idempotencyKeys.scope, opts.scope), eq(idempotencyKeys.key, opts.key));

  if (Math.random() < 0.02) {
    await db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now()));
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const claimed = await db
      .insert(idempotencyKeys)
      .values({
        scope: opts.scope,
        key: opts.key,
        requestHash: opts.requestHash,
        expiresAt: new Date(now().getTime() + opts.ttlMs),
      })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed.length > 0) {
      let result: IdempotentResult;
      try {
        result = await run();
      } catch (err) {
        await db.delete(idempotencyKeys).where(where);
        throw err;
      }
      if (result.status >= 200 && result.status < 300) {
        await db
          .update(idempotencyKeys)
          .set({
            responseStatus: result.status,
            responseBody: result.body,
            bookingId: result.bookingId ?? null,
          })
          .where(where);
      } else {
        await db.delete(idempotencyKeys).where(where);
      }
      return { ...result, replayed: false };
    }

    // Ключът вече съществува — чакаме, ако заявката с него още се изпълнява.
    let existing = (await db.select().from(idempotencyKeys).where(where))[0];
    for (let i = 0; existing && existing.responseStatus === null && i < POLL_ATTEMPTS; i++) {
      await sleep(POLL_INTERVAL_MS);
      existing = (await db.select().from(idempotencyKeys).where(where))[0];
    }
    if (!existing) continue; // изтрит междувременно (грешка) → опитай отново

    if (existing.expiresAt < now()) {
      await db.delete(idempotencyKeys).where(and(where, lt(idempotencyKeys.expiresAt, now())));
      continue;
    }
    if (existing.requestHash !== opts.requestHash) {
      throw new BookingError(
        "idempotency_key_reused",
        "Този Idempotency-Key вече е използван с други данни. Използвайте нов ключ.",
      );
    }
    if (existing.responseStatus === null) {
      throw new BookingError(
        "idempotency_in_progress",
        "Заявка със същия ключ още се обработва. Опитайте отново след малко.",
      );
    }
    if (existing.bookingId) {
      const [b] = await db
        .select({ status: bookings.status })
        .from(bookings)
        .where(eq(bookings.id, existing.bookingId));
      if (!b || b.status === "cancelled") {
        await db.delete(idempotencyKeys).where(where);
        continue;
      }
    }
    return {
      status: existing.responseStatus,
      body: existing.responseBody,
      bookingId: existing.bookingId ?? undefined,
      replayed: true,
    };
  }
  throw new BookingError(
    "idempotency_in_progress",
    "Заявка със същия ключ още се обработва. Опитайте отново след малко.",
  );
}
