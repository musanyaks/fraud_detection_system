"""Kafka consumer: transaction -> realtime features -> ensemble -> Cassandra ->
predictions topic. Includes --direct mode that bypasses Kafka for quick demos."""
import argparse
import json
import signal
import sys
import time

from prometheus_client import start_http_server

from common.config import settings
from common.metrics import PIPELINE_ERRORS
from common.serialization import txn_from_json, assessment_to_json
from models.inference import FraudDetectionService

_running = True


def _stop(sig, frame):
    global _running
    _running = False


def _publish(producer, assessment):
    if producer:
        producer.send("fraud_predictions",
                      key=str(assessment.customer_id),
                      value=json.dumps(assessment_to_json(assessment)))


def run_kafka(service: FraudDetectionService, bootstrap: str):
    from kafka import KafkaConsumer, KafkaProducer
    consumer = None
    for attempt in range(30):
        try:
            consumer = KafkaConsumer(
                "transactions", bootstrap_servers=bootstrap or settings.kafka_bootstrap,
                group_id="fraud-detector-v3", auto_offset_reset="latest",
                enable_auto_commit=False,
                api_version_auto_timeout_ms=15000,
                value_deserializer=lambda m: json.loads(m.decode("utf-8")))
            break
        except Exception as e:
            print(f"[consumer] kafka not ready ({attempt + 1}/30): {e}")
            time.sleep(5)
    if consumer is None:
        raise SystemExit("[consumer] kafka unreachable after 30 attempts")
    producer = KafkaProducer(bootstrap_servers=bootstrap or settings.kafka_bootstrap)
    print("[consumer] Kafka mode: consuming 'transactions'")
    while _running:
        batch = consumer.poll(timeout_ms=1000)
        for tp, messages in batch.items():
            for msg in messages:
                try:
                    a = service.process(txn_from_json(msg.value))
                except Exception as e:
                    PIPELINE_ERRORS.inc()
                    print(f"[consumer] message failed: {type(e).__name__}: {str(e)[:200]}")
                    continue
                # publish is best-effort: predictions are already durable in
                # Cassandra; nothing subscribes to this topic today.
                # predictions are durable in Cassandra; topic publish is
                # disabled (no subscribers — kept for future WS fan-out)
                # _publish(producer, a)
        consumer.commit()
    consumer.close()


def run_direct(service: FraudDetectionService, fraud_rate: float, rate: float):
    from data.ingestion.generator import FraudTransactionGenerator
    gen = FraudTransactionGenerator(n_customers=100, seed=11)
    print(f"[consumer] DIRECT mode (no Kafka): ~{rate} txn/s, fraud_rate={fraud_rate}")
    for delay, txns in gen.stream(fraud_rate=fraud_rate,
                                  mean_rate_per_sec=max(rate, 0.1)):
        if not _running:
            break
        time.sleep(delay)
        for t in txns:
            try:
                service.process(t)
            except Exception:
                PIPELINE_ERRORS.inc()


if __name__ == "__main__":
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)
    ap = argparse.ArgumentParser()
    ap.add_argument("--direct", action="store_true", help="bypass Kafka")
    ap.add_argument("--rate", type=float, default=5.0)
    ap.add_argument("--fraud-rate", type=float, default=0.03)
    a = ap.parse_args()
    start_http_server(9100)
    service = FraudDetectionService()
    try:
        run_direct(service, a.fraud_rate, a.rate) if a.direct \
            else run_kafka(service, settings.kafka_bootstrap)
    finally:
        sys.exit(0)