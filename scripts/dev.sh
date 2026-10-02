#!/usr/bin/env bash
# ./scripts/dev.sh {up|down|nuke|schema|train|producer|consumer|logs|alerts|drift|test|shell}
set -euo pipefail
cd "$(dirname "$0")/.."

case "${1:-help}" in
  up)       docker compose up -d ;;
  down)     docker compose down ;;
  nuke)     docker compose down -v ;;
  schema)   docker compose exec -T cassandra cqlsh < db/schema.cql ;;
  train)    docker compose exec -T api python -m models.train ;;
  producer) winpty docker compose exec api \
            python -m streaming.producer --rate 8 --fraud-rate 0.04 ;;
  consumer) docker compose up -d consumer ;;
  logs)     docker compose logs -f consumer ;;
  alerts)   docker compose logs -f consumer 2>&1 | grep --line-buffered -i "fraud_alert_created" ;;
  drift)    docker compose exec -T api python -m models.monitoring ;;
  test)     docker compose exec -T api python -m pytest -q ;;
  shell)    winpty docker compose exec api bash ;;
  *)        echo "usage: ./scripts/dev.sh {up|down|nuke|schema|train|producer|consumer|logs|alerts|drift|test|shell}" ;;
esac
