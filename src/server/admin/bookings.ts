/**
 * Админ заявки върху резервации: списък с филтри и лични данни (GDPR).
 * Промените по статус/час минават през booking service.
 */
import {
  and,
  desc,
  asc,
  count,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import { barbers, bookings, idempotencyKeys } from "@/db/schema";
import { bookingFiltersSchema, type BookingFilters } from "@/lib/validation/admin";
import { normalizePhone } from "@/lib/validation/booking";
import type { Executor } from "@/server/db-types";
import { addDaysToDateString, zonedToUtc } from "@/server/time";

export const PAGE_SIZE = 50;
export const ANONYMIZED_NAME = "Анонимизиран клиент";

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export function parseBookingFilters(
  input: Record<string, string | string[] | undefined>,
): BookingFilters {
  const flat = Object.fromEntries(
    Object.entries(input).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v || undefined]),
  );
  return bookingFiltersSchema.parse(flat);
}

export async function listBookings(db: Executor, f: BookingFilters, tz: string) {
  const conds: SQL[] = [];
  if (f.from) conds.push(gte(bookings.startAt, zonedToUtc(f.from, "00:00", tz)));
  if (f.to) conds.push(lt(bookings.startAt, zonedToUtc(addDaysToDateString(f.to, 1), "00:00", tz)));
  if (f.barberId) conds.push(eq(bookings.barberId, f.barberId));
  if (f.status) conds.push(eq(bookings.status, f.status));
  if (f.q) {
    const phone = normalizePhone(f.q);
    const digits = f.q.replace(/\D/g, "");
    const byName = ilike(bookings.customerName, `%${escapeLike(f.q)}%`);
    if (phone) conds.push(eq(bookings.customerPhone, phone));
    else if (digits.length >= 4)
      conds.push(or(byName, ilike(bookings.customerPhone, `%${digits}%`))!);
    else conds.push(byName);
  }
  const where = conds.length ? and(...conds) : undefined;

  const [total] = await db.select({ n: count() }).from(bookings).where(where);
  // Без филтър по дата: най-новите първо; с филтър — хронологично.
  const order = f.from || f.to ? asc(bookings.startAt) : desc(bookings.startAt);
  const rows = await db
    .select({
      id: bookings.id,
      startAt: bookings.startAt,
      endAt: bookings.endAt,
      status: bookings.status,
      source: bookings.source,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      serviceName: bookings.serviceName,
      priceCents: bookings.priceCents,
      currency: bookings.currency,
      barberName: barbers.name,
      anonymizedAt: bookings.anonymizedAt,
    })
    .from(bookings)
    .innerJoin(barbers, eq(barbers.id, bookings.barberId))
    .where(where)
    .orderBy(order)
    .limit(PAGE_SIZE)
    .offset((f.page - 1) * PAGE_SIZE);

  return { rows, total: total?.n ?? 0, pageSize: PAGE_SIZE };
}

export async function countBookingsByPhone(db: Executor, phone: string): Promise<number> {
  if (!phone) return 0;
  const [r] = await db
    .select({ n: count() })
    .from(bookings)
    .where(eq(bookings.customerPhone, phone));
  return r?.n ?? 0;
}

/**
 * Анонимизира резервации (име и телефон), изтрива кешираните отговори на
 * Idempotency-Key (те също съдържат име, телефон и линк) и връща chat sessionId-тата,
 * чиято история трябва да се изчисти в n8n.
 */
export async function anonymizeBookings(
  db: Executor,
  target: { ids: string[] } | { phone: string } | { endedBefore: Date },
  now = new Date(),
): Promise<{ count: number; chatSessionIds: string[] }> {
  return db.transaction(async (tx) => {
    const where =
      "ids" in target
        ? inArray(bookings.id, target.ids)
        : "phone" in target
          ? eq(bookings.customerPhone, target.phone)
          : and(lt(bookings.endAt, target.endedBefore), isNull(bookings.anonymizedAt));
    const rows = await tx
      .update(bookings)
      .set({ customerName: ANONYMIZED_NAME, customerPhone: "", anonymizedAt: now })
      .where(where)
      .returning({ id: bookings.id, chatSessionId: bookings.chatSessionId });
    if (rows.length) {
      await tx.delete(idempotencyKeys).where(
        inArray(
          idempotencyKeys.bookingId,
          rows.map((r) => r.id),
        ),
      );
    }
    return {
      count: rows.length,
      chatSessionIds: [
        ...new Set(rows.map((r) => r.chatSessionId).filter((s): s is string => !!s)),
      ],
    };
  });
}

/** Окончателно изтриване на резервация (idempotency редовете се трият каскадно). */
export async function deleteBooking(db: Executor, bookingId: string) {
  const [row] = await db
    .delete(bookings)
    .where(eq(bookings.id, bookingId))
    .returning({ chatSessionId: bookings.chatSessionId });
  return { deleted: !!row, chatSessionIds: row?.chatSessionId ? [row.chatSessionId] : [] };
}

/** chat sessionId-та за дадени резервации (за ръчно изчистване на историята). */
export async function chatSessionsFor(db: Executor, ids: string[]) {
  const rows = await db
    .select({ s: bookings.chatSessionId })
    .from(bookings)
    .where(and(inArray(bookings.id, ids), isNotNull(bookings.chatSessionId)));
  return [...new Set(rows.map((r) => r.s!))];
}
