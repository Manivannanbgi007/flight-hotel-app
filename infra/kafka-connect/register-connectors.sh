#!/bin/sh
# Creates or updates every Debezium connector in ./connectors (file name = connector name).
# PUT /connectors/<name>/config is idempotent, so running this again is always safe.
set -eu

CONNECT_URL="${CONNECT_URL:-http://kafka-connect:8083}"
CONNECTORS_DIR="${CONNECTORS_DIR:-/connectors}"

echo "Waiting for Kafka Connect at ${CONNECT_URL} ..."
until curl -fsS "${CONNECT_URL}/connectors" > /dev/null 2>&1; do
  sleep 3
done

for file in "${CONNECTORS_DIR}"/*.json; do
  name=$(basename "$file" .json)
  curl -fsS -X PUT -H "Content-Type: application/json" --data @"$file" \
       "${CONNECT_URL}/connectors/${name}/config" > /dev/null
  echo "Registered connector ${name}"
done

sleep 5
for file in "${CONNECTORS_DIR}"/*.json; do
  name=$(basename "$file" .json)
  state=$(curl -fsS "${CONNECT_URL}/connectors/${name}/status" | grep -o '"state":"[A-Z]*"' | head -1)
  echo "${name}: ${state}"
done
