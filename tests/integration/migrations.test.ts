import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate";
import { resetTestDatabase } from "../support/db";

let url: string;
let client: pg.Client;

beforeAll(async () => {
  url = await resetTestDatabase();
});

afterAll(async () => {
  await client?.end();
});

describe("миграции", () => {
  it("се прилагат върху празна база", async () => {
    const applied = await runMigrations(url);
    expect(applied).toContain("0000_init");
    expect(applied).toContain("0001_booking_overlap_guard");
  });

  it("повторното изпълнение е без ефект", async () => {
    const applied = await runMigrations(url);
    expect(applied).toEqual([]);
  });

  it("exclusion constraint-ът забранява застъпване за един бръснар", async () => {
    client = new pg.Client({ connectionString: url });
    await client.connect();

    const ext = await client.query(`SELECT 1 FROM pg_extension WHERE extname = 'btree_gist'`);
    expect(ext.rowCount).toBe(1);

    const barber = await client.query<{ id: string }>(
      `INSERT INTO barbers (name, slug) VALUES ('Тест', 'test') RETURNING id`,
    );
    const other = await client.query<{ id: string }>(
      `INSERT INTO barbers (name, slug) VALUES ('Друг', 'other') RETURNING id`,
    );
    const service = await client.query<{ id: string }>(
      `INSERT INTO services (name, duration_min, price_cents) VALUES ('Подстригване', 30, 2000) RETURNING id`,
    );
    const b = barber.rows[0]!.id;
    const s = service.rows[0]!.id;

    const insert = (
      barberId: string,
      start: string,
      end: string,
      token: string,
      status = "confirmed",
    ) =>
      client.query(
        `INSERT INTO bookings (barber_id, service_id, start_at, end_at, customer_name, customer_phone,
           status, source, token_hash, service_name, price_cents, currency, duration_min)
         VALUES ($1, $2, $3, $4, 'Клиент', '+359888000000', $6, 'web', $5, 'Подстригване', 2000, 'EUR', 30)`,
        [barberId, s, start, end, token, status],
      );

    await insert(b, "2030-01-10T10:00:00Z", "2030-01-10T10:30:00Z", "t1");

    // Застъпване → 23P01 (exclusion_violation)
    await expect(
      insert(b, "2030-01-10T10:15:00Z", "2030-01-10T10:45:00Z", "t2"),
    ).rejects.toMatchObject({
      code: "23P01",
    });

    // Съседен час (полуотворен интервал) е позволен.
    await insert(b, "2030-01-10T10:30:00Z", "2030-01-10T11:00:00Z", "t3");
    // Друг бръснар в същото време е позволен.
    await insert(other.rows[0]!.id, "2030-01-10T10:00:00Z", "2030-01-10T10:30:00Z", "t4");
    // Отменена резервация не заема време.
    await insert(b, "2030-01-10T10:00:00Z", "2030-01-10T10:30:00Z", "t5", "cancelled");
  });
});
