#!/usr/bin/env node
/**
 * One-shot настройка на n8n (compose услугата `n8n-setup`, преди n8n да стартира):
 *   1. таблица за паметта на чата (в базата n8n);
 *   2. credentials (OpenAI, Agent API Bearer, Chat Basic Auth, Postgres);
 *   3. импорт + публикуване на workflow-ите от /opt/barber-n8n/workflows.
 * Идемпотентно — пуска се при всеки deploy. Workflow-ите се преимпортират само при
 * промяна (хеш в таблица barber_n8n_setup): импорт при работещ n8n разрегистрира
 * webhook-ите до рестарт, а compose рестартира n8n само при нов образ/конфигурация.
 *
 * OPENAI_API_KEY е по избор: без него съществуващият OpenAI credential се запазва
 * (въведен веднъж през редактора), а ако няма такъв — създава се празен за попълване.
 *
 * Тайните отиват във временен файл (0600) в контейнера, който се трие веднага.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire("/usr/local/lib/node_modules/n8n/package.json");
const { Client } = require("pg");

const WORKFLOWS_DIR = process.env.BARBER_WORKFLOWS_DIR ?? "/opt/barber-n8n/workflows";
const WORKFLOW_IDS = ["BarberAgent00001", "BarberPurge00001"];
const OPENAI_CRED_ID = "BarberOpenAi0001";

const e = process.env;
const log = (msg) => console.log(`[n8n-setup] ${msg}`);

const missing = ["AGENT_API_KEY", "N8N_CHAT_USER", "N8N_CHAT_PASSWORD"].filter((k) => !e[k]);
if (missing.length) {
  log(`⚠ пропускам: липсва ${missing.join(", ")} → чатът остава изключен`);
  process.exit(0);
}
for (const k of ["DB_POSTGRESDB_USER", "DB_POSTGRESDB_PASSWORD", "N8N_ENCRYPTION_KEY"]) {
  if (!e[k]) throw new Error(`липсва ${k}`);
}

const model = e.OPENAI_MODEL || "gpt-4.1-mini";
const baseUrl = e.OPENAI_BASE_URL || "https://api.openai.com/v1";
const tmp = mkdtempSync("/tmp/barber-n8n-");

/** n8n CLI с JSON вход през временен файл (0600), който се трие веднага. */
function n8nImport(command, data) {
  const file = path.join(tmp, `${command}.json`);
  writeFileSync(file, JSON.stringify(data), { mode: 0o600 });
  try {
    n8n(command, `--input=${file}`);
  } finally {
    rmSync(file, { force: true });
  }
}

function n8n(...args) {
  // stdout на n8n е шумен; грешките (stderr) остават видими в логовете.
  execFileSync("n8n", args, { stdio: ["ignore", "ignore", "inherit"] });
}

const db = new Client({
  host: e.DB_POSTGRESDB_HOST || "postgres",
  port: Number(e.DB_POSTGRESDB_PORT || 5432),
  database: e.DB_POSTGRESDB_DATABASE || "n8n",
  user: e.DB_POSTGRESDB_USER,
  password: e.DB_POSTGRESDB_PASSWORD,
});

try {
  // Миграциите на n8n (вкл. на празна база) минават при първата CLI команда.
  log("таблица за паметта на чата…");
  await db.connect();
  await db.query(`CREATE TABLE IF NOT EXISTS n8n_chat_histories (
    id SERIAL PRIMARY KEY, session_id VARCHAR(255) NOT NULL, message JSONB NOT NULL)`);
  await db.query(
    "CREATE INDEX IF NOT EXISTS n8n_chat_histories_session_idx ON n8n_chat_histories (session_id)",
  );

  log("credentials…");
  const creds = [
    {
      id: "BarberAgentApi01",
      name: "Barber · Agent API (Bearer)",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: `Bearer ${e.AGENT_API_KEY}` },
    },
    {
      id: "BarberChatAuth01",
      name: "Barber · Chat Basic Auth",
      type: "httpBasicAuth",
      data: { user: e.N8N_CHAT_USER, password: e.N8N_CHAT_PASSWORD },
    },
    {
      id: "BarberN8nPg00001",
      name: "Barber · n8n DB (chat memory)",
      type: "postgres",
      data: {
        host: e.DB_POSTGRESDB_HOST || "postgres",
        port: Number(e.DB_POSTGRESDB_PORT || 5432),
        database: e.DB_POSTGRESDB_DATABASE || "n8n",
        user: e.DB_POSTGRESDB_USER,
        password: e.DB_POSTGRESDB_PASSWORD,
        ssl: "disable",
        allowUnauthorizedCerts: false,
      },
    },
  ];
  const openAi = { id: OPENAI_CRED_ID, name: "Barber · OpenAI", type: "openAiApi" };
  // Таблицата съществува след първия импорт (миграциите) — проверяваме след него.
  n8nImport("import:credentials", creds);
  const { rowCount: hasOpenAi } = await db.query("SELECT 1 FROM credentials_entity WHERE id = $1", [
    OPENAI_CRED_ID,
  ]);
  if (e.OPENAI_API_KEY) {
    n8nImport("import:credentials", [
      { ...openAi, data: { apiKey: e.OPENAI_API_KEY, url: baseUrl } },
    ]);
    log("  ✓ OpenAI ключът е обновен от OPENAI_API_KEY");
  } else if (!hasOpenAi) {
    n8nImport("import:credentials", [{ ...openAi, data: { apiKey: "", url: baseUrl } }]);
    log("  ⚠ няма OPENAI_API_KEY: въведете ключа в редактора → Credentials → „Barber · OpenAI“");
  } else {
    log("  ✓ OpenAI credential-ът се запазва (OPENAI_API_KEY не е зададен)");
  }

  log(`workflow-и (модел: ${model})…`);
  const workflows = ["booking-agent.json", "chat-purge.json"].map((f) =>
    JSON.parse(readFileSync(path.join(WORKFLOWS_DIR, f), "utf8")),
  );
  for (const n of workflows[0].nodes) {
    if (n.type === "@n8n/n8n-nodes-langchain.lmChatOpenAi") n.parameters.model.value = model;
  }
  const hash = createHash("sha256").update(JSON.stringify(workflows)).digest("hex");
  await db.query(
    "CREATE TABLE IF NOT EXISTS barber_n8n_setup (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  const { rows } = await db.query("SELECT value FROM barber_n8n_setup WHERE key = 'workflows'");
  if (rows[0]?.value === hash && !e.FORCE_WORKFLOW_IMPORT) {
    log("  ✓ без промени (FORCE_WORKFLOW_IMPORT=1 за принудителен импорт)");
  } else {
    n8nImport("import:workflow", workflows);
    for (const id of WORKFLOW_IDS) n8n("publish:workflow", `--id=${id}`);
    await db.query(
      `INSERT INTO barber_n8n_setup (key, value) VALUES ('workflows', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [hash],
    );
    log("  ✓ импортирани и публикувани: booking agent, chat purge");
  }
} finally {
  await db.end().catch(() => {});
  rmSync(tmp, { recursive: true, force: true });
}
