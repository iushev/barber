#!/usr/bin/env bash
# Backup на всичко с данни: двете бази (barbershop, n8n), снимките (volume uploads)
# и директорията на n8n (volume n8n_data). Пуска се от директорията на проекта на
# сървъра — ръчно преди деплой/миграция или от cron (вижте README → Backup).
#
#   ./scripts/backup.sh                 # → ./backups/<дата-час>/
#   BACKUP_DIR=/srv/backups KEEP_DAYS=30 ./scripts/backup.sh
#
# Файловете съдържат лични данни на клиенти → директорията е само за собственика (700),
# дръжте копие извън сървъра (криптирано), напр. с restic/borg/rclone.
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$BACKUP_DIR/$STAMP"

umask 077
mkdir -p "$DEST"

dc() { docker compose "$@"; }
log() { printf '[backup] %s\n' "$*"; }

# pg_dump в custom формат (-Fc): компресиран, възстановява се с pg_restore.
for db in barbershop n8n; do
  log "pg_dump $db"
  dc exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$1"' _ "$db" >"$DEST/$db.dump"
done

# Глобални обекти (роли) — без пароли не може, затова --no-role-passwords;
# паролите са в .env и се задават наново от init скрипта/ръчно.
log "pg_dumpall --globals-only"
dc exec -T postgres sh -c 'pg_dumpall -U "$POSTGRES_USER" --globals-only --no-role-passwords' \
  >"$DEST/globals.sql"

log "uploads (снимки)"
dc exec -T app tar czf - -C /app uploads >"$DEST/uploads.tar.gz"

if dc ps --status running --services | grep -qx n8n; then
  log "n8n_data"
  dc exec -T n8n tar czf - -C /home/node .n8n >"$DEST/n8n_data.tar.gz"
else
  log "n8n не работи — пропускам n8n_data"
fi

# Бърза проверка, че dump-овете не са празни/повредени.
for db in barbershop n8n; do
  dc exec -T postgres pg_restore --list <"$DEST/$db.dump" >/dev/null
done

log "готово: $DEST ($(du -sh "$DEST" | cut -f1))"

if [[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] && ((KEEP_DAYS > 0)); then
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -print -exec rm -rf {} +
fi
