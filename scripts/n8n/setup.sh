#!/usr/bin/env bash
# Ръчна настройка на n8n от клонирано репо (локално или на сървър с git clone).
# Пуска същия one-shot контейнер `n8n-setup`, който compose стартира при всеки deploy
# (n8n/setup.mjs): credentials + импорт и публикуване на workflow-ите. Идемпотентно.
#
#   ./scripts/n8n/setup.sh
#
# Чете .env (AGENT_API_KEY, N8N_CHAT_USER, N8N_CHAT_PASSWORD, N8N_DB_*, N8N_ENCRYPTION_KEY).
# OPENAI_API_KEY НЕ е в .env: подайте го като env за командата или го въведете при поискване:
#   OPENAI_API_KEY=sk-... ./scripts/n8n/setup.sh
# Празен отговор → съществуващият OpenAI credential в n8n се запазва.
# По избор: OPENAI_MODEL (по подразбиране gpt-4.1-mini), OPENAI_BASE_URL (за тестове с мок).
set -euo pipefail

cd "$(dirname "$0")/../.."

log() { echo "[n8n-setup] $*"; }
dc() { docker compose "$@"; }

if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  read -r -s -p "OpenAI API ключ (Enter = запази текущия; няма да се покаже и запише): " OPENAI_API_KEY || true
  echo
fi
export OPENAI_API_KEY

log "workflow файловете са актуални спрямо промпта…"
node scripts/n8n/build-workflows.mjs --check

log "образ на n8n-setup и postgres…"
dc build -q n8n-setup
dc up -d --wait postgres >/dev/null 2>&1

# `run` взима OPENAI_* от тази обвивка (compose интерполация), не от .env на диска.
FORCE_WORKFLOW_IMPORT=1 dc run --rm --no-deps n8n-setup

log "рестарт на n8n, за да регистрира webhook-ите…"
dc up -d --wait n8n >/dev/null 2>&1
dc restart n8n >/dev/null 2>&1
dc up -d --wait n8n >/dev/null 2>&1

log "проверка: Chat Trigger отговаря и изисква Basic Auth…"
code=$(dc exec -T n8n sh -c "wget -S -qO- --post-data='{}' http://127.0.0.1:5678/webhook/booking-agent/chat 2>&1 | grep -m1 HTTP/ | awk '{print \$2}'" | tr -d '\r')
if [[ "$code" == "401" || "$code" == "403" ]]; then
  log "  ✓ без парола → $code (защитен)"
else
  log "  ⚠ неочакван отговор без парола: ${code:-няма}"
fi
log "готово. N8N_CHAT_URL=http://n8n:5678/webhook/booking-agent/chat"
log "         N8N_CHAT_PURGE_URL=http://n8n:5678/webhook/chat-purge"
