-- ============================================================
-- Keyspace (RF=3 in prod; RF=1 for single-node demo)
-- ============================================================
CREATE KEYSPACE IF NOT EXISTS fraud_detection
WITH replication = {'class': 'NetworkTopologyStrategy', 'datacenter1': 1}
AND durable_writes = true;

USE fraud_detection;

-- ============================================================
-- TRANSACTIONS — denormalized per access path (query-first design)
-- ============================================================

-- Q: "Give me a customer's transaction history / recent activity"
--     -> feeds real-time velocity & behavioral features
CREATE TABLE IF NOT EXISTS transactions_by_customer (
    customer_id      uuid,
    transaction_time timestamp,
    transaction_id   uuid,
    amount           double,
    currency         text,
    merchant_id      text,
    merchant_name    text,
    merchant_category text,
    channel          text,
    card_present     boolean,
    device_id        text,
    device_type      text,
    ip_address       text,
    latitude         double,
    longitude        double,
    location         text,
    country          text,
    status           text,
    is_fraud         boolean,
    PRIMARY KEY ((customer_id), transaction_time, transaction_id)
) WITH CLUSTERING ORDER BY (transaction_time DESC, transaction_id DESC)
  AND compaction = {'class': 'TimeWindowCompactionStrategy',
                    'compaction_window_unit': 'DAYS', 'compaction_window_size': 7};

-- Q: "Live transaction feed / today's volume" (dashboard)
CREATE TABLE IF NOT EXISTS transactions_by_time (
    day              text,            -- 'YYYY-MM-DD' bucket
    transaction_time timestamp,
    transaction_id   uuid,
    customer_id      uuid,
    amount           double,
    merchant_id      text,
    merchant_name    text,
    merchant_category text,
    channel          text,
    device_id        text,
    location         text,
    country          text,
    latitude         double,
    longitude        double,
    status           text,
    is_fraud         boolean,
    PRIMARY KEY ((day), transaction_time, transaction_id)
) WITH CLUSTERING ORDER BY (transaction_time DESC, transaction_id DESC);

-- Q: "Merchant activity & analytics"
CREATE TABLE IF NOT EXISTS transactions_by_merchant (
    merchant_id      text,
    day              text,
    transaction_time timestamp,
    transaction_id   uuid,
    customer_id      uuid,
    amount           double,
    location         text,
    status           text,
    is_fraud         boolean,
    PRIMARY KEY ((merchant_id, day), transaction_time, transaction_id)
) WITH CLUSTERING ORDER BY (transaction_time DESC);

-- Q: "Where has this device been seen?" (new-device / device-sharing checks)
CREATE TABLE IF NOT EXISTS transactions_by_device (
    device_id        text,
    transaction_time timestamp,
    transaction_id   uuid,
    customer_id      uuid,
    amount           double,
    location         text,
    ip_address       text,
    is_fraud         boolean,
    PRIMARY KEY ((device_id), transaction_time, transaction_id)
) WITH CLUSTERING ORDER BY (transaction_time DESC);

-- ============================================================
-- PREDICTIONS (written by the ML pipeline)
-- ============================================================
CREATE TABLE IF NOT EXISTS fraud_predictions_by_transaction (
    transaction_id   uuid PRIMARY KEY,
    customer_id      uuid,
    transaction_time timestamp,
    amount           double,
    merchant_id      text,
    location         text,
    fraud_probability double,
    supervised_score double,
    anomaly_score    double,
    risk_score       double,
    risk_level       text,
    reasons          list<text>,
    reason_weights   map<text, double>,
    model_version    text,
    predicted_at     timestamp
);

CREATE TABLE IF NOT EXISTS fraud_predictions_by_customer (
    customer_id      uuid,
    prediction_date  text,             -- 'YYYY-MM-DD'
    predicted_at     timestamp,
    transaction_id   uuid,
    amount           double,
    fraud_probability double,
    risk_score       double,
    risk_level       text,
    reasons          list<text>,
    PRIMARY KEY ((customer_id, prediction_date), predicted_at, transaction_id)
) WITH CLUSTERING ORDER BY (predicted_at DESC);

CREATE TABLE IF NOT EXISTS fraud_predictions_by_time (
    day              text,
    predicted_at     timestamp,
    transaction_id   uuid,
    customer_id      uuid,
    amount           double,
    fraud_probability double,
    risk_score       double,
    risk_level       text,
    location         text,
    merchant_category text,
    fraud_type       text,
    PRIMARY KEY ((day), predicted_at, transaction_id)
) WITH CLUSTERING ORDER BY (predicted_at DESC);

-- ============================================================
-- ALERTS — case management (status transitions rewrite partitions)
-- ============================================================
CREATE TABLE IF NOT EXISTS fraud_alerts_by_status (
    status           text,             -- OPEN / INVESTIGATING / RESOLVED / FALSE_POSITIVE
    created_at       timestamp,
    alert_id         uuid,
    severity         text,             -- LOW/MEDIUM/HIGH/CRITICAL
    transaction_id   uuid,
    customer_id      uuid,
    amount           double,
    fraud_probability double,
    risk_score       double,
    reasons          list<text>,
    assigned_to      text,
    notes            text,
    resolved_at      timestamp,
    PRIMARY KEY ((status), created_at, alert_id)
) WITH CLUSTERING ORDER BY (created_at DESC);

CREATE TABLE IF NOT EXISTS fraud_alerts_by_id (
    alert_id         uuid PRIMARY KEY,
    status           text,
    severity         text,
    created_at       timestamp,
    customer_id      uuid,
    transaction_id   uuid
);

-- ============================================================
-- CUSTOMERS / PROFILES / MERCHANTS
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
    customer_id   uuid PRIMARY KEY,
    name          text,
    email         text,
    home_city     text,
    home_country  text,
    home_latitude  double,
    home_longitude double,
    avg_transaction_amount double,
    account_created_at timestamp
);

-- Rolling behavioral profile, updated by the consumer after each scored txn
CREATE TABLE IF NOT EXISTS customer_risk_profiles (
    customer_id       uuid PRIMARY KEY,
    avg_amount        double,
    amount_std        double,
    txn_count_30d     bigint,
    fraud_count       int,
    known_devices     set<text>,
    known_locations   set<text>,
    last_txn_time     timestamp,
    last_latitude     double,
    last_longitude    double,
    account_created_at timestamp,
    current_risk_score double,
    risk_level        text,
    updated_at        timestamp
);

CREATE TABLE IF NOT EXISTS merchant_activity (
    merchant_id   text PRIMARY KEY,
    merchant_name text,
    category      text,
    txn_count     bigint,
    fraud_count   bigint,
    fraud_rate    double,
    risk_score    double,
    last_updated  timestamp
);

-- ============================================================
-- ML LIFECYCLE — features (retraining/drift) + monitoring + registry
-- ============================================================
CREATE TABLE IF NOT EXISTS model_features (
    feature_date   text,                -- 'YYYY-MM-DD' bucket
    computed_at    timestamp,
    transaction_id uuid,
    customer_id    uuid,
    label          int,
    features       map<text, double>,
    PRIMARY KEY ((feature_date), computed_at, transaction_id)
) WITH CLUSTERING ORDER BY (computed_at DESC);

CREATE TABLE IF NOT EXISTS model_monitoring (
    model_name    text,
    model_version text,
    metric_date   text,
    metric_name   text,
    metric_value  double,
    recorded_at   timestamp,
    PRIMARY KEY ((model_name, model_version), metric_date, metric_name)
);

CREATE TABLE IF NOT EXISTS model_registry (
    model_name    text,
    registered_at timestamp,
    model_version text,
    artifacts_path text,
    metrics       map<text, double>,
    PRIMARY KEY (model_name, registered_at)
) WITH CLUSTERING ORDER BY (registered_at DESC);