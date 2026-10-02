#!/usr/bin/env bash
# Resume live streaming: verify producer/consumer, reset the consumer group
# to the topic head (skips any backlog), and verify today's bucket fills.
# Usage: ./scripts/stream-recovery.sh
set -uo pipefail
cd "$(dirname "$0")/.."

echo "===== A. consumer group in the running image ====="
docker compose exec consumer grep -o 'group_id="[^"]*"' /app/streaming/consumer.py

echo "===== B. ALL groups + lag BEFORE ====="
docker compose exec kafka kafka-consumer-groups \
  --bootstrap-server kafka:29092 --all-groups --describe

echo "===== C. is the producer streaming? ====="
docker compose logs --tail 2 producer

echo "===== D. STOP consumer (offset reset requires an inactive group) ====="
docker compose stop consumer
sleep 3

echo "===== E. RESET consumer-group offsets to latest (skip backlog) ====="
docker compose exec kafka kafka-consumer-groups \
  --bootstrap-server kafka:29092 \
  --group fraud-detector-v3 \
  --topic transactions \
  --reset-offsets --to-latest --execute

echo "===== F. verify reset (CURRENT-OFFSET should now equal the log end offset) ====="
docker compose exec kafka kafka-consumer-groups \
  --bootstrap-server kafka:29092 --group fraud-detector-v3 --describe

echo "===== G. START consumer (reads live messages only) ====="
docker compose start consumer
sleep 35

echo "===== H. verify: scored counter + today's Cassandra bucket, twice ====="
curl -sS http://localhost:9100/metrics | grep fraud_transactions_processed_total
TODAY=$(docker compose exec -T consumer date +%Y-%m-%d)
docker compose exec -T cassandra cqlsh -e \
  "SELECT count(*) FROM fraud_detection.transactions_by_time WHERE day='$TODAY';"
sleep 30
curl -sS http://localhost:9100/metrics | grep fraud_transactions_processed_total
docker compose exec -T cassandra cqlsh -e \
  "SELECT count(*) FROM fraud_detection.transactions_by_time WHERE day='$TODAY';"

echo "===== DONE: both numbers climbing = the stream is live in today's bucket ====="
