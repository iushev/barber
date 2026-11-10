# План: сайт за бръснарница (Next.js + Drizzle + n8n агент)

## Context

Празна папка (само `docs/prompt.md`) → изграждаме от нулата система по спецификацията в `docs/prompt.md`: публичен сайт, форма за записване, AI агент в n8n, админ панел, self-hosted с Docker Compose без reverse proxy. Работим в 7 етапа с **пауза след всеки етап** (обобщение + как се проверява, чакам „продължи“).

Уточнени решения:

- Снимки на бръснари: качване от админа → именуван Docker volume `uploads` (`/app/uploads`), сервират се през route handler.
- Отмяна от клиента през `/booking/<token>`: до `CANCEL_CUTOFF_HOURS` (по подразбиране 2) преди часа; след това → показва телефона на бръснарницата.
- Бизнес данни: placeholder-и в `src/config/site.ts`, маркирани `// TODO: замени`.
- Пакетен мениджър: npm (pnpm липсва). `git init` в началото на етап 1 (локално, без remote, без commit, освен ако не поискаш).

## Версии (проверени с `npm view` на 2026-11-10)

next 16.4.x, react 19.3, drizzle-orm 0.45, drizzle-kit 0.31, pg 8.23, zod 4.6, tailwindcss 4.3, vitest 5, @playwright/test 1.65, eslint 10 + eslint-config-next, prettier 3.9, esbuild 0.28, tsx, @date-fns/tz + date-fns 4, libphonenumber-js.
TypeScript: опитвам 7.0.2; ако Next 16 typecheck/ESLint parser не работят с него → последна 6.x (записва се в DECISIONS.md).
Образи: `postgres:18.6-alpine`, `docker.n8n.io/n8nio/n8n:2.47.3` (stable), `node:24-alpine` за app.

## Ключови архитектурни решения (→ `DECISIONS.md`)

- **Часова зона**: `@date-fns/tz` (`TZDate`), `BUSINESS_TIMEZONE=Europe/Sofia`; всички изчисления „стенно време → UTC“ минават през една помощна функция (тест за DST дните 29.03 и 25.10).
- **Rate limit**: в Postgres (таблица `rate_limits`, fixed window, `INSERT … ON CONFLICT DO UPDATE … RETURNING count`), без Redis — работи и при няколко app контейнера. Ползва се за login, `/api/chat`, Agent API, създаване на резервации (по IP и по телефон).
- **Админ сесии**: таблица `admin_sessions` (пазим SHA-256 на случаен токен), cookie `httpOnly`, `sameSite=lax`, `secure` = `COOKIE_SECURE`. Проверка в `src/proxy.ts`/middleware (само наличие) + задължителна проверка в сървърния layout/handler-ите на `/admin` и `/api/admin`.
- **Парола**: argon2id чрез вградения `node:crypto.argon2` (Node 24) → без native зависимост в `bootstrap-admin.mjs`; резервен вариант `@node-rs/argon2`.
- **CSRF**: Server Actions (вградена Origin проверка) + за мутиращи route handlers проверка `Origin`/`Host` (с `TRUST_PROXY` за `X-Forwarded-Host/Proto`) + sameSite cookie. Agent API е изключен (Bearer).
- **Телефон**: `libphonenumber-js`, default регион BG, нормализиране до E.164.
- **Security headers**: в `next.config.ts` `headers()` + CSP с nonce в proxy/middleware.
- **Booking service** (`src/server/booking/*`) е единственото място с бизнес логика; формата (Server Actions), Agent API и админът са тънки слоеве.

## Структура

```
src/app/(public)/…  src/app/admin/…  src/app/api/{health,chat,agent/v1/*,admin/*}
src/config/{env.ts (Zod-валидирани env), site.ts}
src/db/{schema.ts,index.ts}   src/server/{booking,slots,auth,ratelimit,phone,time}/
src/lib/validation/*  (споделени Zod схеми)   src/components/*
scripts/{migrate.ts,bootstrap-admin.ts,seed.ts,build-scripts.mjs}
drizzle/ (миграции)   docker/postgres-init/01-n8n.sh   n8n/{workflows,prompts}
tests/{unit,integration,e2e}   .github/workflows/ci.yml
Dockerfile docker-entrypoint.sh docker-compose.yml docker-compose.override.yml .env.example README.md DECISIONS.md
```

## Етап 1 (детайлно): структура, схема, миграции, Docker, seed

1. Scaffold Next.js (App Router, TS strict, Tailwind 4, ESLint+Prettier, `output: 'standalone'`), `src/config/env.ts` (Zod, fail-fast).
2. `src/db/schema.ts` (uuid PK-та, `timestamptz` UTC):
   - `barbers` (name, slug, bio, photo_path, active, sort_order), `services` (name, description, duration_min, price_cents, active, sort_order), `barber_services` (PK barber+service)
   - `working_hours` (barber_id, weekday 0–6, start_time, end_time, break_start, break_end; CHECK-ове), `schedule_exceptions` (barber_id, date, type `off|custom`, start/end/break, note; unique barber+date)
   - `bookings` (barber_id, service_id, start_at, end_at, customer_name, customer_phone, status enum `confirmed|cancelled|completed|no_show`, source enum `web|chat|admin`, token_hash unique, price_cents + duration_min + service_name snapshot, chat_session_id nullable, created_at, cancelled_at, anonymized_at; индекси по barber+start, phone, status)
   - `idempotency_keys` (key PK, scope, request_hash, booking_id, response jsonb, expires_at), `rate_limits` (key, window_start, count), `admin_users`, `admin_sessions`.
   - Токенът за `/booking/<token>`: 32 байта base64url; в БД само хеш.
3. `drizzle.config.ts`, npm скриптове `db:generate`, `db:migrate:dev`, `db:check`, `db:studio`, `db:seed`; генериране на първата миграция.
4. Custom миграция (`drizzle-kit generate --custom --name=booking_overlap_guard`) с коментар защо:
   ```sql
   CREATE EXTENSION IF NOT EXISTS btree_gist;
   ALTER TABLE bookings ADD CONSTRAINT bookings_no_overlap
     EXCLUDE USING gist (barber_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&)
     WHERE (status IN ('confirmed','completed','no_show'));
   ```
   (+ CHECK `end_at > start_at`). Активни статуси = всички освен `cancelled`.
5. `scripts/migrate.ts`: retry 30×1s, `pg_advisory_lock(<константа>)` на отделен клиент, `migrate()`, лог на новоприложените миграции (сравнение на `drizzle.__drizzle_migrations` преди/след) и времето, без URL; `process.exit(1)` при грешка. `scripts/bootstrap-admin.ts` (идемпотентен, пропуска без env). `scripts/build-scripts.mjs` → esbuild bundle → `dist-scripts/migrate.mjs`, `bootstrap-admin.mjs` (platform node, format esm, всичко вградено).
6. `scripts/seed.ts`: 3 бръснаря, 7 услуги, седмичен график, изключение, няколко резервации; отказва при `NODE_ENV=production`, освен ако `SEED_ALLOW_PRODUCTION=yes`; работи само чрез booking-съвместими insert-и.
7. `Dockerfile` (deps → builder → runner; non-root `nextjs`; копира standalone, `public`, `.next/static`, `dist-scripts/*.mjs`, `drizzle/`; `HEALTHCHECK` в compose) и `docker-entrypoint.sh` (`set -e`, migrate → bootstrap ако има env → `exec node server.js`). `/api/health` (SELECT 1).
8. `docker-compose.yml`: точно по спецификацията (postgres без порт + init скрипт за база/потребител `n8n` и `barbershop` с owner = app потребителя; app на `${APP_PORT:-3000}`; n8n `127.0.0.1:${N8N_EDITOR_PORT:-5678}`, env за DB/encryption/TZ/диагностики/prune/`EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`; мрежи `internal` (internal: true) + `public`; volumes `pgdata`, `n8n_data`, `uploads`; логове json-file 10m×3). `docker-compose.override.yml`: postgres на `127.0.0.1:5432`, app с dev target (bind mount + `next dev`, същият entrypoint за миграции).
9. `.env.example`, начален `README.md`/`DECISIONS.md`, `.gitignore`, `.dockerignore`.

## Етапи 2–7 (обобщено, детайлизирам при старта на всеки)

2. **Booking service**: `computeSlots` (чиста функция: график/изключения/почивка/стъпка `SLOT_STEP_MIN`/`MIN_LEAD_MIN`/`BOOKING_HORIZON_DAYS`/заети интервали), `createBooking` (транзакция, проверка, че `start` е валиден слот, лимити по IP/телефон и `MAX_ACTIVE_BOOKINGS_PER_PHONE`, улавяне на `23P01` → `SlotTakenError` + до 3 алтернативи), `cancelBooking`, `rescheduleBooking`. Vitest unit + интеграционни (истинска Postgres база `barbershop_test`, паралелни заявки).
3. **Agent API**: Bearer с `timingSafeEqual` върху SHA-256, rate limit, единен формат на грешките, идемпотентност (хеш на тялото; същият ключ + различно тяло → 422), `manageUrl` от `PUBLIC_BASE_URL`. Тестове: 401, idempotency, паралелен 409 с `alternatives` (form + agent едновременно), 422.
4. **Админ**: login с rate limit, бръснари (+качване на снимка с проверка на magic bytes и лимит на размера), график/изключения, услуги, резервации (филтри, статус, ръчно добавяне, преместване), предупреждения при деактивиране, анонимизиране + изтриване на n8n чат историята (заявка към таблицата `n8n_chat_histories` в базата `n8n` през отделна връзка `N8N_DATABASE_URL`, или чрез вебхук; решава се в етап 4/6).
5. **Публичен сайт**: landing (дизайн в тъмни тонове с месинг/кожа, Server Components, `next/font`, placeholder-и), `/book` (стъпки, honeypot, съгласие), `/booking/[token]`, `/privacy`.
6. **n8n**: `booking-agent.json` (Chat Trigger Basic Auth + Streaming, ако 2.47 го поддържа → проверка в контейнера и запис в DECISIONS.md), AI Agent + OpenAI (`OPENAI_MODEL`, temp 0.2, max iterations), Postgres Chat Memory (window N), 3 HTTP Request Tool nodes; системен промпт с `{{ $now.setZone('Europe/Sofia') }}`; `/api/chat` прокси + widget с „пише…“; скрипт `npm run n8n:import`.
7. **Полиране**: SEO/JSON-LD `HairSalon`, a11y, Playwright e2e, smoke тест на `/api/chat` (skip без ключ), CI (`lint`, `typecheck`, тестове с Postgres service, `drizzle-kit check`, `drizzle-kit generate` + `git diff --exit-code drizzle/`), пълен README.

## Проверка

- Етап 1: `npm run lint && npm run typecheck`; `docker compose -f docker-compose.yml up -d --build` → логът на `app` показва приложените миграции, `curl localhost:3000/api/health` → 200; `docker compose restart app` → „няма нови миграции“; `psql` в postgres контейнера: `\dx btree_gist`, `\d bookings` показва `bookings_no_overlap`; ръчен INSERT на застъпващи се резервации → грешка `23P01`; `npm run db:seed` локално; потребителят `n8n` няма достъп до `barbershop` и обратно; n8n редакторът отговаря на `127.0.0.1:5678`.
- Следващите етапи: `npm test` (unit + integration срещу Postgres от override-а), Playwright e2e, ръчен чат през widget-а.
