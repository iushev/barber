# Бръснарница — сайт, онлайн записване, AI чат агент и админ панел

Публичен сайт с онлайн записване на час, личен линк за преглед/отмяна на резервацията, AI
чат асистент, който записва часове, и админ панел за графици, услуги и резервации.
Self-hosted с Docker Compose — без външни услуги освен OpenAI (само за чата).

- **Стек:** Next.js 16 (App Router, TypeScript strict) · PostgreSQL 18 + Drizzle ORM · Tailwind 4 ·
  Zod · n8n 2.47 (AI агент) · Vitest + Playwright.
- **Решения и отклонения от заданието:** [DECISIONS.md](DECISIONS.md).

## Съдържание

1. [Архитектура](#архитектура)
2. [Локална разработка](#локална-разработка)
3. [Конфигурация (.env)](#конфигурация-env)
4. [Деплой на сървър](#деплой-на-сървър)
5. [Обновяване и миграции](#обновяване-и-миграции)
6. [Backup и възстановяване](#backup-и-възстановяване)
7. [Чат агент (n8n)](#чат-агент-n8n)
8. [Тестове и CI](#тестове-и-ci)
9. [Сигурност и лични данни](#сигурност-и-лични-данни)
10. [Преди пускане](#преди-пускане-чеклист)
11. [Отстраняване на проблеми](#отстраняване-на-проблеми)

## Архитектура

```
                интернет (през TLS терминатор извън проекта)
                              │
                     ┌────────▼────────┐  мрежа public
                     │   app (Next.js) │  :3000
                     └──┬──────────┬───┘
       мрежа internal   │          │  POST /api/chat → Basic Auth
     (без изход навън)  │          │
              ┌─────────▼──┐   ┌───▼─────────────┐ мрежа egress
              │  postgres  │◄──│ n8n (AI Agent)  │──────────► OpenAI API
              │ barbershop │   │ Chat Trigger    │
              │ n8n        │   │ HTTP Tools ─────┼──► app /api/agent/v1/* (Bearer)
              └────────────┘   └─────────────────┘
                                 редактор само на 127.0.0.1:5678 (SSH тунел)
```

- **Booking service** (`src/server/booking/`) е единственото място с бизнес логика за
  записвания. Формата (Server Actions), Agent API и админът са тънки слоеве върху него.
- Двойни резервации са невъзможни на ниво база: exclusion constraint `bookings_no_overlap`
  (`btree_gist`, `tstzrange`), плюс заключване на реда на бръснаря в транзакцията.
- Всички времена се пазят в UTC (`timestamptz`); графиците са „стенно време“ в
  `BUSINESS_TIMEZONE` (Europe/Sofia), включително дните с преминаване към лятно/зимно време.
- Публични страници: `/` (landing), `/book` (записване в 4 стъпки), `/booking/<token>`
  (личен линк; в базата е само SHA-256 хешът на токена), `/privacy`. Админ: `/admin`.

## Локална разработка

Изисквания: Docker с Compose v2 и Node.js ≥ 24.7 (за скриптовете и тестовете от хоста).

```bash
cp .env.example .env              # смени паролите: openssl rand -hex 32
npm install
docker compose up -d --build      # app (next dev, hot reload), postgres, n8n
curl localhost:3000/api/health    # {"status":"ok"}
npm run db:seed                   # демо данни: 3 бръснаря, 7 услуги, графици, резервации
```

- `docker compose` зарежда автоматично `docker-compose.override.yml` (dev): app е в dev режим
  с bind mount на кода, Postgres е достъпен на `127.0.0.1:5432` за скриптовете от хоста (и в production, само на loopback).
- Сайт: http://localhost:3000 · Админ: http://localhost:3000/admin (`ADMIN_EMAIL` /
  `ADMIN_PASSWORD` от `.env`; акаунтът се създава при старт на app) · n8n: http://localhost:5678.
- Чатът работи след настройката на n8n (вижте [Чат агент](#чат-агент-n8n)); без нея widget-ът
  показва съобщение и препраща към формата.

| Команда                                 | Какво прави                                               |
| --------------------------------------- | --------------------------------------------------------- |
| `npm run dev`                           | Next.js dev сървър на хоста (нужен е Postgres от compose) |
| `npm run lint` / `typecheck` / `format` | ESLint / `tsc --noEmit` / Prettier                        |
| `npm test`                              | unit + интеграционни тестове (истинска Postgres база)     |
| `npm run test:e2e`                      | Playwright срещу работещия стек                           |
| `npm run test:smoke`                    | `/api/chat` ↔ n8n (пропуска се, ако чатът не е настроен)  |
| `npm run db:generate`                   | нова миграция от промени в `src/db/schema.ts`             |
| `npm run db:migrate`                    | прилага миграциите (същият скрипт като в контейнера)      |
| `npm run db:check` / `db:studio`        | проверка на миграциите / Drizzle Studio                   |
| `npm run db:seed [-- --reset]`          | демо данни (`--reset` изтрива всичко преди това)          |
| `npm run admin:bootstrap`               | създава администратор от `ADMIN_EMAIL`/`ADMIN_PASSWORD`   |
| `npm run n8n:build` / `n8n:setup`       | генерира n8n workflow-ите / импортира ги в n8n            |

## Конфигурация (.env)

Всички променливи са описани с коментари в [.env.example](.env.example). Приложението ги
валидира при старт (`src/config/env.ts`) и отказва да тръгне с невалидни стойности.
`.env` никога не се commit-ва.

| Променлива                                                               | По подразбиране           | Описание                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_SUPERUSER_PASSWORD`                                            | —                         | Парола на superuser-а на Postgres (само за init/backup)                                                           |
| `APP_DB_USER` / `APP_DB_PASSWORD`                                        | `barbershop` / —          | Потребител на приложението; собственик само на база `barbershop`                                                  |
| `N8N_DB_USER` / `N8N_DB_PASSWORD`                                        | `n8n` / —                 | Потребител на n8n; собственик само на база `n8n`                                                                  |
| `DATABASE_URL`                                                           | —                         | За скриптовете от хоста (в контейнера се сглобява от горните)                                                     |
| `PUBLIC_BASE_URL`                                                        | —                         | Публичният адрес (`https://…`). Ползва се за линковете към резервациите, canonical, sitemap, проверка на Origin   |
| `APP_BIND` / `APP_PORT`                                                  | `0.0.0.0` / `3000`        | Къде слуша app на хоста. Зад TLS терминатор на същата машина: `127.0.0.1`                                         |
| `COOKIE_SECURE`                                                          | `false`                   | `true` зад HTTPS (Secure cookies, `__Host-` префикс за админа)                                                    |
| `TRUST_PROXY`                                                            | `false`                   | `true` само ако пред app има точно един доверен proxy, който задава `X-Forwarded-For`                             |
| `ENABLE_HSTS`                                                            | `false`                   | `true` само при работещ HTTPS (HSTS + `upgrade-insecure-requests` в CSP)                                          |
| `BUSINESS_TIMEZONE` / `CURRENCY`                                         | `Europe/Sofia` / `EUR`    |                                                                                                                   |
| `SLOT_STEP_MIN`                                                          | `15`                      | Стъпка на свободните часове (15 или 30 мин.)                                                                      |
| `MIN_LEAD_MIN`                                                           | `60`                      | Най-рано колко минути напред може да се запише час                                                                |
| `BOOKING_HORIZON_DAYS`                                                   | `60`                      | Колко дни напред може да се записва                                                                               |
| `MAX_ACTIVE_BOOKINGS_PER_PHONE`                                          | `3`                       | Максимум предстоящи резервации на един телефон                                                                    |
| `CANCEL_CUTOFF_HOURS`                                                    | `2`                       | До колко часа преди часа клиентът може да отмени сам                                                              |
| `BOOKING_RATE_LIMIT_PER_CLIENT_HOUR` / `_PER_PHONE_DAY`                  | `10` / `6`                | Лимити за създаване на резервации (по IP и по телефон)                                                            |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD`                                         | —                         | Първоначален администратор (парола ≥ 12 символа). Създава се при старт, ако не съществува; после може да се махне |
| `AGENT_API_KEY`                                                          | —                         | Bearer ключ за `/api/agent/v1/*` (≥ 32 символа), ползва се от n8n                                                 |
| `AGENT_API_RATE_LIMIT_PER_MIN` / `IDEMPOTENCY_TTL_HOURS`                 | `120` / `24`              |                                                                                                                   |
| `N8N_ENCRYPTION_KEY`                                                     | —                         | Криптира credentials в n8n. **Не се сменя след първия старт** — пазете го в backup-а на тайните                   |
| `N8N_EDITOR_BIND` / `N8N_EDITOR_PORT`                                    | `127.0.0.1` / `5678`      | Редакторът на n8n — само loopback                                                                                 |
| `N8N_EXECUTIONS_MAX_AGE_HOURS`                                           | `24`                      | Колко време се пазят (неуспешните) изпълнения в n8n                                                               |
| `N8N_CHAT_URL` / `N8N_CHAT_USER` / `N8N_CHAT_PASSWORD`                   | вътрешен URL / `chat` / — | Chat Trigger на n8n (Basic Auth). Без тях `/api/chat` връща 503 и сайтът препраща към формата                     |
| `N8N_CHAT_PURGE_URL`                                                     | вътрешен URL              | Webhook за изтриване на историята на чата („Нов разговор“, анонимизиране)                                         |
| `CHAT_RATE_LIMIT_PER_MIN` / `_PER_DAY` / `CHAT_MAX_MESSAGES_PER_SESSION` | `10` / `150` / `60`       | Ограничават разхода към OpenAI                                                                                    |
| `CHAT_TIMEOUT_MS`                                                        | `90000`                   |                                                                                                                   |
| `DATA_RETENTION_MONTHS`                                                  | `24`                      | След колко месеца приключилите резервации се анонимизират автоматично                                             |
| `SEED_ALLOW_PRODUCTION`                                                  | `no`                      | `yes` позволява `db:seed` при `NODE_ENV=production` (само за демо сървър)                                         |

`OPENAI_API_KEY` **не е** в `.env`: въвежда се веднъж (в редактора на n8n или с
`scripts/n8n/setup.sh`) и се пази само криптиран в n8n. По избор може да е env при deploy
(напр. променлива на стека в Portainer) — тогава `n8n-setup` го обновява при всеки deploy.

Съдържанието, което не идва от базата (име, адрес, телефон, текстове, социални мрежи,
администратор на лични данни), е в [src/config/site.ts](src/config/site.ts) — в момента са
**placeholder-и**, маркирани с `TODO: замени`.

## Деплой на сървър

Изисквания: Linux сървър с Docker Engine + Compose v2, ≥ 2 GB RAM (n8n + Next.js build).

```bash
git clone <repo> barber && cd barber
cp .env.example .env && chmod 600 .env
# Попълнете .env: всички пароли/ключове с `openssl rand -hex 32`, PUBLIC_BASE_URL=https://…,
# COOKIE_SECURE=true, ENABLE_HSTS=true (след като HTTPS работи), APP_BIND=127.0.0.1 ако
# TLS терминаторът е на същата машина.
echo "COMPOSE_FILE=docker-compose.yml" >> .env   # без dev override-а!
docker compose up -d --build
docker compose logs app                          # миграциите и „ready“
OPENAI_API_KEY=sk-... ./scripts/n8n/setup.sh     # OpenAI ключът (еднократно)
```

**Portainer (само YAML):** workflow-ите са в образа `ghcr.io/iushev/barber-n8n-setup` (същият
таг като `APP_IMAGE_TAG`), който услугата `n8n-setup` внася при всеки deploy, преди n8n да
стартира. OpenAI ключът: променлива `OPENAI_API_KEY` на стека или веднъж в редактора на n8n
(SSH тунел → Credentials → „Barber · OpenAI“). Логове: `docker logs barbershop-n8n-setup`.

`COMPOSE_FILE=docker-compose.yml` е задължително на сървъра: иначе Compose зарежда и
`docker-compose.override.yml` (dev режим).

**TLS (HTTPS) е извън проекта** — app слуша на HTTP. Варианти:

- reverse proxy на хоста (Caddy, nginx, Traefik) → `127.0.0.1:3000`; задайте `APP_BIND=127.0.0.1`
  и `TRUST_PROXY=true`, ако proxy-то задава `X-Forwarded-For`;
- Cloudflare Tunnel / load balancer на доставчика → същото.

Без TLS не включвайте `COOKIE_SECURE`/`ENABLE_HSTS` — входът в админа няма да работи.

Какво се случва при старт на app (`docker-entrypoint.sh`): изчаква Postgres → прилага
новите миграции под advisory lock (безопасно при няколко реплики) → създава администратора,
ако `ADMIN_*` са зададени и няма такъв → стартира Next.js. Ако миграция се провали,
контейнерът спира и **не** тръгва със стара схема. Seed никога не се пуска автоматично.

**Редакторът на n8n** слуша само на `127.0.0.1:5678` на сървъра. Достъп през SSH тунел:

```bash
ssh -L 5678:127.0.0.1:5678 user@server   # после http://localhost:5678
```

Webhook-ите на n8n не са публикувани навън — достъпни са само от app по вътрешната мрежа.

## Обновяване и миграции

```bash
./scripts/backup.sh                  # винаги преди обновяване
git pull
docker compose up -d --build         # новите миграции се прилагат при старт на app
docker compose logs -f app
```

**Промяна на схемата (разработка):** редактирайте `src/db/schema.ts` → `npm run db:generate`
→ прегледайте SQL-а в `drizzle/` → commit. Неща, които Drizzle не изразява (разширения,
exclusion constraints): `npx drizzle-kit generate --custom --name=<име>`.

- **Никога** `drizzle-kit push` в production.
- Вече приложени миграции не се редактират — само нови (forward-only).
- Деструктивни промени (изтриване/преименуване на колони) — на две стъпки: първо код, който
  не ползва колоната, после миграция в следващо издание.
- CI проверява, че `drizzle/` съответства на схемата (`drizzle-kit check` + `generate` без промени).

**Ако миграция се провали при деплой:**

1. `docker compose logs app` — грешката и името на миграцията. Приложението не работи, но
   данните са непокътнати: новите миграции се прилагат в една транзакция и при грешка се
   отменят изцяло.
2. Бързо връщане: `git checkout <предишната версия> && docker compose up -d --build app`.
   Предишният код работи със старата схема, защото неуспешната миграция не е приложена.
3. Неуспешна миграция, която не е приложена в никоя среда, може да се поправи в същия файл;
   приложена някъде — само с нова миграция. Тествайте върху копие от backup-а: `createdb` +
   `pg_restore` (вижте по-долу) + `DATABASE_URL=… npm run db:migrate`.
4. Ако миграцията е минала, но данните са повредени — възстановяване от backup-а, направен
   преди деплоя.

## Backup и възстановяване

`./scripts/backup.sh` прави в `./backups/<дата-час>/` (права 700):

| Файл              | Съдържание                                                   |
| ----------------- | ------------------------------------------------------------ |
| `barbershop.dump` | база на приложението (`pg_dump -Fc`)                         |
| `n8n.dump`        | база на n8n: workflow-и, криптирани credentials, чат история |
| `globals.sql`     | роли (без пароли)                                            |
| `uploads.tar.gz`  | снимките на бръснарите (volume `uploads`)                    |
| `n8n_data.tar.gz` | директорията на n8n (volume `n8n_data`)                      |

Пази последните `KEEP_DAYS` (14) дни; `BACKUP_DIR` сменя директорията. Ежедневно по cron:

```cron
# crontab -e на потребителя, който управлява Docker
30 3 * * * cd /srv/barber && ./scripts/backup.sh >> backups/backup.log 2>&1
```

Backup-ите съдържат лични данни. Копирайте ги извън сървъра (криптирано: restic, borg,
rclone crypt) и пазете отделно `.env` (особено `N8N_ENCRYPTION_KEY` — без него credentials в
n8n не могат да се разчетат).

**Възстановяване** (на същия или нов сървър, със същия `.env`):

```bash
docker compose up -d postgres                         # празен Postgres; init създава ролите и базите
docker compose stop app n8n
B=backups/2026-11-10_033000
for db in barbershop n8n; do
  docker compose exec -T postgres pg_restore -U postgres -d $db --clean --if-exists \
    --no-owner --role=$( [ $db = n8n ] && echo n8n || echo barbershop ) < $B/$db.dump
done
docker compose run --rm -T --no-deps --entrypoint sh app -c 'tar xzf - -C /app' < $B/uploads.tar.gz
docker compose run --rm -T --no-deps --entrypoint sh n8n -c 'tar xzf - -C /home/node' < $B/n8n_data.tar.gz
docker compose up -d
```

Проверка на backup без засягане на данните: `createdb restore_check` в контейнера на Postgres →
`pg_restore -d restore_check …` → заявки → `dropdb restore_check`.

## Чат агент (n8n)

Браузър → `POST /api/chat` (Next.js: Origin проверка, rate limit, session cookie) → n8n Chat
Trigger (вътрешна мрежа, Basic Auth, streaming) → AI Agent + OpenAI (`gpt-4.1-mini`,
temperature 0.2) + Postgres памет → HTTP Request Tools (`list_services`, `get_free_slots`,
`create_booking`) → `/api/agent/v1/*` (Bearer, идемпотентност) → booking service.

**Настройка — автоматична при всеки deploy:** one-shot услугата `n8n-setup` (образ от
[n8n/Dockerfile](n8n/Dockerfile), скрипт [n8n/setup.mjs](n8n/setup.mjs)) стартира преди n8n,
създава credentials (Agent API Bearer, Chat Basic Auth, Postgres за паметта, OpenAI) от env,
таблицата за паметта и импортира + публикува `n8n/workflows/*.json`. Workflow-ите се
преимпортират само при промяна (хеш в таблица `barber_n8n_setup`); при нов образ compose
рестартира n8n след setup-а (`depends_on … restart: true`), за да регистрира webhook-ите.

Ръчно (локално / за смяна на OpenAI ключа) — същият контейнер + рестарт на n8n:

```bash
OPENAI_API_KEY=sk-... ./scripts/n8n/setup.sh   # без променливата → пита; Enter = запази ключа
# по избор: OPENAI_MODEL=gpt-4.1-mini (по подразбиране)
```

**Промяна на агента:** редактирайте `n8n/prompts/agent-system-prompt.md` или
`scripts/n8n/build-workflows.mjs` → `npm run n8n:build` → `./scripts/n8n/setup.sh`. Не
редактирайте workflow-а само в UI-то на n8n — ще бъде презаписан при следващия setup
(при deploy — само ако workflow-ите в образа са променени; `FORCE_WORKFLOW_IMPORT=1` винаги).
Данните на бръснарницата в промпта (адрес, телефон) се поддържат ръчно в синхрон с
`src/config/site.ts`.

**Тест без OpenAI (мок):**

```bash
docker compose --profile mock up -d mock-openai
OPENAI_API_KEY=mock OPENAI_BASE_URL=http://mock-openai:8080/v1 ./scripts/n8n/setup.sh
SMOKE_MOCK=1 npm run test:smoke
# обратно към истинския OpenAI:
OPENAI_API_KEY=sk-... ./scripts/n8n/setup.sh && docker compose --profile mock stop mock-openai
```

## Тестове и CI

```bash
# еднократно: тестова база (името трябва да завършва на _test — тестовете я изчистват)
docker compose exec postgres createdb -U postgres -O barbershop barbershop_test
npm test                     # unit + интеграционни (TEST_DATABASE_URL)
npm run db:seed && npm run test:e2e   # Playwright срещу работещия стек (вкл. axe a11y и CSP)
SMOKE_MOCK=1 npm run test:smoke       # чатът през n8n (с мока)
```

- **Unit:** изчисляване на свободни часове (вкл. DST), валидация, env, качване на файлове, proxy/CSP.
- **Интеграционни** (истински Postgres): booking service (паралелни записвания → точно едно
  успешно), Agent API (auth, идемпотентност, 409 с алтернативи), админ, `/api/chat`, миграции.
- **E2E:** записване → личен линк → отмяна; админ; чат; достъпност (axe-core, WCAG 2.1 AA) и
  CSP без нарушения на всички основни страници.

[GitHub Actions](.github/workflows/ci.yml): lint, typecheck, Prettier, `drizzle-kit check`,
`drizzle-kit generate` без промени в `drizzle/`, n8n workflow-ите съответстват на генератора,
тестове с Postgres service, `next build`; после production Docker образ (миграции при старт,
повторен старт без миграции) + seed + Playwright.

## Сигурност и лични данни

- Тайните са само в `.env` (не в репото); OpenAI ключът — само криптиран в n8n.
- Postgres не е публикуван навън; app и n8n имат отделни потребители без достъп до чуждата база.
- Админ: argon2id пароли, сесии в базата (в cookie е само случаен токен), rate limit на входа.
- CSP с nonce за всяка заявка, `frame-ancestors 'none'`, HSTS (по избор), `nosniff`, строг
  Referrer-Policy. Външни заявки от браузъра няма, освен картата (OpenStreetMap) след клик.
- CSRF: Server Actions проверяват Origin; `/api/chat` също; Agent API е само с Bearer.
- В логовете няма имена, телефони или съдържание на чата. Успешните изпълнения в n8n не се
  пазят; неуспешните се изтриват след `N8N_EXECUTIONS_MAX_AGE_HOURS`.
- Анонимизиране от админа (по резервация или телефон) изтрива и чат историята; приключилите
  резервации се анонимизират автоматично след `DATA_RETENTION_MONTHS`.

## Преди пускане (чеклист)

- [ ] Заменете placeholder-ите в `src/config/site.ts` (търсете `TODO: замени`) и данните в
      `n8n/prompts/agent-system-prompt.md` → `npm run n8n:build`.
- [ ] Проверете текста на `/privacy` с юрист (администратор на данни, срокове, OpenAI като обработващ).
- [ ] Силни уникални стойности за всички пароли/ключове в `.env`; `chmod 600 .env`.
- [ ] HTTPS работи → `COOKIE_SECURE=true`, `ENABLE_HSTS=true`, `PUBLIC_BASE_URL=https://…`.
- [ ] `COMPOSE_FILE=docker-compose.yml` на сървъра.
- [ ] Сменете паролата на администратора от `/admin/account` и махнете `ADMIN_PASSWORD` от `.env`.
- [ ] Бръснари, снимки, услуги и графици от админа.
- [ ] `./scripts/n8n/setup.sh` с истинския OpenAI ключ; лимит на разходите в OpenAI акаунта.
- [ ] Cron за `./scripts/backup.sh` + копие извън сървъра; пробно възстановяване.

## Отстраняване на проблеми

| Симптом                                     | Причина / решение                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| app се рестартира в цикъл                   | `docker compose logs app`: невалиден `.env` (името на променливата е в грешката) или неуспешна миграция      |
| Входът в админа „не запомня“ сесията        | `COOKIE_SECURE=true` без HTTPS                                                                               |
| Rate limit удря всички потребители наведнъж | Зад proxy без `TRUST_PROXY=true` всички заявки идват от един IP                                              |
| Чатът казва „временно не е достъпен“        | `docker logs barbershop-n8n-setup`, `docker compose logs n8n`; валиден ли е OpenAI ключът / има ли кредит    |
| Линкът към резервацията сочи към localhost  | `PUBLIC_BASE_URL` в `.env`                                                                                   |
| Буквите изглеждат с „руски“ форми (д, л, ж) | Българските форми зависят от шрифта (`lang="bg"` + OpenType `locl`); при нужда сменете шрифта в `layout.tsx` |
