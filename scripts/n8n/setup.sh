#!/usr/bin/env bash
# Настройка на n8n: credentials + импорт и публикуване на workflow-ите.
# Идемпотентно — може да се пуска многократно (обновява credentials и workflow-ите).
#
#   ./scripts/n8n/setup.sh
#
# Чете .env (AGENT_API_KEY, N8N_CHAT_USER, N8N_CHAT_PASSWORD, N8N_DB_USER, N8N_DB_PASSWORD).
# OPENAI_API_KEY НЕ е в .env: подайте го като env за командата или го въведете при поискване:
#   OPENAI_API_KEY=sk-... ./scripts/n8n/setup.sh
# По избор: OPENAI_MODEL (по подразбиране gpt-4.1-mini), OPENAI_BASE_URL (за тестове с мок).
#
# Тайните се подават към контейнера през stdin и временният файл вътре се изтрива веднага;
# нищо не се записва в репото или на диска на хоста.
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -f .env ]]; then
  # Запазваме вече подадени от командния ред стойности с предимство пред .env.
  _openai_key="${OPENAI_API_KEY:-}"; _openai_model="${OPENAI_MODEL:-}"; _openai_url="${OPENAI_BASE_URL:-}"
  set -a; . ./.env; set +a
  OPENAI_API_KEY="${_openai_key:-${OPENAI_API_KEY:-}}"
  OPENAI_MODEL="${_openai_model:-${OPENAI_MODEL:-}}"
  OPENAI_BASE_URL="${_openai_url:-${OPENAI_BASE_URL:-}}"
fi

: "${AGENT_API_KEY:?липсва AGENT_API_KEY в .env}"
: "${N8N_CHAT_USER:?липсва N8N_CHAT_USER в .env}"
: "${N8N_CHAT_PASSWORD:?липсва N8N_CHAT_PASSWORD в .env}"
N8N_DB_USER="${N8N_DB_USER:-n8n}"
: "${N8N_DB_PASSWORD:?липсва N8N_DB_PASSWORD в .env}"
OPENAI_MODEL="${OPENAI_MODEL:-gpt-4.1-mini}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  read -r -s -p "OpenAI API ключ (няма да се покаже и няма да се запише): " OPENAI_API_KEY
  echo
fi
: "${OPENAI_API_KEY:?нужен е OpenAI API ключ}"
export OPENAI_API_KEY OPENAI_MODEL OPENAI_BASE_URL AGENT_API_KEY N8N_CHAT_USER N8N_CHAT_PASSWORD N8N_DB_USER N8N_DB_PASSWORD

log() { echo "[n8n-setup] $*"; }
dc() { docker compose "$@"; }

log "проверявам, че n8n и postgres работят…"
dc up -d --wait postgres n8n >/dev/null 2>&1

log "workflow файловете са актуални спрямо промпта…"
node scripts/n8n/build-workflows.mjs --check

log "таблица за паметта на чата (в базата n8n)…"
dc exec -T -e PGPASSWORD="$N8N_DB_PASSWORD" postgres \
  psql -q -h 127.0.0.1 -U "$N8N_DB_USER" -d n8n -v ON_ERROR_STOP=1 -c \
  "CREATE TABLE IF NOT EXISTS n8n_chat_histories (id SERIAL PRIMARY KEY, session_id VARCHAR(255) NOT NULL, message JSONB NOT NULL);
   CREATE INDEX IF NOT EXISTS n8n_chat_histories_session_idx ON n8n_chat_histories (session_id);"

# Подава stdin към файл в контейнера, изпълнява командата и трие файла.
import_stdin() {
  local file="$1"; shift
  dc exec -T n8n sh -c "umask 077; cat > '$file'; n8n $* --input='$file'; rc=\$?; rm -f '$file'; exit \$rc"
}

log "credentials (OpenAI, Agent API, Chat Basic Auth, Postgres)…"
node --input-type=module -e '
const e = process.env;
const creds = [
  { id: "BarberOpenAi0001", name: "Barber · OpenAI", type: "openAiApi",
    data: { apiKey: e.OPENAI_API_KEY, url: e.OPENAI_BASE_URL } },
  { id: "BarberAgentApi01", name: "Barber · Agent API (Bearer)", type: "httpHeaderAuth",
    data: { name: "Authorization", value: `Bearer ${e.AGENT_API_KEY}` } },
  { id: "BarberChatAuth01", name: "Barber · Chat Basic Auth", type: "httpBasicAuth",
    data: { user: e.N8N_CHAT_USER, password: e.N8N_CHAT_PASSWORD } },
  { id: "BarberN8nPg00001", name: "Barber · n8n DB (chat memory)", type: "postgres",
    data: { host: "postgres", port: 5432, database: "n8n", user: e.N8N_DB_USER, password: e.N8N_DB_PASSWORD, ssl: "disable", allowUnauthorizedCerts: false } },
];
process.stdout.write(JSON.stringify(creds));
' | import_stdin /tmp/barber-credentials.json import:credentials >/dev/null
log "  ✓ credentials са импортирани (криптирани с N8N_ENCRYPTION_KEY)"

log "workflow-и (модел: $OPENAI_MODEL)…"
node --input-type=module -e '
import { readFileSync } from "node:fs";
const wfs = ["n8n/workflows/booking-agent.json", "n8n/workflows/chat-purge.json"].map((f) => JSON.parse(readFileSync(f, "utf8")));
for (const n of wfs[0].nodes) if (n.type === "@n8n/n8n-nodes-langchain.lmChatOpenAi") n.parameters.model.value = process.env.OPENAI_MODEL;
process.stdout.write(JSON.stringify(wfs));
' | import_stdin /tmp/barber-workflows.json import:workflow >/dev/null

for id in BarberAgent00001 BarberPurge00001; do
  dc exec -T n8n n8n publish:workflow --id="$id" >/dev/null
done
log "  ✓ импортирани и публикувани: booking agent, chat purge"

log "рестарт на n8n, за да регистрира webhook-ите…"
dc restart n8n >/dev/null 2>&1
dc up -d --wait n8n >/dev/null 2>&1

log "проверка: Chat Trigger отговаря и изисква Basic Auth…"
code=$(dc exec -T app node -e "fetch('http://n8n:5678/webhook/booking-agent/chat',{method:'POST'}).then(r=>console.log(r.status)).catch(()=>console.log('ERR'))" | tr -d '\r')
if [[ "$code" == "401" || "$code" == "403" ]]; then
  log "  ✓ без парола → $code (защитен)"
else
  log "  ⚠ неочакван отговор без парола: $code"
fi
log "готово. N8N_CHAT_URL=http://n8n:5678/webhook/booking-agent/chat"
log "         N8N_CHAT_PURGE_URL=http://n8n:5678/webhook/chat-purge"
