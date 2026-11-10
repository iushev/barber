#!/bin/sh
# Entrypoint на `app`: миграции → (по избор) първи администратор → Next.js.
# При неуспешна миграция `set -e` спира контейнера: приложението никога не
# стартира с остаряла схема.
set -e

SCRIPTS_DIR="${SCRIPTS_DIR:-/app}"

node "$SCRIPTS_DIR/migrate.mjs"

if [ -n "${ADMIN_EMAIL:-}" ] && [ -n "${ADMIN_PASSWORD:-}" ]; then
  node "$SCRIPTS_DIR/bootstrap-admin.mjs"
else
  echo "[entrypoint] ADMIN_EMAIL/ADMIN_PASSWORD не са зададени — пропускам bootstrap на администратор"
fi

# `exec`, за да е Node процесът PID 1 и да получава SIGTERM от Docker.
# forwarded-headers.mjs нормализира X-Forwarded-* преди Next.js (защита на rate limit по IP).
if [ "$#" -gt 0 ]; then
  exec "$@"
fi
exec node --import ./forwarded-headers.mjs server.js
