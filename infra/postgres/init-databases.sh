#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Runs ONCE, automatically, the first time the Postgres container initializes
# its data directory (that's the contract of /docker-entrypoint-initdb.d/*).
#
# It creates the two databases our stack needs, each with the locale Synapse
# REQUIRES:  LC_COLLATE='C' and LC_CTYPE='C'.  Synapse refuses to start on a
# database created with any other collation, so we set it explicitly here.
#
# TEMPLATE template0 is used because you can only override locale when cloning
# from template0 (template1 may carry a different locale).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE synapse
        ENCODING 'UTF8'
        LC_COLLATE 'C'
        LC_CTYPE 'C'
        TEMPLATE template0
        OWNER "$POSTGRES_USER";

    CREATE DATABASE mautrix_whatsapp
        ENCODING 'UTF8'
        LC_COLLATE 'C'
        LC_CTYPE 'C'
        TEMPLATE template0
        OWNER "$POSTGRES_USER";
EOSQL

echo "init-databases.sh: created 'synapse' and 'mautrix_whatsapp' databases."
