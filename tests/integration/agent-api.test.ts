import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../src/db/schema";
import { at, clearBookings, NOW, setupFixture, TOMORROW, type Fixture } from "../support/fixtures";

const KEY = "test-agent-key-0123456789abcdef0123456789abcdef";
const BASE = "http://localhost:3000";

// Env за приложния код (чете се мързеливо при първа употреба).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
Object.assign(process.env, {
  AGENT_API_KEY: KEY,
  PUBLIC_BASE_URL: "https://barber.example",
  BUSINESS_TIMEZONE: "Europe/Sofia",
  CURRENCY: "EUR",
  SLOT_STEP_MIN: "30",
  MIN_LEAD_MIN: "60",
  BOOKING_HORIZON_DAYS: "60",
  MAX_ACTIVE_BOOKINGS_PER_PHONE: "3",
  BOOKING_RATE_LIMIT_PER_CLIENT_HOUR: "1000",
  BOOKING_RATE_LIMIT_PER_PHONE_DAY: "1000",
  AGENT_API_RATE_LIMIT_PER_MIN: "10000",
  TRUST_PROXY: "false",
});

type Handler = (req: Request) => Promise<Response>;
let fx: Fixture;
let GET_services: Handler;
let GET_slots: Handler;
let POST_bookings: Handler;
let closeAppPool: () => Promise<void>;
let bookingSvc: (typeof import("../../src/server/booking"))["bookingService"];

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  fx = await setupFixture();
  GET_services = (await import("@/app/api/agent/v1/services/route")).GET;
  GET_slots = (await import("@/app/api/agent/v1/slots/route")).GET;
  POST_bookings = (await import("@/app/api/agent/v1/bookings/route")).POST;
  bookingSvc = (await import("../../src/server/booking")).bookingService;
  const { getPool } = await import("@/db");
  closeAppPool = () => getPool().end();
});

afterAll(async () => {
  vi.useRealTimers();
  await closeAppPool?.();
  await fx?.pool.end();
});

beforeEach(async () => {
  await clearBookings(fx.db);
});

const auth = { Authorization: `Bearer ${KEY}` };

const get = (h: Handler, path: string, headers: Record<string, string> = auth) =>
  h(new Request(`${BASE}${path}`, { headers: { "x-forwarded-for": "10.0.0.5", ...headers } }));

const post = (
  body: unknown,
  idemKey: string | null = crypto.randomUUID(),
  extra: Record<string, string> = {},
) =>
  POST_bookings(
    new Request(`${BASE}/api/agent/v1/bookings`, {
      method: "POST",
      headers: {
        ...auth,
        "content-type": "application/json",
        "x-forwarded-for": "10.0.0.5",
        ...(idemKey ? { "idempotency-key": idemKey } : {}),
        ...extra,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

const bookingBody = (over: Record<string, unknown> = {}) => ({
  serviceId: fx.haircut.id,
  barberId: fx.barberA.id,
  start: at(TOMORROW, "10:00"),
  customerName: "Иван Иванов",
  customerPhone: "0888 123 456",
  ...over,
});

async function bookingCount() {
  const [r] = await fx.db.select({ n: count() }).from(schema.bookings);
  return r!.n;
}

describe("автентикация", () => {
  it.each([
    ["без хедър", {}],
    ["грешен ключ", { Authorization: "Bearer wrong" }],
    ["без Bearer", { Authorization: KEY }],
    ["празен Bearer", { Authorization: "Bearer " }],
  ])("401 %s", async (_name, headers) => {
    const res = await get(GET_services, "/api/agent/v1/services", headers);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "unauthorized", message: expect.any(String) } });
  });

  it("401 и на POST без ключ — нищо не се създава", async () => {
    const res = await POST_bookings(
      new Request(`${BASE}/api/agent/v1/bookings`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "abcdefgh-1" },
        body: JSON.stringify(bookingBody()),
      }),
    );
    expect(res.status).toBe(401);
    expect(await bookingCount()).toBe(0);
  });
});

describe("GET /services и /slots", () => {
  it("услуги с цени, валута и бръснари", async () => {
    const res = await get(GET_services, "/api/agent/v1/services");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.currency).toBe("EUR");
    expect(body.services).toHaveLength(2);
    expect(body.services[0]).toEqual({
      id: fx.haircut.id,
      name: "Подстригване",
      description: "",
      durationMin: 30,
      price: 20,
      barbers: expect.arrayContaining([{ id: fx.barberA.id, name: "Бръснар А" }]),
    });
  });

  it("свободни часове", async () => {
    const res = await get(
      GET_slots,
      `/api/agent/v1/slots?serviceId=${fx.haircut.id}&barberId=${fx.barberA.id}&date=${TOMORROW}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      date: TOMORROW,
      timezone: "Europe/Sofia",
      serviceId: fx.haircut.id,
      barberId: fx.barberA.id,
    });
    expect(body.slots[0]).toEqual({
      start: "2030-01-08T09:00:00+02:00",
      end: "2030-01-08T09:30:00+02:00",
      label: "09:00",
    });
  });

  it.each([
    [
      "невалидна дата",
      (f: Fixture) => `serviceId=${f.haircut.id}&barberId=${f.barberA.id}&date=2030-02-30`,
      "validation_error",
    ],
    [
      "минала дата",
      (f: Fixture) => `serviceId=${f.haircut.id}&barberId=${f.barberA.id}&date=2030-01-01`,
      "date_in_past",
    ],
    [
      "извън хоризонта",
      (f: Fixture) => `serviceId=${f.haircut.id}&barberId=${f.barberA.id}&date=2031-01-01`,
      "date_beyond_horizon",
    ],
    [
      "несъответствие",
      (f: Fixture) => `serviceId=${f.beard.id}&barberId=${f.barberA.id}&date=${TOMORROW}`,
      "barber_service_mismatch",
    ],
    ["липсващи параметри", () => ``, "validation_error"],
  ])("422 при %s", async (_n, qs, code) => {
    const res = await get(GET_slots, `/api/agent/v1/slots?${qs(fx)}`);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe(code);
  });
});

describe("POST /bookings", () => {
  it("201 с пълния формат и manageUrl", async () => {
    const res = await post(bookingBody(), "sess-abc:2030-01-08T10:00", {
      "x-chat-session-id": "session_123456",
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toEqual({
      booking: {
        id: expect.any(String),
        start: "2030-01-08T10:00:00+02:00",
        end: "2030-01-08T10:30:00+02:00",
        service: { name: "Подстригване", price: 20, currency: "EUR" },
        barber: { name: "Бръснар А" },
        customerName: "Иван Иванов",
        customerPhone: "+359888123456",
        status: "confirmed",
        manageUrl: expect.stringMatching(/^https:\/\/barber\.example\/booking\/[A-Za-z0-9_-]{43}$/),
      },
    });
    const [row] = await fx.db
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, body.booking.id));
    expect(row!.source).toBe("chat");
    expect(row!.chatSessionId).toBe("session_123456");
  });

  it("повторна заявка със същия Idempotency-Key връща същата резервация, без дубликат", async () => {
    const key = "sess-xyz:2030-01-08T10:00:00+02:00";
    const first = await post(bookingBody(), key);
    const second = await post(bookingBody(), key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers.get("idempotent-replayed")).toBe("true");
    const [a, b] = [await first.json(), await second.json()];
    expect(b).toEqual(a);
    expect(await bookingCount()).toBe(1);
  });

  it("паралелни заявки със същия ключ → една резервация", async () => {
    const key = "sess-par:2030-01-08T10:00";
    const results = await Promise.all([
      post(bookingBody(), key),
      post(bookingBody(), key),
      post(bookingBody(), key),
    ]);
    const bodies = await Promise.all(results.map((r) => r.json()));
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(bodies.map((b) => b.booking.id)).size).toBe(1);
    expect(await bookingCount()).toBe(1);
  });

  it("същият ключ с друго тяло → 422 idempotency_key_reused", async () => {
    const key = "sess-reuse:1";
    expect((await post(bookingBody(), key)).status).toBe(201);
    const res = await post(bookingBody({ customerName: "Друг Човек" }), key);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("idempotency_key_reused");
    expect(await bookingCount()).toBe(1);
  });

  it("ключ на отменена резервация не се преиграва (клиентът записва наново)", async () => {
    const key = "sess-cancel:2030-01-08T10:00";
    const first = await (await post(bookingBody(), key)).json();
    await bookingSvc().cancelById(first.booking.id);
    const again = await post(bookingBody(), key);
    expect(again.status).toBe(201);
    expect((await again.json()).booking.id).not.toBe(first.booking.id);
  });

  it("след грешка същият ключ може да се ползва отново", async () => {
    const key = "sess-retry:1";
    const bad = await post(bookingBody({ start: at(TOMORROW, "10:10") }), key);
    expect(bad.status).toBe(422);
    // Различно тяло, същият ключ: позволено, защото неуспешният опит не е записан.
    expect((await post(bookingBody(), key)).status).toBe(201);
  });

  it("две паралелни заявки за един и същ слот: точно една успява, другата е 409 с алтернативи", async () => {
    const [r1, r2] = await Promise.all([
      post(bookingBody({ customerPhone: "0888000001" })),
      post(bookingBody({ customerPhone: "0888000002" })),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    const conflict = await (r1.status === 409 ? r1 : r2).json();
    expect(conflict.error.code).toBe("slot_taken");
    expect(conflict.error.message).toEqual(expect.any(String));
    expect(conflict.error.alternatives).toHaveLength(3);
    expect(conflict.error.alternatives[0]).toEqual({
      start: expect.stringMatching(/\+02:00$/),
      end: expect.stringMatching(/\+02:00$/),
      label: expect.stringMatching(/^\d{2}:\d{2}$/),
    });
    expect(await bookingCount()).toBe(1);
  });

  it("форма и агент едновременно за един слот: точно една резервация", async () => {
    const [form, agent] = await Promise.allSettled([
      bookingSvc().createBooking(bookingBody({ customerPhone: "0888000011" }), {
        source: "web",
        clientKey: "1.2.3.4",
      }),
      post(bookingBody({ customerPhone: "0888000012" })),
    ]);
    const formOk = form.status === "fulfilled";
    const agentStatus = agent.status === "fulfilled" ? agent.value.status : 0;
    expect(Number(formOk) + Number(agentStatus === 201)).toBe(1);
    if (formOk) expect(agentStatus).toBe(409);
    expect(await bookingCount()).toBe(1);
  });

  it.each([
    ["невалиден телефон", { customerPhone: "123" }, "validation_error", "customerPhone"],
    ["невалидно име", { customerName: "1" }, "validation_error", "customerName"],
    ["час без зона", { start: "2030-01-08T10:00:00" }, "validation_error", "start"],
    ["час извън слотовете", { start: at(TOMORROW, "13:00") }, "invalid_slot", null],
    [
      "неактивна услуга",
      { serviceId: "00000000-0000-4000-8000-000000000000" },
      "service_not_found",
      null,
    ],
    [
      "неактивен бръснар",
      { barberId: "00000000-0000-4000-8000-000000000001" },
      "barber_not_found",
      null,
    ],
  ])("422 при %s", async (_n, over, code, field) => {
    const res = await post(bookingBody(over));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe(code);
    if (field) expect(body.error.fields[field as string]).toEqual(expect.any(String));
    expect(await bookingCount()).toBe(0);
  });

  it("422 при неактивни услуга/бръснар", async () => {
    const r1 = await post(bookingBody({ serviceId: fx.inactiveService.id }));
    expect((await r1.json()).error.code).toBe("service_inactive");
    const r2 = await post(bookingBody({ barberId: fx.inactiveBarber.id }));
    expect((await r2.json()).error.code).toBe("barber_inactive");
  });

  it("422 без Idempotency-Key и при невалиден JSON", async () => {
    const noKey = await post(bookingBody(), null);
    expect(noKey.status).toBe(422);
    expect((await noKey.json()).error.code).toBe("idempotency_key_required");
    const badJson = await post("{not json");
    expect(badJson.status).toBe(422);
    expect((await badJson.json()).error.code).toBe("invalid_json");
    const arr = await post([1, 2]);
    expect((await arr.json()).error.code).toBe("invalid_json");
  });
});
