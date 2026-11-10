-- Custom миграция (drizzle-kit generate --custom): защита от двойно записване на ниво БД.
--
-- Защо е custom: Drizzle схемата не може да изрази нито CREATE EXTENSION, нито
-- EXCLUDE constraint с tstzrange и частично условие (WHERE), затова те живеят тук.
--
-- btree_gist е "trusted" разширение (PostgreSQL 13+), така че собственикът на базата
-- `barbershop` (потребителят на приложението) може да го създаде без суперпотребител.
--
-- Constraint-ът забранява два интервала [start_at, end_at) за един и същ бръснар да се
-- застъпват, но само за статуси, които заемат време (всички без 'cancelled').
-- Полуотвореният интервал '[)' позволява час 10:00–10:30 и следващ от 10:30.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "barber_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  )
  WHERE ("status" <> 'cancelled');
