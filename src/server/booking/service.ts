/**
 * Booking service — единственото място с бизнес логика за записване.
 * Формата (Server Actions), Agent API и админ панелът са тънки слоеве над него.
 *
 * Защита от двойно записване на два слоя:
 *  1. в транзакция: заключване на реда на бръснаря (SELECT … FOR UPDATE) → проверка,
 *     че часът е валиден и свободен → INSERT;
 *  2. в БД: exclusion constraint `bookings_no_overlap` (виж drizzle/0001_*.sql), който
 *     хваща всичко, което заобиколи слой 1 (напр. ръчен SQL или бъг).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, gt, gte, inArray, lt, lte, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  barberServices,
  barbers,
  bookings,
  scheduleExceptions,
  services,
  workingHours,
  type Booking,
} from "@/db/schema";
import {
  createBookingSchema,
  isoDateTimeSchema,
  slotsQuerySchema,
  uuidSchema,
} from "@/lib/validation/booking";
import type { Db, Executor } from "@/server/db-types";
import { consumeRateLimit } from "@/server/ratelimit";
import {
  checkBookingDate,
  computeSlots,
  nearestSlots,
  resolveDaySchedule,
  type Interval,
  type SlotRules,
} from "@/server/slots/compute";
import {
  addDaysToDateString,
  toZonedIso,
  zonedDateString,
  zonedTimeLabel,
  zonedToUtc,
} from "@/server/time";
import { BookingError, isBookingError, isOverlapViolation, type SlotDto } from "./errors";

export type BookingSource = "web" | "chat" | "admin";
export type BookingStatus = Booking["status"];

export interface BookingRules extends SlotRules {
  currency: string;
  maxActivePerPhone: number;
  cancelCutoffHours: number;
  rateLimits: {
    perClientPerHour: number;
    perPhonePerDay: number;
  };
}

export interface BookingServiceDeps {
  db: Db;
  rules: BookingRules;
  now?: () => Date;
}

export interface CreateBookingOptions {
  source: BookingSource;
  /** Ключ за rate limit по клиент: IP за формата, chat sessionId за агента. */
  clientKey?: string | null;
  chatSessionId?: string | null;
}

export interface ServiceWithBarbers {
  id: string;
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  barbers: { id: string; name: string }[];
}

export interface PublicBarber {
  id: string;
  name: string;
  bio: string;
  photoPath: string | null;
  services: string[];
}

export interface BookingView {
  id: string;
  start: Date;
  end: Date;
  status: BookingStatus;
  source: BookingSource;
  customerName: string;
  customerPhone: string;
  serviceId: string;
  serviceName: string;
  priceCents: number;
  currency: string;
  durationMin: number;
  barberId: string;
  barberName: string;
  createdAt: Date;
}

export interface SlotsResult {
  date: string;
  timezone: string;
  serviceId: string;
  barberId: string;
  slots: SlotDto[];
}

const ALTERNATIVES_LIMIT = 3;
const ALTERNATIVES_SEARCH_DAYS = 7;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseOrThrow<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const res = schema.safeParse(input);
  if (res.success) return res.data;
  const fields: Record<string, string> = {};
  for (const issue of res.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  const first = Object.values(fields)[0] ?? "Невалидни данни.";
  throw new BookingError("validation_error", first, { fields });
}

export function createBookingService(deps: BookingServiceDeps) {
  const { db, rules } = deps;
  const now = deps.now ?? (() => new Date());
  const tz = rules.tz;

  const toSlotDto = (s: Interval): SlotDto => ({
    start: toZonedIso(s.start, tz),
    end: toZonedIso(s.end, tz),
    label: zonedTimeLabel(s.start, tz),
  });

  // -------------------------------------------------------------------------
  // Каталог
  // -------------------------------------------------------------------------

  async function listActiveServices(): Promise<ServiceWithBarbers[]> {
    const rows = await db
      .select()
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.sortOrder), asc(services.name));
    if (rows.length === 0) return [];

    const links = await db
      .select({ serviceId: barberServices.serviceId, id: barbers.id, name: barbers.name })
      .from(barberServices)
      .innerJoin(barbers, eq(barbers.id, barberServices.barberId))
      .where(
        and(
          eq(barbers.active, true),
          inArray(
            barberServices.serviceId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(asc(barbers.sortOrder), asc(barbers.name));

    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      durationMin: s.durationMin,
      priceCents: s.priceCents,
      barbers: links.filter((l) => l.serviceId === s.id).map(({ id, name }) => ({ id, name })),
    }));
  }

  /** Активните бръснари за публичния сайт (екип), с услугите им. */
  async function listActiveBarbers(): Promise<PublicBarber[]> {
    const rows = await db
      .select()
      .from(barbers)
      .where(eq(barbers.active, true))
      .orderBy(asc(barbers.sortOrder), asc(barbers.name));
    if (rows.length === 0) return [];
    const links = await db
      .select({ barberId: barberServices.barberId, name: services.name })
      .from(barberServices)
      .innerJoin(services, eq(services.id, barberServices.serviceId))
      .where(
        and(
          eq(services.active, true),
          inArray(
            barberServices.barberId,
            rows.map((r) => r.id),
          ),
        ),
      )
      .orderBy(asc(services.sortOrder));
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      bio: b.bio,
      photoPath: b.photoPath,
      services: links.filter((l) => l.barberId === b.id).map((l) => l.name),
    }));
  }

  /**
   * Дати (в хоризонта), в които има поне един свободен час за услугата при бръснаря.
   * Изчислява се с 3 заявки за целия период вместо по една на ден.
   */
  async function getAvailableDates(
    query: unknown,
  ): Promise<{ from: string; to: string; dates: string[] }> {
    const q = parseOrThrow(z.object({ serviceId: uuidSchema, barberId: uuidSchema }), query);
    const { service } = await loadServiceAndBarber(db, q.serviceId, q.barberId, false);
    const at = now();
    const from = zonedDateString(at, tz);
    const to = addDaysToDateString(from, rules.horizonDays);

    const weekly = await db
      .select()
      .from(workingHours)
      .where(eq(workingHours.barberId, q.barberId));
    const exceptions = await db
      .select()
      .from(scheduleExceptions)
      .where(
        and(
          eq(scheduleExceptions.barberId, q.barberId),
          gte(scheduleExceptions.date, from),
          lte(scheduleExceptions.date, to),
        ),
      );
    const byDate = new Map(exceptions.map((e) => [e.date, e]));
    const busy: Interval[] = (
      await db
        .select({ start: bookings.startAt, end: bookings.endAt })
        .from(bookings)
        .where(
          and(
            eq(bookings.barberId, q.barberId),
            ne(bookings.status, "cancelled"),
            lt(bookings.startAt, zonedToUtc(addDaysToDateString(to, 1), "00:00", tz)),
            gt(bookings.endAt, zonedToUtc(from, "00:00", tz)),
          ),
        )
    ).map((b) => ({ start: b.start, end: b.end }));

    const dates: string[] = [];
    for (let date = from; date <= to; date = addDaysToDateString(date, 1)) {
      const schedule = resolveDaySchedule(date, weekly, byDate.get(date));
      if (!schedule) continue;
      const slots = computeSlots({
        date,
        schedule,
        durationMin: service.durationMin,
        busy,
        now: at,
        rules,
      });
      if (slots.length > 0) dates.push(date);
    }
    return { from, to, dates };
  }

  /**
   * Работно време на бръснарницата по дни (1 = пон … 7 = нед): най-ранното начало и
   * най-късният край сред активните бръснари. null = почивен ден.
   */
  async function getShopHours(): Promise<({ open: string; close: string } | null)[]> {
    const rows = await db
      .select({
        weekday: workingHours.weekday,
        start: workingHours.startTime,
        end: workingHours.endTime,
      })
      .from(workingHours)
      .innerJoin(barbers, eq(barbers.id, workingHours.barberId))
      .where(eq(barbers.active, true));
    return [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const day = rows.filter((r) => r.weekday === d);
      if (day.length === 0) return null;
      const open = day.map((r) => r.start.slice(0, 5)).sort()[0]!;
      const close = day
        .map((r) => r.end.slice(0, 5))
        .sort()
        .at(-1)!;
      return { open, close };
    });
  }

  async function loadServiceAndBarber(
    ex: Executor,
    serviceId: string,
    barberId: string,
    lockBarber: boolean,
  ) {
    const [service] = await ex.select().from(services).where(eq(services.id, serviceId));
    if (!service) throw new BookingError("service_not_found", "Няма такава услуга.");
    if (!service.active)
      throw new BookingError("service_inactive", "Услугата в момента не се предлага.");

    const barberQuery = ex.select().from(barbers).where(eq(barbers.id, barberId));
    const [barber] = lockBarber ? await barberQuery.for("update") : await barberQuery;
    if (!barber) throw new BookingError("barber_not_found", "Няма такъв бръснар.");
    if (!barber.active)
      throw new BookingError("barber_inactive", "Бръснарят в момента не приема записвания.");

    const [link] = await ex
      .select({ n: count() })
      .from(barberServices)
      .where(and(eq(barberServices.barberId, barberId), eq(barberServices.serviceId, serviceId)));
    if (!link || link.n === 0) {
      throw new BookingError(
        "barber_service_mismatch",
        `${barber.name} не извършва „${service.name}“.`,
      );
    }
    return { service, barber };
  }

  // -------------------------------------------------------------------------
  // Слотове
  // -------------------------------------------------------------------------

  async function loadDay(ex: Executor, barberId: string, date: string, excludeBookingId?: string) {
    const weekly = await ex.select().from(workingHours).where(eq(workingHours.barberId, barberId));
    const [exception] = await ex
      .select()
      .from(scheduleExceptions)
      .where(and(eq(scheduleExceptions.barberId, barberId), eq(scheduleExceptions.date, date)));
    const schedule = resolveDaySchedule(date, weekly, exception);

    const from = zonedToUtc(date, "00:00", tz);
    const to = zonedToUtc(addDaysToDateString(date, 1), "00:00", tz);
    const conditions = [
      eq(bookings.barberId, barberId),
      ne(bookings.status, "cancelled"),
      lt(bookings.startAt, to),
      gt(bookings.endAt, from),
    ];
    if (excludeBookingId) conditions.push(ne(bookings.id, excludeBookingId));
    const busy: Interval[] = (
      await ex
        .select({ start: bookings.startAt, end: bookings.endAt })
        .from(bookings)
        .where(and(...conditions))
    ).map((b) => ({ start: b.start, end: b.end }));

    return { schedule, busy };
  }

  function assertDateAllowed(date: string) {
    const check = checkBookingDate(date, now(), rules);
    if (check.ok) return;
    if (check.code === "date_in_past") {
      throw new BookingError(
        "date_in_past",
        "Датата е в миналото. Изберете днешна или бъдеща дата.",
      );
    }
    throw new BookingError(
      "date_beyond_horizon",
      `Може да се записвате най-много ${rules.horizonDays} дни напред.`,
    );
  }

  async function getAvailableSlots(query: unknown): Promise<SlotsResult> {
    const q = parseOrThrow(slotsQuerySchema, query);
    const { service } = await loadServiceAndBarber(db, q.serviceId, q.barberId, false);
    assertDateAllowed(q.date);
    const { schedule, busy } = await loadDay(db, q.barberId, q.date);
    const slots = computeSlots({
      date: q.date,
      schedule,
      durationMin: service.durationMin,
      busy,
      now: now(),
      rules,
    });
    return {
      date: q.date,
      timezone: tz,
      serviceId: q.serviceId,
      barberId: q.barberId,
      slots: slots.map(toSlotDto),
    };
  }

  /**
   * Слотове за администратора (ръчно добавяне/преместване): без минимално време и
   * хоризонт, но в рамките на графика и без застъпване. `excludeBookingId` — при
   * преместване резервацията не се брои за заета сама на себе си.
   */
  async function getAdminSlots(p: {
    barberId: string;
    date: string;
    durationMin: number;
    excludeBookingId?: string;
  }): Promise<SlotDto[]> {
    const barberId = parseOrThrow(uuidSchema, p.barberId);
    const date = parseOrThrow(slotsQuerySchema.shape.date, p.date);
    const { schedule, busy } = await loadDay(db, barberId, date, p.excludeBookingId);
    return computeSlots({
      date,
      schedule,
      durationMin: p.durationMin,
      busy,
      now: now(),
      rules,
      enforceLeadAndHorizon: false,
    }).map(toSlotDto);
  }

  /** До 3 свободни часа, най-близки до `around` (същия и следващите дни). */
  async function findAlternatives(
    barberId: string,
    durationMin: number,
    around: Date,
    excludeBookingId?: string,
  ): Promise<SlotDto[]> {
    const firstDate = zonedDateString(around, tz);
    const candidates: Interval[] = [];
    for (let i = 0; i < ALTERNATIVES_SEARCH_DAYS; i++) {
      const date = addDaysToDateString(firstDate, i);
      if (!checkBookingDate(date, now(), rules).ok) {
        if (date < zonedDateString(now(), tz)) continue;
        break;
      }
      const { schedule, busy } = await loadDay(db, barberId, date, excludeBookingId);
      candidates.push(...computeSlots({ date, schedule, durationMin, busy, now: now(), rules }));
      // Достатъчно кандидати след търсения момент → по-далечните дни не могат да са по-близо.
      if (candidates.filter((c) => c.start >= around).length >= ALTERNATIVES_LIMIT) break;
    }
    return nearestSlots(candidates, around, ALTERNATIVES_LIMIT).map(toSlotDto);
  }

  /**
   * Проверява, че `start` е валиден и свободен слот за бръснаря.
   * Хвърля `slot_taken` (часът съществува, но е зает) или `invalid_slot`.
   */
  async function assertSlot(
    ex: Executor,
    p: {
      barberId: string;
      durationMin: number;
      start: Date;
      enforce: boolean;
      excludeBookingId?: string;
    },
  ) {
    const date = zonedDateString(p.start, tz);
    if (p.enforce) assertDateAllowed(date);
    const { schedule, busy } = await loadDay(ex, p.barberId, date, p.excludeBookingId);
    const base = {
      date,
      schedule,
      durationMin: p.durationMin,
      now: now(),
      rules,
      enforceLeadAndHorizon: p.enforce,
    };
    const same = (s: Interval) => s.start.getTime() === p.start.getTime();
    if (computeSlots({ ...base, busy }).some(same)) return;
    if (computeSlots({ ...base, busy: [] }).some(same)) {
      throw new BookingError("slot_taken", "Този час току-що беше зает.");
    }
    throw new BookingError(
      "invalid_slot",
      "Този час не е свободен слот. Използвайте само часовете от списъка със свободни часове.",
    );
  }

  async function withAlternatives(
    err: unknown,
    barberId: string,
    durationMin: number,
    around: Date,
    excludeBookingId?: string,
  ): Promise<never> {
    if (isOverlapViolation(err) || (isBookingError(err) && err.code === "slot_taken")) {
      const alternatives = await findAlternatives(barberId, durationMin, around, excludeBookingId);
      throw new BookingError(
        "slot_taken",
        alternatives.length
          ? "Този час вече е зает. Ето най-близките свободни часове."
          : "Този час вече е зает и няма свободни часове в близките дни.",
        { alternatives },
      );
    }
    throw err;
  }

  // -------------------------------------------------------------------------
  // Създаване
  // -------------------------------------------------------------------------

  async function applyRateLimits(phone: string, clientKey: string | null | undefined) {
    const at = now();
    if (clientKey) {
      const r = await consumeRateLimit(db, {
        scope: "booking:client",
        id: clientKey,
        limit: rules.rateLimits.perClientPerHour,
        windowSec: 3600,
        now: at,
      });
      if (!r.allowed) {
        throw new BookingError(
          "rate_limited",
          "Твърде много опити за записване. Опитайте по-късно.",
          {
            retryAfterSec: r.retryAfterSec,
          },
        );
      }
    }
    const r = await consumeRateLimit(db, {
      scope: "booking:phone",
      id: phone,
      limit: rules.rateLimits.perPhonePerDay,
      windowSec: 86_400,
      now: at,
    });
    if (!r.allowed) {
      throw new BookingError(
        "rate_limited",
        "Твърде много опити за записване с този телефон днес. Обадете се в бръснарницата.",
        { retryAfterSec: r.retryAfterSec },
      );
    }
  }

  async function createBooking(
    input: unknown,
    opts: CreateBookingOptions,
  ): Promise<{ booking: BookingView; token: string }> {
    const data = parseOrThrow(createBookingSchema, input);
    const start = new Date(data.start);
    const isAdmin = opts.source === "admin";

    if (!isAdmin) await applyRateLimits(data.customerPhone, opts.clientKey);

    const token = randomBytes(32).toString("base64url");
    let durationMin = 0;
    try {
      const row = await db.transaction(async (tx) => {
        const { service, barber } = await loadServiceAndBarber(
          tx,
          data.serviceId,
          data.barberId,
          true,
        );
        durationMin = service.durationMin;
        await assertSlot(tx, {
          barberId: barber.id,
          durationMin: service.durationMin,
          start,
          enforce: !isAdmin,
        });

        if (!isAdmin) {
          // Сериализира заявките за един и същ телефон, за да е точен лимитът
          // (Drizzle няма API за advisory locks → параметризиран sql``).
          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtextextended(${`phone:${data.customerPhone}`}, 0))`,
          );
          const [active] = await tx
            .select({ n: count() })
            .from(bookings)
            .where(
              and(
                eq(bookings.customerPhone, data.customerPhone),
                eq(bookings.status, "confirmed"),
                gt(bookings.startAt, now()),
              ),
            );
          if ((active?.n ?? 0) >= rules.maxActivePerPhone) {
            throw new BookingError(
              "too_many_active_bookings",
              `С този телефон вече има ${rules.maxActivePerPhone} предстоящи часа. Отменете някой от тях или се обадете в бръснарницата.`,
            );
          }
        }

        const [inserted] = await tx
          .insert(bookings)
          .values({
            barberId: barber.id,
            serviceId: service.id,
            startAt: start,
            endAt: new Date(start.getTime() + service.durationMin * 60_000),
            customerName: data.customerName,
            customerPhone: data.customerPhone,
            status: "confirmed",
            source: opts.source,
            tokenHash: hashToken(token),
            serviceName: service.name,
            priceCents: service.priceCents,
            currency: rules.currency,
            durationMin: service.durationMin,
            chatSessionId: opts.chatSessionId ?? null,
          })
          .returning();
        return { ...inserted!, barberName: barber.name };
      });
      return { booking: toView(row), token };
    } catch (err) {
      return withAlternatives(err, data.barberId, durationMin || 30, start);
    }
  }

  // -------------------------------------------------------------------------
  // Четене и отмяна от клиента (по таен токен)
  // -------------------------------------------------------------------------

  async function findById(ex: Executor, id: string): Promise<BookingView | null> {
    const [row] = await ex
      .select({ booking: bookings, barberName: barbers.name })
      .from(bookings)
      .innerJoin(barbers, eq(barbers.id, bookings.barberId))
      .where(eq(bookings.id, id));
    return row ? toView({ ...row.booking, barberName: row.barberName }) : null;
  }

  async function getBookingByToken(token: string): Promise<BookingView | null> {
    if (!TOKEN_RE.test(token)) return null;
    const [row] = await db
      .select({ booking: bookings, barberName: barbers.name })
      .from(bookings)
      .innerJoin(barbers, eq(barbers.id, bookings.barberId))
      .where(eq(bookings.tokenHash, hashToken(token)));
    return row ? toView({ ...row.booking, barberName: row.barberName }) : null;
  }

  /** Може ли клиентът сам да отмени (статус и минимално време преди часа). */
  function canCustomerCancel(b: Pick<BookingView, "status" | "start">): boolean {
    return (
      b.status === "confirmed" &&
      b.start.getTime() - now().getTime() >= rules.cancelCutoffHours * 3_600_000
    );
  }

  /** Часът още не е започнал (за показване на опцията за отмяна). */
  function isUpcoming(b: Pick<BookingView, "start">): boolean {
    return b.start.getTime() > now().getTime();
  }

  async function cancelByToken(token: string): Promise<BookingView> {
    const b = await getBookingByToken(token);
    if (!b) throw new BookingError("booking_not_found", "Резервацията не е намерена.");
    if (b.status === "cancelled")
      throw new BookingError("already_cancelled", "Резервацията вече е отменена.");
    if (b.status !== "confirmed")
      throw new BookingError("not_cancellable", "Тази резервация не може да бъде отменена.");
    if (!canCustomerCancel(b)) {
      throw new BookingError(
        "cancel_too_late",
        `Онлайн отмяна е възможна до ${rules.cancelCutoffHours} ч. преди часа. Моля, обадете се в бръснарницата.`,
      );
    }
    return cancelInternal(b.id);
  }

  async function cancelInternal(id: string): Promise<BookingView> {
    const updated = await db
      .update(bookings)
      .set({ status: "cancelled", cancelledAt: now() })
      .where(and(eq(bookings.id, id), eq(bookings.status, "confirmed")))
      .returning({ id: bookings.id });
    if (updated.length === 0) {
      throw new BookingError("already_cancelled", "Резервацията вече е отменена или приключена.");
    }
    return (await findById(db, id))!;
  }

  // -------------------------------------------------------------------------
  // Администраторски операции
  // -------------------------------------------------------------------------

  async function getBookingById(id: string): Promise<BookingView | null> {
    if (!uuidSchema.safeParse(id).success) return null;
    return findById(db, id);
  }

  /** Отмяна от администратора — без ограничение във времето. */
  async function cancelById(id: string): Promise<BookingView> {
    const b = await getBookingById(id);
    if (!b) throw new BookingError("booking_not_found", "Резервацията не е намерена.");
    return cancelInternal(id);
  }

  async function setStatus(id: string, status: BookingStatus): Promise<BookingView> {
    const b = await getBookingById(id);
    if (!b) throw new BookingError("booking_not_found", "Резервацията не е намерена.");
    try {
      await db
        .update(bookings)
        .set({ status, cancelledAt: status === "cancelled" ? now() : null })
        .where(eq(bookings.id, id));
    } catch (err) {
      // Напр. връщане на отменена резервация в „потвърдена“, когато часът вече е зает.
      return withAlternatives(err, b.barberId, b.durationMin, b.start, id);
    }
    return (await findById(db, id))!;
  }

  /** Преместване на час (и по избор на друг бръснар, който извършва услугата). */
  async function reschedule(
    id: string,
    input: { start: unknown; barberId?: unknown },
  ): Promise<BookingView> {
    const start = new Date(parseOrThrow(isoDateTimeSchema, input.start));
    const existing = await getBookingById(id);
    if (!existing) throw new BookingError("booking_not_found", "Резервацията не е намерена.");
    if (existing.status !== "confirmed") {
      throw new BookingError(
        "not_cancellable",
        "Само потвърдени резервации могат да се преместват.",
      );
    }
    const barberId =
      input.barberId === undefined ? existing.barberId : parseOrThrow(uuidSchema, input.barberId);

    try {
      await db.transaction(async (tx) => {
        const [locked] = await tx.select().from(bookings).where(eq(bookings.id, id)).for("update");
        if (!locked || locked.status !== "confirmed") {
          throw new BookingError(
            "not_cancellable",
            "Само потвърдени резервации могат да се преместват.",
          );
        }
        const [barber] = await tx
          .select()
          .from(barbers)
          .where(eq(barbers.id, barberId))
          .for("update");
        if (!barber) throw new BookingError("barber_not_found", "Няма такъв бръснар.");
        if (!barber.active) throw new BookingError("barber_inactive", "Бръснарят не е активен.");
        if (barberId !== locked.barberId) {
          const [link] = await tx
            .select({ n: count() })
            .from(barberServices)
            .where(
              and(
                eq(barberServices.barberId, barberId),
                eq(barberServices.serviceId, locked.serviceId),
              ),
            );
          if (!link || link.n === 0) {
            throw new BookingError(
              "barber_service_mismatch",
              `${barber.name} не извършва „${locked.serviceName}“.`,
            );
          }
        }
        await assertSlot(tx, {
          barberId,
          durationMin: locked.durationMin,
          start,
          enforce: false,
          excludeBookingId: id,
        });
        await tx
          .update(bookings)
          .set({
            barberId,
            startAt: start,
            endAt: new Date(start.getTime() + locked.durationMin * 60_000),
          })
          .where(eq(bookings.id, id));
      });
    } catch (err) {
      return withAlternatives(err, barberId, existing.durationMin, start, id);
    }
    return (await findById(db, id))!;
  }

  return {
    rules,
    listActiveServices,
    listActiveBarbers,
    getAvailableDates,
    getShopHours,
    getAvailableSlots,
    getAdminSlots,
    findAlternatives,
    createBooking,
    getBookingByToken,
    canCustomerCancel,
    isUpcoming,
    cancelByToken,
    getBookingById,
    cancelById,
    setStatus,
    reschedule,
  };
}

export type BookingService = ReturnType<typeof createBookingService>;

function toView(row: Booking & { barberName: string }): BookingView {
  return {
    id: row.id,
    start: row.startAt,
    end: row.endAt,
    status: row.status,
    source: row.source,
    customerName: row.customerName,
    customerPhone: row.customerPhone,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    priceCents: row.priceCents,
    currency: row.currency,
    durationMin: row.durationMin,
    barberId: row.barberId,
    barberName: row.barberName,
    createdAt: row.createdAt,
  };
}
