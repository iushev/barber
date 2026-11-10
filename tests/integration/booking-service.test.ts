import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { BookingError } from "../../src/server/booking/errors";
import {
  createBookingService,
  hashToken,
  type BookingService,
} from "../../src/server/booking/service";
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
});

afterAll(async () => {
  await fx?.pool.end();
});

beforeEach(async () => {
  await clearBookings(fx.db);
});

const input = (over: Partial<Record<string, unknown>> = {}) => ({
  serviceId: fx.haircut.id,
  barberId: fx.barberA.id,
  start: at(TOMORROW, "10:00"),
  customerName: "Иван Иванов",
  customerPhone: "0888 123 456",
  ...over,
});

async function expectBookingError(p: Promise<unknown>, code: string): Promise<BookingError> {
  const err = await p.then(
    () => {
      throw new Error(`очаквах грешка ${code}, а заявката успя`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BookingError);
  expect((err as BookingError).code).toBe(code);
  return err as BookingError;
}

describe("каталог и слотове", () => {
  it("активните услуги с бръснарите, които ги извършват", async () => {
    const list = await svc.listActiveServices();
    expect(list.map((s) => s.name)).toEqual(["Подстригване", "Брада"]);
    const haircut = list.find((s) => s.id === fx.haircut.id)!;
    expect(haircut.barbers.map((b) => b.name).sort()).toEqual(["Бръснар А", "Бръснар Б"]);
    expect(list.find((s) => s.id === fx.beard.id)!.barbers.map((b) => b.id)).toEqual([
      fx.barberB.id,
    ]);
  });

  it("свободни часове за деня с ISO offset и етикет", async () => {
    const r = await svc.getAvailableSlots({
      serviceId: fx.haircut.id,
      barberId: fx.barberA.id,
      date: TOMORROW,
    });
    expect(r.timezone).toBe("Europe/Sofia");
    expect(r.slots).toHaveLength(8 + 8); // 09:00–13:00 и 14:00–18:00 през 30 мин
    expect(r.slots[0]).toEqual({
      start: "2030-01-08T09:00:00+02:00",
      end: "2030-01-08T09:30:00+02:00",
      label: "09:00",
    });
    expect(r.slots.map((s) => s.label)).not.toContain("13:00");
  });

  it("отхвърля невалидни заявки със 422 кодове", async () => {
    const q = { serviceId: fx.beard.id, barberId: fx.barberA.id, date: TOMORROW };
    expect(
      (await expectBookingError(svc.getAvailableSlots(q), "barber_service_mismatch")).httpStatus,
    ).toBe(422);
    await expectBookingError(
      svc.getAvailableSlots({ ...q, serviceId: fx.haircut.id, date: "2030-01-06" }),
      "date_in_past",
    );
    await expectBookingError(
      svc.getAvailableSlots({ ...q, serviceId: fx.haircut.id, date: "2030-03-30" }),
      "date_beyond_horizon",
    );
    await expectBookingError(
      svc.getAvailableSlots({ ...q, serviceId: "not-a-uuid" }),
      "validation_error",
    );
    await expectBookingError(
      svc.getAvailableSlots({ ...q, serviceId: fx.inactiveService.id }),
      "service_inactive",
    );
    await expectBookingError(
      svc.getAvailableSlots({ ...q, serviceId: fx.haircut.id, barberId: fx.inactiveBarber.id }),
      "barber_inactive",
    );
  });

  it("изключение за дата (почивен ден) → празен списък", async () => {
    await fx.db
      .insert(schema.scheduleExceptions)
      .values({ barberId: fx.barberA.id, date: TOMORROW, type: "off" });
    const r = await svc.getAvailableSlots({
      serviceId: fx.haircut.id,
      barberId: fx.barberA.id,
      date: TOMORROW,
    });
    expect(r.slots).toEqual([]);
  });
});

describe("createBooking", () => {
  it("създава резервация със snapshot на цената и таен токен", async () => {
    const { booking, token } = await svc.createBooking(input(), {
      source: "web",
      clientKey: "1.2.3.4",
    });
    expect(booking.status).toBe("confirmed");
    expect(booking.customerPhone).toBe("+359888123456");
    expect(booking.priceCents).toBe(2000);
    expect(booking.serviceName).toBe("Подстригване");
    expect(booking.end.getTime() - booking.start.getTime()).toBe(30 * 60_000);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [row] = await fx.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, booking.id));
    expect(row!.tokenHash).toBe(hashToken(token));
    expect(row!.tokenHash).not.toContain(token);

    expect((await svc.getBookingByToken(token))?.id).toBe(booking.id);
    expect(await svc.getBookingByToken("x".repeat(43))).toBeNull();

    // Snapshot: промяната на цената не засяга съществуващата резервация.
    await fx.db
      .update(schema.services)
      .set({ priceCents: 9999 })
      .where(eq(schema.services.id, fx.haircut.id));
    expect((await svc.getBookingByToken(token))!.priceCents).toBe(2000);
    await fx.db
      .update(schema.services)
      .set({ priceCents: 2000 })
      .where(eq(schema.services.id, fx.haircut.id));

    const slots = await svc.getAvailableSlots({
      serviceId: fx.haircut.id,
      barberId: fx.barberA.id,
      date: TOMORROW,
    });
    expect(slots.slots.map((s) => s.label)).not.toContain("10:00");
  });

  it("часът трябва да е точно един от слотовете", async () => {
    await expectBookingError(
      svc.createBooking(input({ start: at(TOMORROW, "10:10") }), { source: "web" }),
      "invalid_slot",
    );
    await expectBookingError(
      svc.createBooking(input({ start: at(TOMORROW, "13:00") }), { source: "web" }),
      "invalid_slot",
    );
    await expectBookingError(
      svc.createBooking(input({ start: at(TOMORROW, "17:45") }), { source: "web" }),
      "invalid_slot",
    );
    await expectBookingError(
      svc.createBooking(input({ start: at("2030-01-07", "08:30") }), { source: "web" }),
      "invalid_slot",
    );
    await expectBookingError(
      svc.createBooking(input({ customerPhone: "123" }), { source: "chat" }),
      "validation_error",
    );
    await expectBookingError(
      svc.createBooking(input({ barberId: fx.barberA.id, serviceId: fx.beard.id }), {
        source: "chat",
      }),
      "barber_service_mismatch",
    );
  });

  it("едновременни заявки (форма + агент) за един слот: точно една успява", async () => {
    const attempts = Array.from({ length: 10 }, (_, i) =>
      svc.createBooking(input({ customerPhone: `+35988810${String(i).padStart(4, "0")}` }), {
        source: i % 2 === 0 ? "web" : "chat",
        clientKey: `client-${i}`,
      }),
    );
    const results = await Promise.allSettled(attempts);
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    for (const f of failed) {
      expect(f.reason).toBeInstanceOf(BookingError);
      const e = f.reason as BookingError;
      expect(e.code).toBe("slot_taken");
      expect(e.httpStatus).toBe(409);
      expect(e.details.alternatives).toHaveLength(3);
      expect(e.details.alternatives!.map((a) => a.label)).toEqual(["09:00", "09:30", "10:30"]);
    }
    const rows = await fx.db
      .select()
      .from(schema.bookings)
      .where(
        and(eq(schema.bookings.barberId, fx.barberA.id), eq(schema.bookings.status, "confirmed")),
      );
    expect(rows).toHaveLength(1);
  });

  it("застъпване с по-дълга услуга се хваща (не само еднакъв начален час)", async () => {
    await svc.createBooking(
      input({ barberId: fx.barberB.id, serviceId: fx.beard.id, start: at(TOMORROW, "10:00") }),
      { source: "web" },
    );
    // 10:30–11:00 застъпва 10:00–10:45
    const e = await expectBookingError(
      svc.createBooking(
        input({
          barberId: fx.barberB.id,
          start: at(TOMORROW, "10:30"),
          customerPhone: "0888000001",
        }),
        { source: "chat" },
      ),
      "slot_taken",
    );
    expect(e.details.alternatives!.map((a) => a.label)).not.toContain("10:30");
  });

  it("лимит на активни бъдещи резервации на телефон (без админ)", async () => {
    for (const t of ["09:00", "09:30", "10:00"]) {
      await svc.createBooking(input({ start: at(TOMORROW, t) }), { source: "web" });
    }
    await expectBookingError(
      svc.createBooking(input({ start: at(TOMORROW, "10:30") }), { source: "chat" }),
      "too_many_active_bookings",
    );
    const admin = await svc.createBooking(input({ start: at(TOMORROW, "10:30") }), {
      source: "admin",
    });
    expect(admin.booking.source).toBe("admin");
  });

  it("rate limit по клиент и по телефон", async () => {
    const strict = createBookingService({
      db: fx.db,
      rules: { ...testRules, rateLimits: { perClientPerHour: 2, perPhonePerDay: 2 } },
      now: () => NOW,
    });
    // Невалидни опити също се броят (защита срещу изброяване).
    await expectBookingError(
      strict.createBooking(input({ start: at(TOMORROW, "10:10") }), {
        source: "web",
        clientKey: "ip-1",
      }),
      "invalid_slot",
    );
    await expectBookingError(
      strict.createBooking(input({ start: at(TOMORROW, "10:10") }), {
        source: "web",
        clientKey: "ip-1",
      }),
      "invalid_slot",
    );
    const byClient = await expectBookingError(
      strict.createBooking(input(), { source: "web", clientKey: "ip-1" }),
      "rate_limited",
    );
    expect(byClient.httpStatus).toBe(429);
    expect(byClient.details.retryAfterSec).toBeGreaterThan(0);
    // Блокираният по клиент опит не стига до брояча за телефон (2). От друг IP: 3-ти опит → лимит.
    await expectBookingError(
      strict.createBooking(input(), { source: "web", clientKey: "ip-2" }),
      "rate_limited",
    );
  });
});

describe("отмяна и администрация", () => {
  it("клиентът отменя по токен; часът се освобождава", async () => {
    const { token } = await svc.createBooking(input(), { source: "web" });
    const cancelled = await svc.cancelByToken(token);
    expect(cancelled.status).toBe("cancelled");
    await expectBookingError(svc.cancelByToken(token), "already_cancelled");
    await expectBookingError(svc.cancelByToken("y".repeat(43)), "booking_not_found");
    const again = await svc.createBooking(input({ customerPhone: "0888000002" }), {
      source: "chat",
    });
    expect(again.booking.status).toBe("confirmed");
  });

  it("онлайн отмяна е забранена по-малко от CANCEL_CUTOFF_HOURS преди часа", async () => {
    // Днес 09:30 местно = 90 мин след NOW (08:00) → под 2 часа.
    const { booking, token } = await svc.createBooking(
      input({ start: at("2030-01-07", "09:30") }),
      { source: "web" },
    );
    expect(svc.canCustomerCancel(booking)).toBe(false);
    await expectBookingError(svc.cancelByToken(token), "cancel_too_late");
    // Администраторът може.
    expect((await svc.cancelById(booking.id)).status).toBe("cancelled");
  });

  it("преместване на час: в зает слот → 409 с алтернативи; в свободен → успех", async () => {
    const a = await svc.createBooking(input({ start: at(TOMORROW, "10:00") }), { source: "web" });
    await svc.createBooking(input({ start: at(TOMORROW, "11:00"), customerPhone: "0888000003" }), {
      source: "web",
    });

    const e = await expectBookingError(
      svc.reschedule(a.booking.id, { start: at(TOMORROW, "11:00") }),
      "slot_taken",
    );
    expect(e.details.alternatives!.length).toBeGreaterThan(0);

    const moved = await svc.reschedule(a.booking.id, { start: at(TOMORROW, "10:30") });
    expect(moved.start.toISOString()).toBe("2030-01-08T08:30:00.000Z");
    // Преместване в часа, който се застъпва само със себе си, е позволено.
    const sameBarberNeighbor = await svc.reschedule(a.booking.id, { start: at(TOMORROW, "10:00") });
    expect(sameBarberNeighbor.start.toISOString()).toBe("2030-01-08T08:00:00.000Z");

    const toB = await svc.reschedule(a.booking.id, {
      start: at(TOMORROW, "11:00"),
      barberId: fx.barberB.id,
    });
    expect(toB.barberName).toBe("Бръснар Б");
  });

  it("връщане на отменена резервация в „потвърдена“, когато часът е зает → slot_taken (exclusion constraint)", async () => {
    const first = await svc.createBooking(input(), { source: "web" });
    await svc.cancelById(first.booking.id);
    await svc.createBooking(input({ customerPhone: "0888000004" }), { source: "chat" });
    await expectBookingError(svc.setStatus(first.booking.id, "confirmed"), "slot_taken");
    expect((await svc.setStatus(first.booking.id, "cancelled")).status).toBe("cancelled");
  });
});
