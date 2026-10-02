#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== infra =="
docker compose up -d cassandra zookeeper kafka redis prometheus grafana

echo "== waiting for cassandra =="
until docker compose exec -T cassandra cqlsh -e "SELECT release_version FROM system.local" >/dev/null 2>&1; do sleep 5; done

echo "== waiting for kafka broker =="
until docker compose logs kafka 2>/dev/null | grep -q "started (kafka.server.KafkaServer)"; do sleep 5; done
echo "== broker handshake =="
docker compose exec api python -c "
from kafka import KafkaConsumer
c = KafkaConsumer(bootstrap_servers='kafka:29092', api_version_auto_timeout_ms=15000)
c.topics(); c.close(); print('broker OK')"

echo "== app services =="
docker compose up -d --force-recreate api consumer dashboard
sleep 4
docker compose logs --tail 3 consumer | grep -q inference_service_ready && echo "consumer: model loaded" || echo "consumer: check logs"
echo "== DONE — now: ./scripts/dev.sh producer =="
