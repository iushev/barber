/**
 * Прилага Drizzle миграциите при стартиране на контейнера `app`.
 *
 * Компилира се с esbuild до един файл `dist-scripts/migrate.mjs` (с вградени
 * drizzle-orm и pg), за да не зависи от node_modules в standalone образа.
 *
 * - чака Postgres (до MIGRATE_MAX_ATTEMPTS опита през 1 s);
 * - взима advisory lock, за да не мигрират няколко контейнера едновременно;
 * - логва приложените миграции и времето (без connection string/парола);
 * - излиза с ненулев код при грешка.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

/** Произволна, но фиксирана стойност, уникална за това приложение. */
const MIGRATION_LOCK_ID = 727_001_2026;
const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";

const log = (msg: string) => console.log(`[migrate] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function migrationsFolder(): string {
  return path.resolve(process.env.MIGRATIONS_DIR ?? "./drizzle");
}

/** Таговете на миграциите по `when` (= created_at в таблицата на Drizzle). */
function readJournal(folder: string): Map<number, string> {
  const raw = readFileSync(path.join(folder, "meta", "_journal.json"), "utf8");
  const journal = JSON.parse(raw) as { entries: { when: number; tag: string }[] };
  return new Map(journal.entries.map((e) => [e.when, e.tag]));
}

async function appliedMigrations(client: pg.Client): Promise<Set<number>> {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT to_regclass($1) IS NOT NULL AS exists`,
    [`${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`],
  );
  if (!exists.rows[0]?.exists) return new Set();
  const res = await client.query<{ created_at: string }>(
    `SELECT created_at FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`,
  );
  return new Set(res.rows.map((r) => Number(r.created_at)));
}

async function connectWithRetry(connectionString: string): Promise<pg.Client> {
  const maxAttempts = Number(process.env.MIGRATE_MAX_ATTEMPTS ?? 30);
  for (let attempt = 1; ; attempt++) {
    const client = new pg.Client({ connectionString, application_name: "barbershop-migrate" });
    try {
      await client.connect();
      await client.query("SELECT 1");
      return client;
    } catch (err) {
      await client.end().catch(() => undefined);
      if (attempt >= maxAttempts) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      log(`Postgres още не е готов (опит ${attempt}/${maxAttempts}): ${reason}`);
      await sleep(1000);
    }
  }
}

export async function runMigrations(connectionString: string): Promise<string[]> {
  const folder = migrationsFolder();
  const journal = readJournal(folder);
  const started = performance.now();

  const client = await connectWithRetry(connectionString);
  try {
    log("изчаквам advisory lock…");
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    try {
      const before = await appliedMigrations(client);
      await migrate(drizzle(client), {
        migrationsFolder: folder,
        migrationsSchema: MIGRATIONS_SCHEMA,
        migrationsTable: MIGRATIONS_TABLE,
      });
      const after = await appliedMigrations(client);
      const applied = [...after]
        .filter((when) => !before.has(when))
        .sort((a, b) => a - b)
        .map((when) => journal.get(when) ?? String(when));

      const ms = Math.round(performance.now() - started);
      if (applied.length === 0) {
        log(`няма нови миграции (${after.size} вече приложени, ${ms} ms)`);
      } else {
        for (const tag of applied) log(`приложена: ${tag}`);
        log(`приложени ${applied.length} миграции за ${ms} ms`);
      }
      return applied;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("липсва DATABASE_URL");
    process.exit(1);
  }
  try {
    await runMigrations(url);
  } catch (err) {
    // pg грешките не съдържат паролата; логваме само съобщение и код.
    const e = err as { message?: string; code?: string };
    log(`ГРЕШКА: ${e.message ?? String(err)}${e.code ? ` (код ${e.code})` : ""}`);
    process.exit(1);
  }
}

// Изпълнява се само при директно стартиране (не при import от тестовете).
const invokedDirectly =
  process.argv[1] && /migrate\.(mjs|ts)$/.test(process.argv[1]) && !process.env.VITEST;
if (invokedDirectly) void main();
