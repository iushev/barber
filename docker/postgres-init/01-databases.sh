#!/bin/sh
# Изпълнява се еднократно при първото създаване на data volume-а.
# Създава две бази с отделни потребители; всеки има достъп само до своята.
# Потребителят на приложението е СОБСТВЕНИК на `barbershop`, за да може миграцията
# да изпълни CREATE EXTENSION btree_gist (trusted extension) без суперпотребител.
set -eu

: "${APP_DB_USER:?}" "${APP_DB_PASSWORD:?}" "${APP_DB_NAME:?}"
: "${N8N_DB_USER:?}" "${N8N_DB_PASSWORD:?}" "${N8N_DB_NAME:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v app_user="$APP_DB_USER" -v app_pass="$APP_DB_PASSWORD" -v app_db="$APP_DB_NAME" \
  -v n8n_user="$N8N_DB_USER" -v n8n_pass="$N8N_DB_PASSWORD" -v n8n_db="$N8N_DB_NAME" <<'SQL'
CREATE ROLE :"app_user" LOGIN PASSWORD :'app_pass';
CREATE ROLE :"n8n_user" LOGIN PASSWORD :'n8n_pass';

CREATE DATABASE :"app_db" OWNER :"app_user";
CREATE DATABASE :"n8n_db" OWNER :"n8n_user";

-- По подразбиране PUBLIC има CONNECT към всяка база; премахваме го.
REVOKE ALL ON DATABASE :"app_db" FROM PUBLIC;
REVOKE ALL ON DATABASE :"n8n_db" FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_db" TO :"app_user";
GRANT CONNECT ON DATABASE :"n8n_db" TO :"n8n_user";
SQL

# PostgreSQL 15+: схемата public е собственост на pg_database_owner, т.е. на
# собственика на базата — допълнителни GRANT-ове не са нужни.
echo "[postgres-init] създадени бази $APP_DB_NAME и $N8N_DB_NAME"
