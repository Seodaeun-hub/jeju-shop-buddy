#!/bin/sh
set -eu

: "${PGHOST:?Set PGHOST to the PostgreSQL service hostname}"
: "${PGPORT:?Set PGPORT to the PostgreSQL service port}"
: "${PGDATABASE:?Set PGDATABASE to the PostgreSQL database name}"
: "${PGUSER:?Set PGUSER to the PostgreSQL username}"
: "${PGPASSWORD:?Set PGPASSWORD to the PostgreSQL password}"

export PGCONNECT_TIMEOUT=5
attempt=0
until pg_isready --quiet; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 15 ]; then
        echo "PostgreSQL did not become ready" >&2
        exit 1
    fi
    sleep 2
done
psql --no-psqlrc --no-password --set=ON_ERROR_STOP=1 --file=/app/init-db.sql

export SHOP_BUDDY_DB_URL="jdbc:postgresql://${PGHOST}:${PGPORT}/${PGDATABASE}"
export SHOP_BUDDY_DB_USER="$PGUSER"
export SHOP_BUDDY_DB_PASSWORD="$PGPASSWORD"
unset PGPASSWORD
exec java -jar /app/app.jar "--server.port=${PORT:-8080}"
