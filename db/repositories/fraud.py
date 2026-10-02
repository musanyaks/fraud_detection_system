from datetime import datetime, timezone
from uuid import uuid4

from common.schemas import Transaction, FraudAssessment
from db.connection import CassandraConnection

# ---------------- predictions ----------------


def classify_fraud_type(reasons) -> str:
    """Map ensemble detection reasons to a mock-style fraud type."""
    text = " ".join(reasons or []).lower()
    if "velocity" in text:
        return "Velocity"
    if "impossible travel" in text or "first-seen location" in text:
        return "Location Anomaly"
    if "failed attempts" in text:
        return "Account Takeover"
    if "never-seen device" in text:
        return "Card Not Present"
    if "merchant" in text:
        return "Merchant Fraud"
    if "amount" in text:
        return "Large Amount"
    return "Other"

_INS_PRED_TXN = """INSERT INTO fraud_predictions_by_transaction
    (transaction_id, customer_id, transaction_time, amount, merchant_id, location,
     fraud_probability, supervised_score, anomaly_score, risk_score, risk_level,
     reasons, reason_weights, model_version, predicted_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

_INS_PRED_CUST = """INSERT INTO fraud_predictions_by_customer
    (customer_id, prediction_date, predicted_at, transaction_id, amount,
     fraud_probability, risk_score, risk_level, reasons)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

_INS_PRED_TIME = """INSERT INTO fraud_predictions_by_time
    (day, predicted_at, transaction_id, customer_id, amount, fraud_probability,
     risk_score, risk_level, location, merchant_category, fraud_type)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

_INS_FEATURES = """INSERT INTO model_features
    (feature_date, computed_at, transaction_id, customer_id, label, features)
    VALUES (%s,%s,%s,%s,%s,%s)"""


class PredictionRepository:
    def __init__(self, conn=None):
        self.conn = conn or CassandraConnection.get()

    def save(self, t: Transaction, a: FraudAssessment, features: dict | None = None,
             label: int | None = None) -> None:
        day = a.predicted_at.strftime("%Y-%m-%d")
        s = self.conn.session
        s.execute(self.conn.prepare(_INS_PRED_TXN), (
            a.transaction_id, a.customer_id, t.timestamp, t.amount, t.merchant_id,
            t.location, a.fraud_probability, a.supervised_score, a.anomaly_score,
            a.risk_score, a.risk_level.value, a.reasons, a.reason_weights,
            a.model_version, a.predicted_at))
        s.execute(self.conn.prepare(_INS_PRED_CUST), (
            a.customer_id, day, a.predicted_at, a.transaction_id, t.amount,
            a.fraud_probability, a.risk_score, a.risk_level.value, a.reasons))
        s.execute(self.conn.prepare(_INS_PRED_TIME), (
            day, a.predicted_at, a.transaction_id, a.customer_id, t.amount,
            a.fraud_probability, a.risk_score, a.risk_level.value,
            t.location, t.merchant_category, classify_fraud_type(a.reasons)))
        if features is not None:
            s.execute(self.conn.prepare(_INS_FEATURES), (
                day, a.predicted_at, a.transaction_id, a.customer_id,
                label if label is not None else -1,
                {k: float(v) for k, v in features.items()}))

    def get_by_transaction(self, transaction_id):
        rows = list(self.conn.execute(
            "SELECT * FROM fraud_predictions_by_transaction WHERE transaction_id=%s",
            (transaction_id,)))
        return rows[0] if rows else None

    def recent_by_day(self, day: str, limit: int = 300):
        return list(self.conn.execute(
            "SELECT * FROM fraud_predictions_by_time WHERE day=%s LIMIT %s",
            (day, limit)))

    def flagged_count_by_day(self, day: str) -> int:
        rows = list(self.conn.execute(
            "SELECT count(*) FROM fraud_predictions_by_time WHERE day=%s AND "
            "risk_level IN ('HIGH','CRITICAL') ALLOW FILTERING", (day,)))
        return int(rows[0]["count"]) if rows else 0

    def count_by_day(self, day: str) -> int:
        rows = list(self.conn.execute(
            "SELECT count(*) FROM fraud_predictions_by_time WHERE day=%s", (day,)))
        return int(rows[0]["count"]) if rows else 0

    def flagged_by_day(self, day: str, limit: int = 5000):
        # exact HIGH/CRITICAL rows for the day partition (ALLOW FILTERING is
        # scoped to this single partition — fine at demo scale)
        return list(self.conn.execute(
            "SELECT * FROM fraud_predictions_by_time WHERE day=%s AND "
            "risk_level IN ('HIGH','CRITICAL') ALLOW FILTERING", (day,)))[:limit]

    def by_customer(self, customer_id, days: int = 7, limit: int = 100):
        now = datetime.now(timezone.utc)
        rows = []
        for d in range(days):
            day = (now - __import__("datetime").timedelta(days=d)).strftime("%Y-%m-%d")
            rows += list(self.conn.execute(
                "SELECT * FROM fraud_predictions_by_customer "
                "WHERE customer_id=%s AND prediction_date=%s LIMIT %s",
                (customer_id, day, limit)))
        return sorted(rows, key=lambda r: r["predicted_at"], reverse=True)[:limit]

    def sample_features(self, day: str, limit: int = 5000):
        return list(self.conn.execute(
            "SELECT * FROM model_features WHERE feature_date=%s LIMIT %s",
            (day, limit)))


# ---------------- alerts ----------------
_INS_ALERT = """INSERT INTO fraud_alerts_by_status
    (status, created_at, alert_id, severity, transaction_id, customer_id, amount,
     fraud_probability, risk_score, reasons, assigned_to, notes, resolved_at)
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"""

_INS_ALERT_ID = """INSERT INTO fraud_alerts_by_id
    (alert_id, status, severity, created_at, customer_id, transaction_id)
    VALUES (%s,%s,%s,%s,%s,%s)"""


class AlertRepository:
    def __init__(self, conn=None):
        self.conn = conn or CassandraConnection.get()

    def create(self, t: Transaction, a: FraudAssessment) -> object:
        alert_id = uuid4()
        now = a.predicted_at
        params = ("OPEN", now, alert_id, a.risk_level.value, a.transaction_id,
                  a.customer_id, t.amount, a.fraud_probability, a.risk_score,
                  a.reasons, None, None, None)
        s = self.conn.session
        s.execute(self.conn.prepare(_INS_ALERT), params)
        s.execute(self.conn.prepare(_INS_ALERT_ID), (
            alert_id, "OPEN", a.risk_level.value, now, a.customer_id, a.transaction_id))
        return list(s.execute(self.conn.prepare(
            "SELECT * FROM fraud_alerts_by_id WHERE alert_id=%s"), (alert_id,)))[0]

    def list(self, status: str = "OPEN", limit: int = 200):
        return list(self.conn.execute(
            "SELECT * FROM fraud_alerts_by_status WHERE status=%s LIMIT %s",
            (status, limit)))

    def get(self, alert_id):
        rows = list(self.conn.execute(
            "SELECT * FROM fraud_alerts_by_id WHERE alert_id=%s", (alert_id,)))
        return rows[0] if rows else None

    def transition(self, alert_id, new_status: str, assigned_to: str | None = None,
                   notes: str | None = None) -> None:
        """Status change = delete from old partition, write into new one."""
        meta = self.get(alert_id)
        if meta is None:
            raise KeyError(f"alert {alert_id} not found")
        row = list(self.conn.execute(
            "SELECT * FROM fraud_alerts_by_status WHERE status=%s AND created_at=%s "
            "AND alert_id=%s", (meta["status"], meta["created_at"], alert_id)))[0]
        resolved_at = datetime.now(timezone.utc) \
            if new_status in ("RESOLVED", "FALSE_POSITIVE") else None
        s = self.conn.session
        s.execute(self.conn.prepare(
            "DELETE FROM fraud_alerts_by_status WHERE status=%s AND created_at=%s "
            "AND alert_id=%s"), (meta["status"], meta["created_at"], alert_id))
        s.execute(self.conn.prepare(_INS_ALERT), (
            new_status, row["created_at"], alert_id, row["severity"],
            row["transaction_id"], row["customer_id"], row["amount"],
            row["fraud_probability"], row["risk_score"], row["reasons"],
            assigned_to or row.get("assigned_to"), notes or row.get("notes"),
            resolved_at))
        s.execute(self.conn.prepare(_INS_ALERT_ID), (
            alert_id, new_status, row["severity"], row["created_at"],
            row["customer_id"], row["transaction_id"]))


# ---------------- customer profiles / merchants / customers ----------------
class ProfileRepository:
    def __init__(self, conn=None):
        self.conn = conn or CassandraConnection.get()

    def get_profile(self, customer_id):
        rows = list(self.conn.execute(
            "SELECT * FROM customer_risk_profiles WHERE customer_id=%s", (customer_id,)))
        return rows[0] if rows else None

    def upsert_profile(self, customer_id, **fields) -> None:
        cols, vals = ["customer_id"], [customer_id]
        for k, v in fields.items():
            cols.append(k)
            vals.append(v)
        cql = (f"INSERT INTO customer_risk_profiles ({', '.join(cols)}) "
               f"VALUES ({', '.join(['%s'] * len(cols))})")
        self.conn.session.execute(self.conn.prepare(cql), tuple(vals))

    def get_customer(self, customer_id):
        rows = list(self.conn.execute(
            "SELECT * FROM customers WHERE customer_id=%s", (customer_id,)))
        return rows[0] if rows else None

    def list_customers(self, limit: int = 200):
        return list(self.conn.execute(f"SELECT * FROM customers LIMIT {limit}"))

    def save_customer(self, c: dict) -> None:
        self.conn.session.execute(self.conn.prepare(
            "INSERT INTO customers (customer_id, name, email, home_city, home_country,"
            " home_latitude, home_longitude, avg_transaction_amount, account_created_at)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)"), (
            c["customer_id"], c["name"], c["email"], c["home_city"], c["home_country"],
            c["home_latitude"], c["home_longitude"], c["avg_amount"],
            c["account_created_at"]))

    def get_merchant(self, merchant_id: str):
        rows = list(self.conn.execute(
            "SELECT * FROM merchant_activity WHERE merchant_id=%s", (merchant_id,)))
        return rows[0] if rows else None

    def save_merchant(self, m: dict) -> None:
        self.conn.session.execute(self.conn.prepare(
            "INSERT INTO merchant_activity (merchant_id, merchant_name, category,"
            " txn_count, fraud_count, fraud_rate, risk_score, last_updated)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s,%s)"), (
            m["merchant_id"], m["merchant_name"], m["category"], m["txn_count"],
            m["fraud_count"], m["fraud_rate"], m["risk_score"],
            datetime.now(timezone.utc)))


# ---------------- model monitoring / registry ----------------


class MonitoringRepository:
    def __init__(self, conn=None):
        self.conn = conn or CassandraConnection.get()

    def save_metrics(self, model_name: str, model_version: str,
                     metrics: dict) -> None:
        from datetime import date
        day = date.today().isoformat()
        now = datetime.now(timezone.utc)
        cql = ("INSERT INTO model_monitoring (model_name, model_version, "
               "metric_date, metric_name, metric_value, recorded_at) "
               "VALUES (%s, %s, %s, %s, %s, %s)")
        prepared = self.conn.prepare(cql)
        for name, value in metrics.items():
            self.conn.session.execute(
                prepared, (model_name, model_version, day,
                           name, float(value), now))

    def register_model(self, model_name: str, model_version: str,
                       path: str, metrics: dict) -> None:
        now = datetime.now(timezone.utc)
        cql = ("INSERT INTO model_registry (model_name, registered_at, "
               "model_version, artifacts_path, metrics) "
               "VALUES (%s, %s, %s, %s, %s)")
        self.conn.session.execute(
            self.conn.prepare(cql),
            (model_name, now, model_version, path,
             {k: float(v) for k, v in metrics.items()}))

    def latest_version(self, model_name: str):
        rows = list(self.conn.execute(
            "SELECT * FROM model_registry WHERE model_name=%s LIMIT 1",
            (model_name,)))
        return rows[0] if rows else None

    def get_metrics(self, model_name: str, model_version: str, day=None):
        if day is None:
            from datetime import date
            day = date.today().isoformat()
        return list(self.conn.execute(
            "SELECT * FROM model_monitoring WHERE model_name=%s AND "
            "model_version=%s AND metric_date=%s",
            (model_name, model_version, day)))
