import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { runMigrations } from "../../scripts/migrate";
import * as schema from "../../src/db/schema";
import type { BookingRules } from "../../src/server/booking/service";
import type { Db } from "../../src/server/db-types";
import { resetTestDatabase } from "./db";

export const TZ = "Europe/Sofia";
/** Понеделник 2030-01-07, 08:00 местно време (UTC+2). */
export const NOW = new Date("2030-01-07T06:00:00Z");
export const TOMORROW = "2030-01-08";

export const testRules: BookingRules = {
  tz: TZ,
  currency: "EUR",
  stepMin: 30,
  minLeadMin: 60,
  horizonDays: 60,
  maxActivePerPhone: 3,
  cancelCutoffHours: 2,
  rateLimits: { perClientPerHour: 1000, perPhonePerDay: 1000 },
};

export interface Fixture {
  pool: pg.Pool;
  db: Db;
  barberA: schema.Barber;
  barberB: schema.Barber;
  inactiveBarber: schema.Barber;
  haircut: schema.Service; // 30 мин, A и B
  beard: schema.Service; // 45 мин, само B
  inactiveService: schema.Service;
}

/** Празна база → миграции → минимален каталог с график (09:00–18:00, почивка 13–14, всеки ден). */
export async function setupFixture(): Promise<Fixture> {
  const url = await resetTestDatabase();
  await runMigrations(url);
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  const db = drizzle(pool, { schema });

  const [barberA, barberB, inactiveBarber] = await db
    .insert(schema.barbers)
    .values([
      { name: "Бръснар А", slug: "a" },
      { name: "Бръснар Б", slug: "b" },
      { name: "Неактивен", slug: "x", active: false },
    ])
    .returning();
  const [haircut, beard, inactiveService] = await db
    .insert(schema.services)
    .values([
      { name: "Подстригване", durationMin: 30, priceCents: 2000, sortOrder: 0 },
      { name: "Брада", durationMin: 45, priceCents: 1500, sortOrder: 1 },
      { name: "Стара услуга", durationMin: 30, priceCents: 1000, active: false },
    ])
    .returning();

  await db.insert(schema.barberServices).values([
    { barberId: barberA!.id, serviceId: haircut!.id },
    { barberId: barberB!.id, serviceId: haircut!.id },
    { barberId: barberB!.id, serviceId: beard!.id },
    { barberId: inactiveBarber!.id, serviceId: haircut!.id },
    { barberId: barberA!.id, serviceId: inactiveService!.id },
  ]);
  for (const b of [barberA!, barberB!, inactiveBarber!]) {
    await db.insert(schema.workingHours).values(
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
        barberId: b.id,
        weekday,
        startTime: "09:00",
        endTime: "18:00",
        breakStart: "13:00",
        breakEnd: "14:00",
      })),
    );
  }

  return {
    pool,
    db,
    barberA: barberA!,
    barberB: barberB!,
    inactiveBarber: inactiveBarber!,
    haircut: haircut!,
    beard: beard!,
    inactiveService: inactiveService!,
  };
}

export async function clearBookings(db: Db) {
  await db.delete(schema.idempotencyKeys);
  await db.delete(schema.bookings);
  await db.delete(schema.rateLimits);
  await db.delete(schema.scheduleExceptions);
}

/** "2030-01-08" + "10:00" → ISO с отместване за София през зимата. */
export const at = (date: string, time: string) => `${date}T${time}:00+02:00`;
