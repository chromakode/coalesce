#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-ENDSQL
	CREATE USER $POSTGRES_COALESCE_USER WITH PASSWORD '$POSTGRES_COALESCE_PASSWORD';
	CREATE DATABASE $POSTGRES_COALESCE_DB OWNER $POSTGRES_COALESCE_USER;

	CREATE USER $POSTGRES_ORY_USER WITH PASSWORD '$POSTGRES_ORY_PASSWORD';
	CREATE DATABASE $POSTGRES_ORY_DB OWNER $POSTGRES_ORY_USER;
ENDSQL