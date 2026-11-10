/**
 * Идемпотентно създава първия (единствения) администратор от ADMIN_EMAIL/ADMIN_PASSWORD.
 * - Пропуска се, ако env променливите липсват.
 * - Не прави нищо, ако вече има администратор (паролата НЕ се презаписва).
 * Компилира се до dist-scripts/bootstrap-admin.mjs.
 */
import { count } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { z } from "zod";
import { adminUsers } from "../src/db/schema";
import { hashPassword } from "../src/server/auth/password";

const log = (msg: string) => console.log(`[bootstrap-admin] ${msg}`);

async function main() {
  const { DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    log("ADMIN_EMAIL/ADMIN_PASSWORD не са зададени — пропускам");
    return;
  }
  if (!DATABASE_URL) throw new Error("липсва DATABASE_URL");

  const email = z.string().trim().toLowerCase().email().safeParse(ADMIN_EMAIL);
  if (!email.success) throw new Error("ADMIN_EMAIL не е валиден имейл");
  if (ADMIN_PASSWORD.length < 12) throw new Error("ADMIN_PASSWORD трябва да е поне 12 символа");

  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const db = drizzle(client);
    const [row] = await db.select({ n: count() }).from(adminUsers);
    if ((row?.n ?? 0) > 0) {
      log("администратор вече съществува — пропускам");
      return;
    }
    await db
      .insert(adminUsers)
      .values({ email: email.data, passwordHash: await hashPassword(ADMIN_PASSWORD) })
      .onConflictDoNothing();
    log("създаден е първият администратор");
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  log(`ГРЕШКА: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
