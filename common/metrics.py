from prometheus_client import Counter, Histogram, Gauge

TXN_PROCESSED = Counter("fraud_transactions_processed_total", "Transactions scored")
TXN_FLAGGED = Counter("fraud_transactions_flagged_total", "Transactions flagged HIGH/CRITICAL",
                      ["risk_level"])
ALERTS_CREATED = Counter("fraud_alerts_created_total", "Alerts created")
PIPELINE_ERRORS = Counter("fraud_pipeline_errors_total", "Pipeline errors")
SCORING_LATENCY = Histogram("fraud_scoring_latency_seconds", "End-to-end scoring latency",
                            buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0))
LAST_PROCESSED = Gauge("fraud_last_processed_timestamp", "Unix ts of last processed txn")