import "server-only";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/config/env";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// Един Pool за процеса; при hot reload в dev се преизползва чрез globalThis.
const globalForDb = globalThis as unknown as { __barberPool?: Pool; __barberDb?: Db };

function createPool(): Pool {
  const { DATABASE_URL, DB_POOL_MAX } = env();
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: "barbershop-app",
  });
  pool.on("error", (err) => {
    // Без connection string и лични данни в логовете.
    console.error("[db] грешка в неактивна връзка:", err.message);
  });
  return pool;
}

export function getPool(): Pool {
  globalForDb.__barberPool ??= createPool();
  return globalForDb.__barberPool;
}

export function getDb(): Db {
  globalForDb.__barberDb ??= drizzle(getPool(), { schema });
  return globalForDb.__barberDb;
}

export { schema };
