#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker info > /dev/null 2>&1 || { echo "Start Docker Desktop first"; exit 1; }
docker compose up -d
until docker compose exec -T cassandra cqlsh -e "SELECT release_version FROM system.local" >/dev/null 2>&1; do sleep 5; done
until docker compose logs kafka 2>/dev/null | grep -q "started (kafka.server.KafkaServer)"; do sleep 5; done
docker compose exec -T cassandra cqlsh -e "DESCRIBE KEYSPACES;" | grep -q fraud_detection || ./scripts/dev.sh schema
docker compose up -d --force-recreate api consumer dashboard producer
sleep 4
docker compose logs --tail 3 consumer | grep -q inference_service_ready && echo "consumer: model loaded"
echo "LIVE — now: cd frontend && npm run dev  →  http://localhost:5173"
