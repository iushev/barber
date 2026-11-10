import pg from "pg";

/**
 * Нулира тестовата база от TEST_DATABASE_URL (изтрива схемите `public` и `drizzle`)
 * и връща URL-а ѝ. Базата трябва да съществува и потребителят да е неин собственик
 * (виж README → „Тестове“), така че не са нужни права CREATEDB.
 */
export async function resetTestDatabase(): Promise<string> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("Задай TEST_DATABASE_URL за интеграционните тестове");
  const dbName = new URL(url).pathname.slice(1);
  if (!/_test$/.test(dbName)) {
    throw new Error(`Отказ: тестовата база трябва да завършва на _test (получено: ${dbName})`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      DROP TYPE IF EXISTS booking_status, booking_source, schedule_exception_type CASCADE;
    `);
  } finally {
    await client.end();
  }
  return url;
}
