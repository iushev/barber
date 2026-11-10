import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import {
  anonymizeBookings,
  ANONYMIZED_NAME,
  deleteBooking,
  listBookings,
  parseBookingFilters,
} from "../../src/server/admin/bookings";
import * as catalog from "../../src/server/admin/catalog";
import { AdminError } from "../../src/server/admin/errors";
import {
  changePassword,
  createSession,
  deleteSession,
  login,
  SESSION_TTL_MS,
  validateSession,
} from "../../src/server/auth/core";
import { hashPassword } from "../../src/server/auth/password";
import { createBookingService, type BookingService } from "../../src/server/booking/service";
import {
  at,
  clearBookings,
  NOW,
  setupFixture,
  testRules,
  TOMORROW,
  type Fixture,
} from "../support/fixtures";

let fx: Fixture;
let svc: BookingService;

beforeAll(async () => {
  fx = await setupFixture();
  svc = createBookingService({ db: fx.db, rules: testRules, now: () => NOW });
  await fx.db.insert(schema.adminUsers).values({
    email: "Admin@Example.com",
    passwordHash: await hashPassword("correct horse battery"),
  });
});

afterAll(async () => {
  await fx?.pool.end();
});

beforeEach(async () => {
  await clearBookings(fx.db);
  await fx.db.delete(schema.adminSessions);
});

const expectAdminError = async (p: Promise<unknown>, field?: string) => {
  const err = await p.then(
    () => new Error("очаквах AdminError"),
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(AdminError);
  if (field) expect((err as AdminError).fields[field]).toBeDefined();
  return err as AdminError;
};

describe("вход и сесии", () => {
  it("успешен вход (имейлът е без значение за главни букви) и валидна сесия", async () => {
    const r = await login(fx.db, {
      email: " admin@EXAMPLE.com ",
      password: "correct horse battery",
      ip: "1.1.1.1",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await validateSession(fx.db, r.token))?.email).toBe("Admin@Example.com");
    // В БД е само хешът.
    const [s] = await fx.db.select().from(schema.adminSessions);
    expect(s!.id).not.toBe(r.token);
  });

  it("грешна парола и несъществуващ потребител дават една и съща грешка", async () => {
    const a = await login(fx.db, { email: "admin@example.com", password: "wrong", ip: "1.1.1.2" });
    const b = await login(fx.db, { email: "nobody@example.com", password: "wrong", ip: "1.1.1.2" });
    expect(a).toEqual({ ok: false, reason: "invalid" });
    expect(b).toEqual({ ok: false, reason: "invalid" });
  });

  it("brute force: rate limit по имейл (дори от различни IP)", async () => {
    await fx.db.delete(schema.rateLimits);
    for (let i = 0; i < 5; i++) {
      await login(fx.db, { email: "admin@example.com", password: "x", ip: `9.9.9.${i}` });
    }
    const r = await login(fx.db, {
      email: "admin@example.com",
      password: "correct horse battery",
      ip: "9.9.9.99",
    });
    expect(r).toMatchObject({ ok: false, reason: "rate_limited" });
    await fx.db.delete(schema.rateLimits);
  });

  it("изтекла, изтрита и невалидна сесия не са валидни", async () => {
    const [admin] = await fx.db.select().from(schema.adminUsers);
    const s = await createSession(fx.db, admin!.id, NOW);
    expect(await validateSession(fx.db, s.token, NOW)).not.toBeNull();
    expect(
      await validateSession(fx.db, s.token, new Date(NOW.getTime() + SESSION_TTL_MS + 1)),
    ).toBeNull();
    await deleteSession(fx.db, s.token);
    expect(await validateSession(fx.db, s.token, NOW)).toBeNull();
    expect(await validateSession(fx.db, "garbage", NOW)).toBeNull();
    expect(await validateSession(fx.db, undefined, NOW)).toBeNull();
  });

  it("смяната на паролата прекратява всички сесии", async () => {
    const [admin] = await fx.db.select().from(schema.adminUsers);
    const s = await createSession(fx.db, admin!.id);
    await changePassword(fx.db, admin!.id, "new password 12345");
    expect(await validateSession(fx.db, s.token)).toBeNull();
    const r = await login(fx.db, {
      email: "admin@example.com",
      password: "new password 12345",
      ip: "2.2.2.2",
    });
    expect(r.ok).toBe(true);
    await changePassword(fx.db, admin!.id, "correct horse battery");
  });
});

describe("каталог", () => {
  it("създаване и редакция на бръснар с услуги; уникален slug", async () => {
    const id = await catalog.createBarber(fx.db, {
      name: "Нов Бръснар",
      slug: "nov",
      bio: "Био",
      sortOrder: "5",
      serviceIds: [fx.haircut.id],
    });
    expect((await catalog.getBarber(fx.db, id))!.serviceIds).toEqual([fx.haircut.id]);

    await catalog.updateBarber(fx.db, id, {
      name: "Нов Бръснар",
      slug: "nov",
      bio: "",
      sortOrder: "5",
      serviceIds: [fx.haircut.id, fx.beard.id],
    });
    expect((await catalog.getBarber(fx.db, id))!.serviceIds.sort()).toEqual(
      [fx.haircut.id, fx.beard.id].sort(),
    );

    await expectAdminError(
      catalog.createBarber(fx.db, { name: "Дубликат", slug: "nov", serviceIds: [] }),
      "slug",
    );
    await expectAdminError(
      catalog.createBarber(fx.db, { name: "X", slug: "Невалиден Slug" }),
      "name",
    );
  });

  it("услуга: цена със запетая, валидация на продължителност", async () => {
    const id = await catalog.createService(fx.db, {
      name: "Тест",
      durationMin: "35",
      price: "25,50",
    });
    expect((await catalog.getService(fx.db, id))!.priceCents).toBe(2550);
    await expectAdminError(
      catalog.createService(fx.db, { name: "Тест", durationMin: "33", price: "10" }),
      "durationMin",
    );
    await expectAdminError(
      catalog.createService(fx.db, { name: "Тест", durationMin: "30", price: "-1" }),
      "price",
    );
  });

  it("седмичен график: запис, прочитане и валидация на почивката", async () => {
    const days = Array.from({ length: 7 }, (_, i) =>
      i < 5
        ? { enabled: true, start: "10:00", end: "18:00", breakStart: "13:00", breakEnd: "13:30" }
        : { enabled: false, start: "", end: "", breakStart: "", breakEnd: "" },
    );
    await catalog.saveWeeklySchedule(fx.db, fx.barberB.id, days);
    const saved = await catalog.getWeeklySchedule(fx.db, fx.barberB.id);
    expect(saved[0]).toEqual({
      enabled: true,
      start: "10:00",
      end: "18:00",
      breakStart: "13:00",
      breakEnd: "13:30",
    });
    expect(saved[6]).toEqual({ enabled: false });

    const bad = days.map((d, i) =>
      i === 0 ? { ...d, breakStart: "09:00", breakEnd: "09:30" } : d,
    );
    await expectAdminError(catalog.saveWeeklySchedule(fx.db, fx.barberB.id, bad));
    const noEnd = days.map((d, i) => (i === 0 ? { ...d, end: "" } : d));
    await expectAdminError(catalog.saveWeeklySchedule(fx.db, fx.barberB.id, noEnd));
    // Неуспешното записване не е изтрило графика (транзакция).
    expect((await catalog.getWeeklySchedule(fx.db, fx.barberB.id))[0]).toMatchObject({
      enabled: true,
    });

    // Връщане на графика от фикстурата (всеки ден 09–18, почивка 13–14).
    await catalog.saveWeeklySchedule(
      fx.db,
      fx.barberB.id,
      Array.from({ length: 7 }, () => ({
        enabled: true,
        start: "09:00",
        end: "18:00",
        breakStart: "13:00",
        breakEnd: "14:00",
      })),
    );
  });

  it("изключение за дата: скъсен ден, после почивен ден (замяна) и влияние върху слотовете", async () => {
    await catalog.upsertException(fx.db, fx.barberA.id, {
      type: "custom",
      date: TOMORROW,
      start: "09:00",
      end: "11:00",
      note: "Скъсен",
    });
    let slots = await svc.getAvailableSlots({
      serviceId: fx.haircut.id,
      barberId: fx.barberA.id,
      date: TOMORROW,
    });
    expect(slots.slots.map((s) => s.label)).toEqual(["09:00", "09:30", "10:00", "10:30"]);

    await catalog.upsertException(fx.db, fx.barberA.id, { type: "off", date: TOMORROW });
    slots = await svc.getAvailableSlots({
      serviceId: fx.haircut.id,
      barberId: fx.barberA.id,
      date: TOMORROW,
    });
    expect(slots.slots).toEqual([]);
    const list = await catalog.listExceptions(fx.db, fx.barberA.id, "2030-01-01");
    expect(list).toHaveLength(1);
    await catalog.deleteException(fx.db, list[0]!.id);

    await expectAdminError(
      catalog.upsertException(fx.db, fx.barberA.id, { type: "custom", date: TOMORROW }),
    );
  });

  it("деактивиране на бръснар с бъдещи резервации изисква потвърждение", async () => {
    await svc.createBooking(
      {
        serviceId: fx.haircut.id,
        barberId: fx.barberB.id,
        start: at(TOMORROW, "10:00"),
        customerName: "Клиент",
        customerPhone: "0888111222",
      },
      { source: "web" },
    );
    const affected = await catalog.futureBookingsFor(fx.db, { barberId: fx.barberB.id }, NOW);
    expect(affected).toHaveLength(1);

    expect(await catalog.setBarberActive(fx.db, fx.barberB.id, false, false)).toEqual({
      ok: false,
      needsConfirm: true,
      affected: 1,
    });
    expect((await catalog.getBarber(fx.db, fx.barberB.id))!.active).toBe(true);

    expect(await catalog.setBarberActive(fx.db, fx.barberB.id, false, true)).toEqual({ ok: true });
    // Неактивен бръснар не приема нови записвания, но резервацията остава.
    await expect(
      svc.createBooking(
        {
          serviceId: fx.haircut.id,
          barberId: fx.barberB.id,
          start: at(TOMORROW, "11:00"),
          customerName: "Друг",
          customerPhone: "0888111333",
        },
        { source: "web" },
      ),
    ).rejects.toMatchObject({ code: "barber_inactive" });
    expect(await catalog.futureBookingsFor(fx.db, { barberId: fx.barberB.id }, NOW)).toHaveLength(
      1,
    );
    await catalog.setBarberActive(fx.db, fx.barberB.id, true, false);
  });

  it("деактивиране на услуга с бъдещи резервации изисква потвърждение", async () => {
    await svc.createBooking(
      {
        serviceId: fx.haircut.id,
        barberId: fx.barberA.id,
        start: at(TOMORROW, "10:00"),
        customerName: "Клиент",
        customerPhone: "0888111222",
      },
      { source: "web" },
    );
    expect(await catalog.setServiceActive(fx.db, fx.haircut.id, false, false)).toMatchObject({
      needsConfirm: true,
    });
    expect(await catalog.setServiceActive(fx.db, fx.haircut.id, false, true)).toEqual({ ok: true });
    await catalog.setServiceActive(fx.db, fx.haircut.id, true, false);
  });
});

describe("резервации: филтри и лични данни", () => {
  beforeEach(async () => {
    await svc.createBooking(
      {
        serviceId: fx.haircut.id,
        barberId: fx.barberA.id,
        start: at(TOMORROW, "10:00"),
        customerName: "Иван Петров",
        customerPhone: "0888 123 456",
      },
      { source: "chat", chatSessionId: "sess_aaaaaaaa" },
    );
    await svc.createBooking(
      {
        serviceId: fx.haircut.id,
        barberId: fx.barberA.id,
        start: at(TOMORROW, "11:00"),
        customerName: "Иван Петров",
        customerPhone: "0888 123 456",
      },
      { source: "web" },
    );
    const { booking } = await svc.createBooking(
      {
        serviceId: fx.haircut.id,
        barberId: fx.barberB.id,
        start: at("2030-01-09", "10:00"),
        customerName: "Мария",
        customerPhone: "+44 7911 123456",
      },
      { source: "admin" },
    );
    await svc.cancelById(booking.id);
  });

  it("филтри: дата, бръснар, статус, име, телефон (пълен и частичен)", async () => {
    const run = async (q: Record<string, string>) =>
      (await listBookings(fx.db, parseBookingFilters(q), "Europe/Sofia")).total;
    expect(await run({})).toBe(3);
    expect(await run({ from: TOMORROW, to: TOMORROW })).toBe(2);
    expect(await run({ barberId: fx.barberB.id })).toBe(1);
    expect(await run({ status: "cancelled" })).toBe(1);
    expect(await run({ q: "иван" })).toBe(2);
    expect(await run({ q: "0888123456" })).toBe(2);
    expect(await run({ q: "123456" })).toBe(3); // частично съвпадение по цифри
    expect(await run({ q: "100%_" })).toBe(0); // LIKE специалните символи се екранират
    expect(await run({ status: "nonsense", from: "not-a-date" })).toBe(3); // невалидните филтри се игнорират
  });

  it("анонимизиране по телефон: име, телефон, idempotency кеш и chat сесии", async () => {
    await fx.db.insert(schema.idempotencyKeys).values({
      scope: "agent:bookings",
      key: "k-12345678",
      requestHash: "h",
      bookingId: (
        await fx.db
          .select()
          .from(schema.bookings)
          .where(eq(schema.bookings.chatSessionId, "sess_aaaaaaaa"))
      )[0]!.id,
      responseStatus: 201,
      responseBody: { booking: { customerPhone: "+359888123456" } },
      expiresAt: new Date(NOW.getTime() + 3_600_000),
    });

    const res = await anonymizeBookings(fx.db, { phone: "+359888123456" }, NOW);
    expect(res).toEqual({ count: 2, chatSessionIds: ["sess_aaaaaaaa"] });
    const rows = await fx.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.customerName, ANONYMIZED_NAME));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.customerPhone === "" && r.anonymizedAt)).toBe(true);
    expect(await fx.db.select().from(schema.idempotencyKeys)).toHaveLength(0);
    // Анонимизираните резервации все още заемат времето (статистика/график).
    expect(
      (await listBookings(fx.db, parseBookingFilters({ status: "confirmed" }), "Europe/Sofia"))
        .total,
    ).toBe(2);
  });

  it("автоматично анонимизиране след срока за съхранение (само приключили и неанонимизирани)", async () => {
    // Всички три резервации свършват на 08–09.01.2030 → граница 09.01 10:00 UTC хваща двете от 08.01.
    const res = await anonymizeBookings(fx.db, { endedBefore: new Date("2030-01-09T00:00:00Z") });
    expect(res.count).toBe(2);
    expect(
      (await anonymizeBookings(fx.db, { endedBefore: new Date("2030-01-09T00:00:00Z") })).count,
    ).toBe(0);
    const res2 = await anonymizeBookings(fx.db, { endedBefore: new Date("2031-01-01T00:00:00Z") });
    expect(res2.count).toBe(1);
  });

  it("окончателно изтриване", async () => {
    const [b] = await fx.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.chatSessionId, "sess_aaaaaaaa"));
    expect(await deleteBooking(fx.db, b!.id)).toEqual({
      deleted: true,
      chatSessionIds: ["sess_aaaaaaaa"],
    });
    expect(await deleteBooking(fx.db, b!.id)).toEqual({ deleted: false, chatSessionIds: [] });
  });
});
