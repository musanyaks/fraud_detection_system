"""Kafka producer: emits generated transactions, keyed by customer_id so that
per-customer ordering (and therefore velocity correctness) is preserved."""
import argparse
import time

from kafka import KafkaProducer

from common.config import settings
from common.serialization import txn_to_json
from data.ingestion.generator import FraudTransactionGenerator


def main(rate: float, fraud_rate: float, bootstrap: str):
    producer = None
    for attempt in range(30):
        try:
            producer = KafkaProducer(
                bootstrap_servers=bootstrap or settings.kafka_bootstrap,
                key_serializer=lambda k: k.encode(),
                value_serializer=lambda v: v.encode("utf-8"),
                acks="all", linger_ms=5,
                api_version_auto_timeout_ms=15000)
            break
        except Exception as e:
            print(f"[producer] kafka not ready ({attempt + 1}/30): {e}")
            time.sleep(5)
    if producer is None:
        raise SystemExit("[producer] kafka unreachable after 30 attempts")
    gen = FraudTransactionGenerator(n_customers=200, seed=7)
    print(f"[producer] streaming to 'transactions' @ ~{rate} txn/s, "
          f"fraud_rate={fraud_rate}")
    for delay, txns in gen.stream(fraud_rate=fraud_rate,
                                  mean_rate_per_sec=max(rate, 0.1)):
        time.sleep(delay)
        for t in txns:
            producer.send("transactions", key=str(t.customer_id),
                          value=txn_to_json(t))
        producer.flush(timeout=5)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rate", type=float, default=5.0)
    ap.add_argument("--fraud-rate", type=float, default=0.03)
    ap.add_argument("--bootstrap", default=settings.kafka_bootstrap)
    a = ap.parse_args()
    main(a.rate, a.fraud_rate, a.bootstrap)