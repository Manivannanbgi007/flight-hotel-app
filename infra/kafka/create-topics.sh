#!/bin/bash
# Creates all application topics. Automatic topic creation is disabled on the broker, so a typo in a topic name
# fails loudly instead of silently creating a new topic.
set -euo pipefail

BOOTSTRAP="${BOOTSTRAP_SERVERS:-kafka:29092}"
PARTITIONS="${TOPIC_PARTITIONS:-3}"

create() {
  local topic="$1"; shift
  kafka-topics --bootstrap-server "$BOOTSTRAP" --create --if-not-exists --topic "$topic" "$@"
}

for domain in identity booking hotel flight payment audit support; do
  create "${domain}.events" --partitions "$PARTITIONS" --replication-factor 1
  create "${domain}.events.DLT" --partitions 1 --replication-factor 1
done

# Account emails ("verify your email", "reset your password", ...). The messages contain single-use tokens,
# so they are kept for 24 hours only (dead letters too).
create identity-email.events --partitions "$PARTITIONS" --replication-factor 1 --config retention.ms=86400000
create identity-email.events.DLT --partitions 1 --replication-factor 1 --config retention.ms=86400000

# Settings: one partition (global order) and compacted (keeps the latest value per setting key forever).
create settings.events --partitions 1 --replication-factor 1 --config cleanup.policy=compact
create settings.events.DLT --partitions 1 --replication-factor 1

echo "Topics:"
kafka-topics --bootstrap-server "$BOOTSTRAP" --list
