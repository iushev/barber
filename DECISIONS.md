# Архитектурни решения

Кратък дневник на решенията и отклоненията от спецификацията (`docs/prompt.md`).

## Етап 1

### Версии

- Next.js 16.4, React 19.3, Drizzle ORM 0.45 / drizzle-kit 0.31, pg 8.23, Zod 4, Tailwind 4.
- **TypeScript 6.0** (не 7.0): npm избира 6.x заради peer зависимостите на
  `eslint-config-next`/`typescript-eslint`. Ще мигрираме, когато екосистемата поддържа 7.
- **ESLint 9** по същата причина (peer на `eslint-config-next`).
- Образи: `postgres:18.6-alpine`, `docker.n8n.io/n8nio/n8n:2.47.3` (stable към 2026-11-10), `node:24-alpine`.

### Мрежи в Docker Compose (отклонение)

Спецификацията иска n8n да е само в `internal`. Това е невъзможно на практика:

1. n8n трябва да вика OpenAI API → нужен е изход към интернет; `internal: true` мрежа няма такъв.
2. Docker не публикува портове (дори `127.0.0.1:5678`) от `internal: true` мрежа.

Решение: `internal` (`internal: true`) за app ↔ postgres ↔ n8n; `public` само за порта на app;
`egress` само за n8n (изходящ трафик + loopback порт на редактора). Postgres е **само** в
`internal` в production. n8n няма порт, достъпен от интернет; Chat Trigger webhook-ът
се вика от app по `http://n8n:5678/...` във вътрешната мрежа.
В dev override Postgres е и в `egress`, за да се публикува на `127.0.0.1:5432`.

### Postgres

- Volume на `/var/lib/postgresql` (изискване на образите 18+).
- Init скриптът `configs.postgres-init` в `docker-compose.yml` създава `barbershop` (собственик: app
  потребителят → може да създаде trusted разширението `btree_gist`) и `n8n` (собственик: n8n
  потребителят) и маха `CONNECT` от `PUBLIC` → всеки потребител влиза само в своята база
  (проверено: `User does not have CONNECT privilege`).
- Healthcheck-ът ползва `-h 127.0.0.1`, за да не минава по време на init (временният сървър
  слуша само на unix socket).

### Миграции

- Exclusion constraint `bookings_no_overlap`:
  `EXCLUDE USING gist (barber_id WITH =, tstzrange(start_at, end_at, '[)') WITH &&) WHERE (status <> 'cancelled')`.
  „Активни“ = всичко освен `cancelled` (вкл. `completed`, `no_show` — те също са заели времето).
  Полуотвореният интервал `[)` позволява съседни часове.
- `scripts/migrate.ts` → esbuild → `migrate.mjs` (вградени drizzle-orm и pg). Advisory lock на
  отделна сесия; лог на приложените миграции чрез сравнение на `drizzle.__drizzle_migrations`
  преди/след и `meta/_journal.json`.
- Сурови SQL заявки извън миграциите: само в `scripts/migrate.ts` (advisory lock, четене на
  таблицата на Drizzle) и `TRUNCATE` в seed-а. Нищо в приложния код.

### Пароли

argon2id чрез вградения `node:crypto.argon2` (Node ≥ 24.7) — няма native модули, които да
се копират в standalone образа; параметри по OWASP (m=19 MiB, t=2, p=1).

### Конфигурация

- `src/config/env.ts` валидира env със Zod **мързеливо** (при първа употреба), за да не
  изисква runtime тайни по време на `next build`.
- `app` в compose използва `${VAR:?}` за задължителните променливи → compose отказва да
  стартира без тях.
- В production на сървъра: `COMPOSE_FILE=docker-compose.yml` в `.env`, за да не се зарежда
  dev override-ът при `docker compose up -d`.

### Тестова база

Интеграционните тестове ползват отделна база `*_test` (проверка по име), собственост на app
потребителя; helper-ът изтрива и пресъздава схемите вместо базата → не са нужни права CREATEDB.

### Модел на данни (уточнения)

- Цените са в цели центове (`price_cents`); API-то ги връща като число с два знака.
- `working_hours.weekday`: ISO (1 = понеделник … 7 = неделя), по един ред на ден.
- `schedule_exceptions`: `off` (почивен ден) или `custom` (друго работно време за датата).
- Токенът от `/booking/<token>` не се пази; в БД е само SHA-256 хешът му.
- Rate limit броячите са в Postgres (`rate_limits`) → работят и при няколко app контейнера, без Redis.

## Етап 2 — Booking service

- `src/server/booking/service.ts` → `createBookingService({ db, rules, now })`: зависимостите се
  инжектират (тестовете подават тестова база и фиксирано „сега“); `bookingService()` в
  `src/server/booking/index.ts` е споделената инстанция с правила от env.
- Изчисляването на слотове е чиста функция (`src/server/slots/compute.ts`), без БД.
  Кандидатите са на мрежа през `SLOT_STEP_MIN` от началото на работния ден. Моментите се
  изчисляват от стенно време чрез `zonedToUtc` (DST-безопасно; тест за 29.03 и 25.10).
- **Защита от двойно записване — два слоя:** (1) транзакция: `SELECT … FOR UPDATE` на реда на
  бръснаря сериализира записванията за него → проверка, че `start` е точно един от свободните
  слотове → INSERT; (2) exclusion constraint в БД. Грешка `23P01` от БД също се превръща в
  `slot_taken` с алтернативи — например при връщане на отменена резервация в „потвърдена“.
- `slot_taken` (409) съдържа до 3 свободни часа, най-близки до поискания: от същия и до 6
  следващи дни, подредени хронологично.
- Различаваме `invalid_slot` (часът никога не е бил слот: извън графика, в почивката, извън
  мрежата) от `slot_taken` (слотът съществува, но е зает).
- Лимит на активни бъдещи резервации на телефон: брои се в транзакцията под
  `pg_advisory_xact_lock(hashtextextended('phone:…'))` → точен и при паралелни заявки. Това е
  мястото, където Drizzle не стига (няма API за advisory locks): параметризиран `sql```.
- **Rate limit:** по клиент (`BOOKING_RATE_LIMIT_PER_CLIENT_HOUR`) и по телефон
  (`BOOKING_RATE_LIMIT_PER_PHONE_DAY`). Броят се _опитите_, включително невалидните, за да няма
  изброяване на свободни часове или телефони. За формата клиентът е IP; за чата е chat
  sessionId, защото всички заявки от n8n идват от един вътрешен IP. Rate limit по IP за чата
  се прилага в `/api/chat`. Администраторът не се ограничава.
- Администраторът (`source: admin`) може да записва и в миналото/извън хоризонта и без
  минимално време напред, но само в рамките на графика и без застъпване.
- Отмяна от клиента: само `confirmed` и поне `CANCEL_CUTOFF_HOURS` преди часа (`cancel_too_late`).
- Телефони: `libphonenumber-js` (метаданни `min`), регион по подразбиране BG; „00“ в началото
  се приема като „+“; съхраняват се в E.164.

## Етап 3 — Agent API

- Route-овете (`src/app/api/agent/v1/*/route.ts`) само преизнасят handler-и от
  `src/server/agent/handlers.ts`; логиката е в booking service.
- **Автентикация:** `Authorization: Bearer <AGENT_API_KEY>`; сравнение с `timingSafeEqual` върху
  SHA-256 на двете стойности (без изтичане на дължината). Без зададен ключ → всичко е 401 + едно
  предупреждение в лога. Неуспешните опити се лимитират по IP (20/мин → 429); успешните — общо
  `AGENT_API_RATE_LIMIT_PER_MIN`. Ключът и телата на заявките не се логват.
- **Формат на грешките:** `{ "error": { "code", "message", ...extra } }`. При `slot_taken` (409)
  алтернативите са в `error.alternatives`; при валидационни грешки (422) имената на полетата са
  в `error.fields`. При 429 има `Retry-After`.
- **Идемпотентност** (`src/server/agent/idempotency.ts`): ключът се резервира атомарно с
  `INSERT … ON CONFLICT DO NOTHING`. Паралелна заявка със същия ключ изчаква до ~5 s резултата
  на първата. Пази се само успешният 201; при грешка редът се трие и ключът може да се
  използва отново. Същият ключ с друго тяло → 422 `idempotency_key_reused`. Ако резервацията
  от записания отговор е отменена, ключът се счита за остарял и заявката се изпълнява наново.
  Повторението връща хедър `Idempotent-Replayed: true`.
  Формат на ключа: 8–200 видими ASCII символа (позволява `sessionId:2026-11-12T10:00:00+02:00`).
- Записаният отговор съдържа `manageUrl` с тайния токен, защото токенът не може да се
  възстанови от хеша. Затова записите изтичат след `IDEMPOTENCY_TTL_HOURS` (по подразбиране 24 ч).
- **Chat сесия:** n8n подава незадължителен хедър `X-Chat-Session-Id`. Той се пази в
  `bookings.chat_session_id` (за изтриване на чат историята при анонимизиране) и е ключът за
  rate limit по клиент за чата.
- **X-Forwarded-For без reverse proxy (сигурност):** Next.js задава `x-forwarded-for` от сокета
  само ако хедърът липсва, т.е. клиентът може да го подправи и да заобиколи лимитите по IP.
  `docker/forwarded-headers.mjs` се зарежда с `node --import` преди `server.js`
  (`exec node --import ./forwarded-headers.mjs server.js`). При `TRUST_PROXY=false` той изтрива
  клиентските `X-Forwarded-*`, `Forwarded` и `X-Real-IP` и задава адреса на сокета; при
  `TRUST_PROXY=true` добавя адреса на проксито към веригата. Проверено в контейнера: 22 заявки
  с различен фалшив IP → след 20-ата е 429. В dev режим (`next dev`) не е активен.

## Етап 4 — Админ панел

- **Структура:** `/admin/login` е извън групата `(panel)`. Layout-ът на `(panel)` вика
  `requireAdmin()` (валидира сесията в БД) за всяка страница. Всеки Server Action също вика
  `requireAdmin()` сам, защото actions са публични POST endpoint-и и не минават през layout-а.
  `src/proxy.ts` (в Next 16 е заместил `middleware.ts`) прави само бърза проверка за наличие на
  cookie: пренасочва към входа, а за `/api/admin/*` връща 401. Това е оптимизация, не защита.
  Всички мутации са Server Actions, затова отделни `/api/admin` route-ове не са нужни. Ако
  се добавят, трябва да викат `getCurrentAdmin()`.
- **Сесии:** 32 случайни байта в cookie (`httpOnly`, `SameSite=Lax`, `Secure` = `COOKIE_SECURE`;
  при Secure името е с префикс `__Host-`); в БД е SHA-256 хешът; TTL 12 ч. Смяната на паролата
  инвалидира всички сесии.
- **Brute force:** 10 опита/15 мин на IP и 5 опита/15 мин на имейл (rate limit в Postgres). При
  несъществуващ имейл паролата се сравнява с фиктивен argon2 хеш → еднакво време и еднакво
  съобщение.
- **CSRF:** вградената проверка на Next.js за Server Actions (Origin ↔ Host) + `SameSite=Lax`.
  `docker/forwarded-headers.mjs` маха подправените `X-Forwarded-Host` от клиента, така че Host
  проверката не може да се заобиколи. При външен TLS терминатор, който сменя Host, задай
  `TRUST_PROXY=true`.
- **UI:** Server Components + Server Actions; единственият клиентски код е `ActionForm`
  (`useActionState`) за съобщенията за успех/грешка. Формите за филтри/избор на дата са
  обикновени GET форми (работят без JavaScript).
- **Деактивиране** на бръснар/услуга (soft delete) с бъдещи резервации показва списък на
  засегнатите и изисква отметка „разбирам“. Резервациите **не** се отменят автоматично —
  администраторът се свързва с клиентите и мести/отменя ръчно. Неактивните не приемат нови
  записвания (проверка в booking service).
- **Ръчна резервация и преместване** (`getAdminSlots`): само слотове по графика, без застъпване,
  но без минимално време напред/хоризонт/лимити. Админът не може да види линка за управление
  на клиента — пазим само хеша на токена.
- **GDPR:** „Анонимизирай“ (само резервацията или всички с този телефон) заменя името с
  „Анонимизиран клиент“ и телефона с празен низ, изтрива кешираните Agent API отговори
  (`idempotency_keys`, съдържат име/телефон/линк) и иска от n8n да изтрие чат историята на
  свързаните `chat_session_id`. „Изтрий“ премахва резервацията окончателно. Анонимизираните
  резервации остават в графика и статистиката.
- **Чат история в n8n:** приложението няма достъп до базата `n8n` (изолация на потребителите).
  Изтриването минава през служебен webhook в n8n (`N8N_CHAT_PURGE_URL`, етап 6) със същия Basic
  Auth. Ако не е настроен или n8n не отговори, админът вижда изрично предупреждение — анонимизирането
  в нашата база не се отменя.
- **Снимки:** Server Action с лимит 3 MB (`experimental.serverActions.bodySizeLimit`), сървърна
  проверка до 2 MB, типът по magic bytes (JPEG/PNG/WebP; SVG е забранен заради XSS), име UUID,
  запис във volume `uploads`. Сервират се от `/uploads/[...path]` със строг regex на пътя,
  `nosniff`, `CSP: default-src 'none'; sandbox` и дълго кеширане.

## Етап 5 — Публичен сайт

- **Съдържание:** текстовете, адресът и контактите са в `src/config/site.ts` (placeholder-и,
  маркирани `TODO: замени`). Услугите, цените и екипът идват от БД, а работното време на
  бръснарницата се изчислява от графиците на активните бръснари (най-ранно начало и най-късен
  край за всеки ден), за да е винаги в синхрон със записването.
- **Рендер:** страниците четат БД при всяка заявка (`force-dynamic`). Промените от админа се
  виждат веднага и `next build` не изисква база. LCP елементът е текстовото заглавие: херото
  няма изображение, шрифтовете са self-hosted чрез `next/font` с `display: swap`.
- **Дизайн:** тъмна палитра (ink/coal) с месинг и кървавочервено; Oswald (condensed, за заглавия)
  - Manrope (текст), и двата с кирилица. Ценоразписът е като меню с точки. Placeholder-ите за
    снимки са надписани „Снимка — замени: …“.
- **Карта:** OpenStreetMap iframe, зареждан **само след клик** — без заявки към трети страни при
  отваряне и без влияние върху LCP (поверителност + производителност); плюс линк към Google Maps.
- **JSON-LD:** `HairSalon` с адрес, координати, работно време, `OfferCatalog` с цените и
  `ReserveAction`; `<` се екранира (защита от XSS през съдържание от БД).
- **Форма `/book`** (клиентски компонент, 6 стъпки):
  - свободните дати идват от `GET /api/public/availability` (3 заявки към БД за целия хоризонт),
    а часовете от `GET /api/public/slots`; и двата са с rate limit 120/мин на IP;
  - данните се зареждат от event handler-ите (не от `useEffect`), със защита от закъснели
    отговори;
  - валидацията на име/телефон ползва същите Zod схеми като сървъра;
  - записването е Server Action, който валидира повторно (вкл. съгласие и honeypot) и пренасочва
    към `/booking/<token>?new=1`;
  - при `slot_taken` се показват алтернативите като бутони;
  - фокусът се мести към заглавието на всяка стъпка; прогресът е `aria-current="step"`.
  - Формата изисква JavaScript. Без JS остава телефонът, а чат асистентът (етап 6) също е JS.
- **`/booking/<token>`:** `noindex` и `Referrer-Policy: no-referrer` (токенът е в URL-а), линк
  за копиране и изрично обяснение, че линкът трябва да се запази (няма имейл/SMS). Отмяната е в
  две стъпки и само до `CANCEL_CUTOFF_HOURS` преди часа. След това се показва телефонът.
- **Срок за съхранение:** политиката обещава анонимизиране след `DATA_RETENTION_MONTHS`
  (по подразбиране 24), затова то е реализирано. При отваряне на админ панела, най-много веднъж
  на час, се анонимизират резервациите, приключили преди срока, и се чисти чат историята им в
  n8n. Не е нужен отделен cron.
- **Env:** празните стойности (`${VAR:-}` в compose) се третират като незададени. Иначе
  незадължителен URL с празна стойност спираше приложението.

## Етап 6 — n8n агент и чат

### Проверено в n8n 2.47.3 (кода в контейнера и реални заявки)

- **Chat Trigger** (`@n8n/n8n-nodes-langchain.chatTrigger` v1.5), `public: true`, `mode: webhook`,
  `authentication: basicAuth`, фиксиран `webhookId: booking-agent` → URL
  `http://n8n:5678/webhook/booking-agent/chat`. Без Basic Auth → **401**.
- **Заявка:** `POST` JSON `{ "action": "sendMessage", "sessionId": "...", "chatInput": "..." }`.
  Тялото става изходът на тригера (`$json.sessionId`, `$json.chatInput`).
- **Стрийминг: поддържа се** (`options.responseMode: "streaming"`). Отговорът е `200`,
  `Content-Type: application/json; charset=utf-8`, `Transfer-Encoding: chunked`, по един JSON
  обект на ред (NDJSON): `{"type":"begin"|"item"|"end"|"error","content"?:string,"metadata":{nodeName,…}}`.
  Текстът е в `content` на `item`. При всяка итерация на агента има отделна двойка `begin`/`end`
  (итерациите с инструменти са без `item`).
- Без стрийминг (`responseMode: lastNode`) отговорът е `{ "output": "..." }`; `/api/chat` поддържа и двата.
- **Възли:** AI Agent `agent` v3.1 (`promptType: auto`, `options.systemMessage`, `maxIterations: 8`,
  `enableStreaming: true`); `lmChatOpenAi` v1.3; `memoryPostgresChat` v1.4
  (`contextWindowLength: 8`); 3 × `n8n-nodes-base.httpRequestTool` v4.2 с `$fromAI()` параметри.
- **OpenAI:** `lmChatOpenAi` v1.3 по подразбиране ползва Responses API и `gpt-5-mini` (reasoning
  модел, без `temperature`). Избрахме `responsesApiEnabled: false` (Chat Completions — работи и с
  OpenAI-съвместими endpoint-и и мока) и `gpt-4.1-mini` с `temperature: 0.2`, `maxTokens: 700`.
  Моделът е параметър: `OPENAI_MODEL` при `scripts/n8n/setup.sh`.
- **Имена на инструментите на латиница** (`list_services`, `get_free_slots`, `create_booking`):
  n8n прави името на инструмента от името на възела с `/[^a-zA-Z0-9_-]+/ → "_"`, т.е. кирилица
  би станала „_“. Описанията (които моделът чете) са на български.
- **Отговори към агента:** `neverError: true` → 4xx телата (`error.message`, `alternatives`)
  стигат до модела вместо обща грешка; `optimizeResponse` с избрани полета (`services`,
  `slots`, `booking`, `error`).
- **Idempotency-Key** = `<sessionId>:<start>` (по спецификацията): израз с
  `$('When chat message received').first().json.sessionId` и `$fromAI('start')`; същият
  sessionId се подава и в `X-Chat-Session-Id`. Проверено: резервацията получава
  `source=chat` и `chat_session_id`.
- **Памет:** Postgres Chat Memory v1.4 пази сесията като `<sessionId>__<име на възела>`
  („scoped“). Служебният purge workflow трие и точното съвпадение, и scoped вариантите.
  Таблицата `n8n_chat_histories` се създава от setup скрипта (в базата `n8n`).
- **Purge workflow** (`chat-purge`, Webhook + Postgres, Basic Auth): n8n Postgres
  `queryReplacement` разделя стойността по запетаи на отделни параметри, затова ID-тата се
  съединяват с `|` (позволени са само `[A-Za-z0-9_-]`).

### Лични данни в n8n

- `saveDataSuccessExecution: none` + `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none`. Открихме, че
  n8n 2.x само **меко** трие незапазените изпълнения, а `startData` съдържа съобщението (с
  телефона). Окончателното изтриване идва след `EXECUTIONS_DATA_HARD_DELETE_BUFFER` (1 ч) +
  интервал (15 мин) → зададени `0` и `5` мин. Грешните изпълнения се пазят 24 ч за диагностика.
- `autoSaveHighlightedData: false` на тригера и агента → съобщенията не се копират в метаданните.

### Credentials и импорт (`scripts/n8n/setup.sh`)

- Credentials с фиксирани ID-та (OpenAI, Header Auth `Authorization: Bearer …`, Basic Auth,
  Postgres към базата `n8n`) се генерират от `.env` + `OPENAI_API_KEY` и се подават през stdin на
  `n8n import:credentials` (некриптираните `data` n8n криптира при импорт с `N8N_ENCRYPTION_KEY`);
  временният файл в контейнера се трие веднага. Ключът на OpenAI не е в `.env`/compose.
- Workflow-ите се генерират от `scripts/n8n/build-workflows.mjs` (системният промпт се чете от
  `n8n/prompts/agent-system-prompt.md` → двете копия не могат да се разминат;
  `npm run n8n:build -- --check` за CI), импортират се, публикуват се (`n8n publish:workflow`) и
  n8n се рестартира. Скриптът е идемпотентен.
- Адресът и телефонът в промпта дублират `src/config/site.ts` (агентът няма отделен
  endpoint за тях) — при смяна обновете и двете и пуснете `npm run n8n:build` + setup.

### `/api/chat` и widget

- Браузърът говори само с `/api/chat`. Проверки: Origin (CSRF), `Content-Type: application/json`,
  Zod (1–1000 символа), rate limit по IP (10/мин, 150/ден) и по сесия (60/ден), таймаут 90 s,
  прекъсване при затваряне от клиента. Към браузъра: собствен NDJSON (`delta`/`done`/`error`).
  Вътрешните грешки от n8n не изтичат.
- `sessionId`: 24 случайни байта, cookie `barber_chat` (`HttpOnly`, `SameSite=Lax`, `Secure` по
  env, `Path=/api/chat` → не се праща към други адреси), 24 ч. „Нов разговор“ (`DELETE /api/chat`)
  изтрива историята в n8n и cookie-то.
- Widget: собствен компонент, `role="dialog"`/`role="log"`, Escape затваря и връща фокуса,
  индикатор „пише…“ до първия фрагмент. Историята е в `sessionStorage` (на таба). **Линкове само
  към нашия домейн:** чужди URL-и от отговора на модела (напр. при prompt injection) остават текст.

### Тестове

- `tests/support/mock-openai.mjs` — детерминиран мок на Chat Completions (вкл. SSE стрийм и tool
  calls), compose профил `mock`. С него е проверен целият път: app → n8n → инструменти →
  Agent API → резервация → памет → purge.
- `npm run test:smoke` (с `SMOKE_MOCK=1` за пълния сценарий) и e2e `tests/e2e/chat.spec.ts` се
  пропускат, ако чатът не е настроен.

## Етап 7 — Полиране

### Content-Security-Policy

- CSP с nonce, генериран за всяка заявка в `src/proxy.ts`; Next.js го чете от заглавката на
  заявката и го слага на своите скриптове. `script-src 'self' 'nonce-…' 'strict-dynamic'`
  (без `'unsafe-inline'`); `'unsafe-eval'` само в dev (React Refresh).
- `style-src 'unsafe-inline'` е оставен съзнателно: `next/image` и `next/font` слагат inline
  стилове; рискът от инжектиран CSS е много по-нисък от този на скриптове.
- Nonce изисква динамично рендериране. Всички страници и без това са динамични (данни от
  базата); глобалната 404 (`src/app/not-found.tsx`) вика `connection()` по същата причина.
- `frame-src https://www.openstreetmap.org` само за картата (зарежда се след клик);
  `frame-ancestors 'none'` дублира `X-Frame-Options: DENY`.
- JSON-LD (`application/ld+json`) не е изпълним скрипт и не се блокира от CSP.

### SEO

- `robots.txt` и `sitemap.xml` са динамични (`PUBLIC_BASE_URL` идва от env при старт, не при
  build). `/booking/`, `/admin`, `/api/` са забранени за индексиране; админът има и
  `X-Robots-Tag: noindex`.
- OG изображението (`src/app/opengraph-image.tsx`) се генерира при build. Шрифтът по
  подразбиране на `next/og` няма кирилица → Oswald (woff) от `@fontsource/oswald` (dev
  зависимост, нужна само при build). Две отделни фамилии (кирилица/латиница), защото при
  едно и също име satori ползва само първия файл.

### Достъпност

- axe-core (WCAG 2.1 A/AA) в Playwright на всички публични страници, чат прозореца и
  страниците на админа. Поправено: контраст на вторичния текст (`text-bone/40|50` → `/60`,
  ≥ 4.5:1 върху тъмния фон), подчертани линкове в текст, видимият текст на „Запази час при …“
  се съдържа в достъпното име.

### Производителност

- Всички страници са динамични, но леки: шрифтовете са self-hosted (`next/font`), картата
  се зарежда при клик, JS на началната страница е само framework + малки клиентски компоненти
  (формата за записване с libphonenumber/zod се зарежда само на `/book`).

### CI и backup

- CI: lint, typecheck, Prettier, `drizzle-kit check`, `drizzle-kit generate` + проверка, че
  `drizzle/` не се променя, `n8n:build --check`, тестове с Postgres service, build; втори
  job строи production образа, стартира го (миграции), рестартира (без нови миграции),
  seed + Playwright. n8n/OpenAI не се пускат в CI — чат e2e/smoke тестовете се пропускат.
- `scripts/backup.sh`: `pg_dump -Fc` на двете бази + роли + tar на volume-ите `uploads` и
  `n8n_data` (през `docker compose exec`, без да се гадае името на volume-а), проверка с
  `pg_restore --list`, ротация по дни. Възстановяването е проверено върху временна база.
