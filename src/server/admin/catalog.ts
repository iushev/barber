/**
 * Админ операции върху каталога: бръснари, услуги, седмичен график, изключения.
 * Всички функции приемат Executor (БД или транзакция) → тестваеми без Next.js.
 */
import { and, asc, eq, gt, gte, inArray } from "drizzle-orm";
import {
  barberServices,
  barbers,
  bookings,
  scheduleExceptions,
  services,
  workingHours,
} from "@/db/schema";
import {
  barberFormSchema,
  exceptionFormSchema,
  serviceFormSchema,
  weeklyScheduleSchema,
} from "@/lib/validation/admin";
import { uuidSchema } from "@/lib/validation/booking";
import type { Executor } from "@/server/db-types";
import { AdminError, isUniqueViolation, parseAdmin } from "./errors";

const id = (v: unknown) => parseAdmin(uuidSchema, v);

// ---------------------------------------------------------------------------
// Бръснари
// ---------------------------------------------------------------------------

export async function listBarbers(db: Executor) {
  return db.select().from(barbers).orderBy(asc(barbers.sortOrder), asc(barbers.name));
}

export async function getBarber(db: Executor, barberId: string) {
  if (!uuidSchema.safeParse(barberId).success) return null;
  const [barber] = await db.select().from(barbers).where(eq(barbers.id, barberId));
  if (!barber) return null;
  const links = await db
    .select({ serviceId: barberServices.serviceId })
    .from(barberServices)
    .where(eq(barberServices.barberId, barberId));
  return { ...barber, serviceIds: links.map((l) => l.serviceId) };
}

async function setBarberServices(db: Executor, barberId: string, serviceIds: string[]) {
  await db.delete(barberServices).where(eq(barberServices.barberId, barberId));
  const unique = [...new Set(serviceIds)];
  if (unique.length === 0) return;
  const existing = await db
    .select({ id: services.id })
    .from(services)
    .where(inArray(services.id, unique));
  if (existing.length !== unique.length)
    throw new AdminError("Някоя от избраните услуги не съществува.");
  await db.insert(barberServices).values(unique.map((serviceId) => ({ barberId, serviceId })));
}

export async function createBarber(db: Executor, input: unknown): Promise<string> {
  const data = parseAdmin(barberFormSchema, input);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(barbers)
        .values({ name: data.name, slug: data.slug, bio: data.bio, sortOrder: data.sortOrder })
        .returning({ id: barbers.id });
      await setBarberServices(tx, row!.id, data.serviceIds);
      return row!.id;
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new AdminError("Този адрес (slug) вече се използва.", { slug: "Зает" });
    throw err;
  }
}

export async function updateBarber(db: Executor, barberId: string, input: unknown): Promise<void> {
  const bid = id(barberId);
  const data = parseAdmin(barberFormSchema, input);
  try {
    await db.transaction(async (tx) => {
      const res = await tx
        .update(barbers)
        .set({ name: data.name, slug: data.slug, bio: data.bio, sortOrder: data.sortOrder })
        .where(eq(barbers.id, bid))
        .returning({ id: barbers.id });
      if (res.length === 0) throw new AdminError("Бръснарят не е намерен.");
      await setBarberServices(tx, bid, data.serviceIds);
    });
  } catch (err) {
    if (isUniqueViolation(err))
      throw new AdminError("Този адрес (slug) вече се използва.", { slug: "Зает" });
    throw err;
  }
}

export async function setBarberPhoto(db: Executor, barberId: string, photoPath: string | null) {
  const [prev] = await db
    .select({ photoPath: barbers.photoPath })
    .from(barbers)
    .where(eq(barbers.id, id(barberId)));
  if (!prev) throw new AdminError("Бръснарят не е намерен.");
  await db.update(barbers).set({ photoPath }).where(eq(barbers.id, barberId));
  return prev.photoPath;
}

/** Бъдещи потвърдени резервации — за предупреждението при деактивиране. */
export async function futureBookingsFor(
  db: Executor,
  filter: { barberId?: string; serviceId?: string },
  now = new Date(),
) {
  const conds = [eq(bookings.status, "confirmed"), gt(bookings.startAt, now)];
  if (filter.barberId) conds.push(eq(bookings.barberId, filter.barberId));
  if (filter.serviceId) conds.push(eq(bookings.serviceId, filter.serviceId));
  return db
    .select({
      id: bookings.id,
      startAt: bookings.startAt,
      customerName: bookings.customerName,
      customerPhone: bookings.customerPhone,
      serviceName: bookings.serviceName,
      barberName: barbers.name,
    })
    .from(bookings)
    .innerJoin(barbers, eq(barbers.id, bookings.barberId))
    .where(and(...conds))
    .orderBy(asc(bookings.startAt));
}

export type ActiveToggleResult = { ok: true } | { ok: false; needsConfirm: true; affected: number };

/**
 * Активиране/деактивиране (soft delete). При бъдещи резервации деактивирането
 * изисква изрично потвърждение (`confirmed`). Резервациите НЕ се отменят автоматично —
 * администраторът решава какво да прави с всяка от тях.
 */
export async function setBarberActive(
  db: Executor,
  barberId: string,
  active: boolean,
  confirmed: boolean,
): Promise<ActiveToggleResult> {
  const bid = id(barberId);
  if (!active && !confirmed) {
    const affected = await futureBookingsFor(db, { barberId: bid });
    if (affected.length > 0) return { ok: false, needsConfirm: true, affected: affected.length };
  }
  await db.update(barbers).set({ active }).where(eq(barbers.id, bid));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Услуги
// ---------------------------------------------------------------------------

export async function listServices(db: Executor) {
  return db.select().from(services).orderBy(asc(services.sortOrder), asc(services.name));
}

export async function getService(db: Executor, serviceId: string) {
  if (!uuidSchema.safeParse(serviceId).success) return null;
  const [row] = await db.select().from(services).where(eq(services.id, serviceId));
  return row ?? null;
}

export async function createService(db: Executor, input: unknown): Promise<string> {
  const d = parseAdmin(serviceFormSchema, input);
  const [row] = await db
    .insert(services)
    .values({
      name: d.name,
      description: d.description,
      durationMin: d.durationMin,
      priceCents: d.price,
      sortOrder: d.sortOrder,
    })
    .returning({ id: services.id });
  return row!.id;
}

/** Промяна на цена/продължителност не засяга съществуващите резервации (snapshot). */
export async function updateService(db: Executor, serviceId: string, input: unknown) {
  const d = parseAdmin(serviceFormSchema, input);
  const res = await db
    .update(services)
    .set({
      name: d.name,
      description: d.description,
      durationMin: d.durationMin,
      priceCents: d.price,
      sortOrder: d.sortOrder,
    })
    .where(eq(services.id, id(serviceId)))
    .returning({ id: services.id });
  if (res.length === 0) throw new AdminError("Услугата не е намерена.");
}

export async function setServiceActive(
  db: Executor,
  serviceId: string,
  active: boolean,
  confirmed: boolean,
): Promise<ActiveToggleResult> {
  const sid = id(serviceId);
  if (!active && !confirmed) {
    const affected = await futureBookingsFor(db, { serviceId: sid });
    if (affected.length > 0) return { ok: false, needsConfirm: true, affected: affected.length };
  }
  await db.update(services).set({ active }).where(eq(services.id, sid));
  return { ok: true };
}

// ---------------------------------------------------------------------------
// График
// ---------------------------------------------------------------------------

/** Седмичен график като масив от 7 дни (индекс 0 = понеделник). */
export async function getWeeklySchedule(db: Executor, barberId: string) {
  const rows = await db
    .select()
    .from(workingHours)
    .where(eq(workingHours.barberId, id(barberId)));
  return [1, 2, 3, 4, 5, 6, 7].map((weekday) => {
    const r = rows.find((x) => x.weekday === weekday);
    return r
      ? {
          enabled: true as const,
          start: r.startTime.slice(0, 5),
          end: r.endTime.slice(0, 5),
          breakStart: r.breakStart?.slice(0, 5) ?? null,
          breakEnd: r.breakEnd?.slice(0, 5) ?? null,
        }
      : { enabled: false as const };
  });
}

export async function saveWeeklySchedule(db: Executor, barberId: string, input: unknown) {
  const bid = id(barberId);
  const days = parseAdmin(weeklyScheduleSchema, input);
  await db.transaction(async (tx) => {
    await tx.delete(workingHours).where(eq(workingHours.barberId, bid));
    const rows = days.flatMap((d, i) =>
      d.enabled && d.start && d.end
        ? [
            {
              barberId: bid,
              weekday: i + 1,
              startTime: d.start,
              endTime: d.end,
              breakStart: d.breakStart,
              breakEnd: d.breakEnd,
            },
          ]
        : [],
    );
    if (rows.length) await tx.insert(workingHours).values(rows);
  });
}

export async function listExceptions(db: Executor, barberId: string, fromDate: string) {
  return db
    .select()
    .from(scheduleExceptions)
    .where(
      and(eq(scheduleExceptions.barberId, id(barberId)), gte(scheduleExceptions.date, fromDate)),
    )
    .orderBy(asc(scheduleExceptions.date));
}

/** Добавя или заменя изключението за датата. */
export async function upsertException(db: Executor, barberId: string, input: unknown) {
  const bid = id(barberId);
  const e = parseAdmin(exceptionFormSchema, input);
  const values =
    e.type === "off"
      ? {
          type: e.type,
          startTime: null,
          endTime: null,
          breakStart: null,
          breakEnd: null,
          note: e.note,
        }
      : {
          type: e.type,
          startTime: e.start,
          endTime: e.end,
          breakStart: e.breakStart,
          breakEnd: e.breakEnd,
          note: e.note,
        };
  await db
    .insert(scheduleExceptions)
    .values({ barberId: bid, date: e.date, ...values })
    .onConflictDoUpdate({
      target: [scheduleExceptions.barberId, scheduleExceptions.date],
      set: values,
    });
}

export async function deleteException(db: Executor, exceptionId: string) {
  await db.delete(scheduleExceptions).where(eq(scheduleExceptions.id, id(exceptionId)));
}
