#!/bin/bash
# Runs once, when the MySQL data volume is created for the first time.
# Database per service: each service gets its own database and a user that can ONLY access that database.
# Passwords come from environment variables (see .env). Do not use single quotes in passwords.
set -euo pipefail

create_service_db() {
  local db="$1" user="$2" password="$3"
  if [[ -z "$password" ]]; then
    echo "Password for $user is empty. Set it in .env" >&2
    exit 1
  fi
  mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${password}';
GRANT ALL PRIVILEGES ON \`${db}\`.* TO '${user}'@'%';
-- Debezium only needs to read the outbox table, but it must be able to see the database.
GRANT SELECT ON \`${db}\`.* TO 'debezium'@'%';
SQL
  echo "Created database ${db} for ${user}"
}

if [[ -z "${DEBEZIUM_DB_PASSWORD:-}" ]]; then
  echo "DEBEZIUM_DB_PASSWORD is empty. Set it in .env" >&2
  exit 1
fi

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
CREATE USER IF NOT EXISTS 'debezium'@'%' IDENTIFIED BY '${DEBEZIUM_DB_PASSWORD}';
-- Minimum privileges for the Debezium MySQL connector (binlog reader).
GRANT RELOAD, SHOW DATABASES, REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'debezium'@'%';
SQL

create_service_db identity_db     identity_user     "${IDENTITY_DB_PASSWORD:-}"
create_service_db hotel_db        hotel_user        "${HOTEL_DB_PASSWORD:-}"
create_service_db flight_db       flight_user       "${FLIGHT_DB_PASSWORD:-}"
create_service_db booking_db      booking_user      "${BOOKING_DB_PASSWORD:-}"
create_service_db payment_db      payment_user      "${PAYMENT_DB_PASSWORD:-}"
create_service_db notification_db notification_user "${NOTIFICATION_DB_PASSWORD:-}"
create_service_db reporting_db    reporting_user    "${REPORTING_DB_PASSWORD:-}"

mysql -uroot -p"${MYSQL_ROOT_PASSWORD}" -e "FLUSH PRIVILEGES;"
