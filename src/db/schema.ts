import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/*
 * Всички моменти във времето са `timestamptz` (съхраняват се в UTC).
 * „Стенно“ време на бизнеса (работно време, изключения) е `time`/`date` без зона
 * и се интерпретира в BUSINESS_TIMEZONE (по подразбиране Europe/Sofia).
 *
 * Защитата от застъпване на резервации (exclusion constraint с tstzrange +
 * btree_gist) НЕ може да се изрази в Drizzle схемата и е в custom миграция:
 * drizzle/0001_booking_overlap_guard.sql
 */

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => tsz("created_at").notNull().defaultNow();
const updatedAt = () =>
  tsz("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const bookingStatus = pgEnum("booking_status", [
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
]);
export const bookingSource = pgEnum("booking_source", ["web", "chat", "admin"]);
export const scheduleExceptionType = pgEnum("schedule_exception_type", ["off", "custom"]);

/** Статуси, които заемат време в графика (всички без „отменена“). */
export const ACTIVE_BOOKING_STATUSES = ["confirmed", "completed", "no_show"] as const;

// ---------------------------------------------------------------------------
// Каталог
// ---------------------------------------------------------------------------

export const barbers = pgTable(
  "barbers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    bio: text("bio").notNull().default(""),
    /** Относителен път във volume-а за качени файлове (напр. "barbers/<uuid>.webp"). */
    photoPath: text("photo_path"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("barbers_slug_uq").on(t.slug)],
);

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    durationMin: integer("duration_min").notNull(),
    /** Цена в стотинки/центове, за да няма грешки от закръгляне. */
    priceCents: integer("price_cents").notNull(),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("services_duration_chk", sql`${t.durationMin} > 0 AND ${t.durationMin} <= 480`),
    check("services_price_chk", sql`${t.priceCents} >= 0`),
  ],
);

export const barberServices = pgTable(
  "barber_services",
  {
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.barberId, t.serviceId] }),
    index("barber_services_service_idx").on(t.serviceId),
  ],
);

// ---------------------------------------------------------------------------
// График
// ---------------------------------------------------------------------------

export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    /** ISO ден от седмицата: 1 = понеделник … 7 = неделя. */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    breakStart: time("break_start"),
    breakEnd: time("break_end"),
  },
  (t) => [
    uniqueIndex("working_hours_barber_weekday_uq").on(t.barberId, t.weekday),
    check("working_hours_weekday_chk", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("working_hours_range_chk", sql`${t.endTime} > ${t.startTime}`),
    check(
      "working_hours_break_chk",
      sql`(${t.breakStart} IS NULL AND ${t.breakEnd} IS NULL) OR (${t.breakStart} IS NOT NULL AND ${t.breakEnd} IS NOT NULL AND ${t.breakStart} >= ${t.startTime} AND ${t.breakEnd} <= ${t.endTime} AND ${t.breakEnd} > ${t.breakStart})`,
    ),
  ],
);

/**
 * Изключение за конкретна дата: `off` = не работи (отпуск, празник);
 * `custom` = различно работно време за деня (напр. скъсен ден).
 */
export const scheduleExceptions = pgTable(
  "schedule_exceptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    type: scheduleExceptionType("type").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    breakStart: time("break_start"),
    breakEnd: time("break_end"),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("schedule_exceptions_barber_date_uq").on(t.barberId, t.date),
    check(
      "schedule_exceptions_custom_chk",
      sql`${t.type} = 'off' OR (${t.startTime} IS NOT NULL AND ${t.endTime} IS NOT NULL AND ${t.endTime} > ${t.startTime})`,
    ),
    check(
      "schedule_exceptions_break_chk",
      sql`(${t.breakStart} IS NULL AND ${t.breakEnd} IS NULL) OR (${t.breakStart} IS NOT NULL AND ${t.breakEnd} IS NOT NULL AND ${t.breakEnd} > ${t.breakStart})`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Резервации
// ---------------------------------------------------------------------------

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    barberId: uuid("barber_id")
      .notNull()
      .references(() => barbers.id, { onDelete: "restrict" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "restrict" }),
    startAt: tsz("start_at").notNull(),
    endAt: tsz("end_at").notNull(),
    customerName: text("customer_name").notNull(),
    /** Телефон в E.164 формат (напр. +359888123456). */
    customerPhone: text("customer_phone").notNull(),
    status: bookingStatus("status").notNull().default("confirmed"),
    source: bookingSource("source").notNull(),
    /** SHA-256 (hex) на тайния токен от линка /booking/<token>; самият токен не се пази. */
    tokenHash: text("token_hash").notNull(),
    // Snapshot към момента на записване.
    serviceName: text("service_name").notNull(),
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull(),
    durationMin: integer("duration_min").notNull(),
    /** n8n sessionId за резервации от чата (за изчистване на чат историята при анонимизиране). */
    chatSessionId: text("chat_session_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    cancelledAt: tsz("cancelled_at"),
    anonymizedAt: tsz("anonymized_at"),
  },
  (t) => [
    uniqueIndex("bookings_token_hash_uq").on(t.tokenHash),
    index("bookings_barber_start_idx").on(t.barberId, t.startAt),
    index("bookings_start_idx").on(t.startAt),
    index("bookings_phone_idx").on(t.customerPhone),
    index("bookings_status_idx").on(t.status),
    check("bookings_time_range_chk", sql`${t.endAt} > ${t.startAt}`),
    check("bookings_price_chk", sql`${t.priceCents} >= 0`),
  ],
);

/** Ключове за идемпотентност (Agent API). Изтичат след кратък TTL. */
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    key: text("key").notNull(),
    /** SHA-256 на нормализираното тяло; същият ключ с друго тяло е грешка. */
    requestHash: text("request_hash").notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: createdAt(),
    expiresAt: tsz("expires_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scope, t.key] }),
    index("idempotency_keys_expires_idx").on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------------------
// Защита от злоупотреба
// ---------------------------------------------------------------------------

/**
 * Броячи за rate limit с фиксиран прозорец. `key` съдържа обхвата, идентификатора
 * (хеширан IP/телефон, без лични данни в явен вид) и началото на прозореца.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(0),
    expiresAt: tsz("expires_at").notNull(),
  },
  (t) => [index("rate_limits_expires_idx").on(t.expiresAt)],
);

// ---------------------------------------------------------------------------
// Администрация
// ---------------------------------------------------------------------------

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("admin_users_email_uq").on(sql`lower(${t.email})`)],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    /** SHA-256 (hex) на токена от cookie-то. */
    id: text("id").primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    expiresAt: tsz("expires_at").notNull(),
  },
  (t) => [
    index("admin_sessions_user_idx").on(t.adminUserId),
    index("admin_sessions_expires_idx").on(t.expiresAt),
  ],
);

export type Barber = typeof barbers.$inferSelect;
export type Service = typeof services.$inferSelect;
export type WorkingHours = typeof workingHours.$inferSelect;
export type ScheduleException = typeof scheduleExceptions.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
