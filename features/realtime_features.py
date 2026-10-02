"""
Online feature service: computes the SAME feature vector as training, but from
Cassandra point-queries + a Redis-cached customer profile. Runs per transaction
in the streaming consumer with single-digit-millisecond DB budgets.
"""
import math
from datetime import timedelta, timezone

from common.geoutils import haversine_km, implied_velocity_kmh
from common.schemas import Transaction
from features.definitions import FEATURE_NAMES, FEATURE_DEFAULTS, CATEGORY_RISK

PROFILE_TTL_S = 60
MERCHANT_TTL_S = 300


class RedisCache:
    """Redis with in-memory fallback so the demo still works without Redis."""

    def __init__(self, url: str):
        try:
            import redis
            self.client = redis.Redis.from_url(url, decode_responses=True)
            self.client.ping()
        except Exception:
            self.client = None
            self._mem: dict = {}

    def get(self, key):
        if self.client:
            import json
            raw = self.client.get(key)
            return json.loads(raw) if raw else None
        return self._mem.get(key)

    def set(self, key, value, ttl: int):
        import json
        import datetime as _dt

        def enc(o):
            if isinstance(o, (_dt.datetime, _dt.date)):
                return o.isoformat()
            if isinstance(o, set):
                return list(o)
            raise TypeError(repr(o))

        if self.client:
            self.client.setex(key, ttl, json.dumps(value, default=enc))
        else:
            self._mem[key] = value




def _ensure_aware(dt):
    """Normalize naive datetimes (legacy cache entries, raw driver rows) to UTC-aware."""
    from datetime import datetime as _D, timezone as _TZ
    if isinstance(dt, str):
        try:
            dt = _D.fromisoformat(dt)
        except ValueError:
            return None
    if isinstance(dt, _D) and dt.tzinfo is None:
        return dt.replace(tzinfo=_TZ.utc)
    return dt


class RealtimeFeatureService:
    def __init__(self, txn_repo, profile_repo, redis_url: str = "redis://localhost:6379/0"):
        self.txns = txn_repo
        self.profiles = profile_repo
        self.cache = RedisCache(redis_url)

    # ---------- customer profile (Cassandra + cache) ----------
    def _profile(self, txn: Transaction) -> dict:
        key = f"profile:{txn.customer_id}"
        p = self.cache.get(key)
        if p:
            return self._norm_profile_dates(p)
        row = self.profiles.get_profile(txn.customer_id) or {}
        cust = self.profiles.get_customer(txn.customer_id) or {}
        def _as_dt(v):
            from datetime import datetime as _D
            if isinstance(v, str):
                try:
                    return _D.fromisoformat(v)
                except ValueError:
                    return None
            return v

        p = {
            "avg_amount": row.get("avg_amount") or cust.get("avg_transaction_amount")
                          or txn.amount,
            "amount_std": row.get("amount_std") or (cust.get("avg_transaction_amount")
                                                    or txn.amount) * 0.5,
            "known_devices": set(row.get("known_devices") or []),
            "known_locations": set(row.get("known_locations") or []),
            "last_txn_time": row.get("last_txn_time"),
            "last_lat": row.get("last_latitude"),
            "last_lon": row.get("last_longitude"),
            "fraud_count": int(row.get("fraud_count") or 0),
            "txn_count_30d": int(row.get("txn_count_30d") or 0),
            "account_created_at": _as_dt(row.get("account_created_at")
                                  or cust.get("account_created_at")),
        }
        p["last_txn_time"] = _as_dt(p["last_txn_time"])
        self.cache.set(key, {k: (list(v) if isinstance(v, set) else v)
                             for k, v in p.items()}, PROFILE_TTL_S)
        return self._norm_profile_dates(p)

    @staticmethod
    def _norm_profile_dates(p: dict) -> dict:
        """JSON cache round-trips datetimes to ISO strings; coerce them back
        before any arithmetic or CQL bind."""
        p["last_txn_time"] = _ensure_aware(p.get("last_txn_time"))
        p["account_created_at"] = _ensure_aware(p.get("account_created_at"))
        return p

    def _merchant_risk(self, txn: Transaction) -> float:
        key = f"merchant:{txn.merchant_id}"
        m = self.cache.get(key)
        if m is None:
            row = self.profiles.get_merchant(txn.merchant_id)
            m = {"risk": float(row["risk_score"]) if row
                 else CATEGORY_RISK.get(txn.merchant_category, 0.05)}
            self.cache.set(key, m, MERCHANT_TTL_S)
        return m["risk"]

    # ---------- main entry point ----------
    def build_features(self, txn: Transaction) -> dict:
        now = txn.timestamp
        p = self._profile(txn)
        f = dict(FEATURE_DEFAULTS)

        # velocity & recency from a single Cassandra window query (24h)
        hist = self.txns.customer_window(txn.customer_id,
                                         now - timedelta(hours=24), now, limit=500)
        for win, name in [(5, "txn_count_5m"), (15, "txn_count_15m"),
                          (60, "txn_count_60m"), (1440, "txn_count_24h")]:
            f[name] = sum(1 for r in hist
                          if (now - r["transaction_time"]).total_seconds() <= win * 60)
        f["sum_amount_15m"] = sum(r["amount"] for r in hist
                                  if (now - r["transaction_time"]).total_seconds() <= 900)
        f["failed_txn_count_24h"] = sum(1 for r in hist if r["status"] == "failed")

        last = hist[0] if hist else None
        if last is not None:
            dt_s = (now - _ensure_aware(last["transaction_time"])).total_seconds()
            f["time_since_last_txn_s"] = dt_s
            dist = float(haversine_km(txn.latitude, txn.longitude,
                                      last["latitude"], last["longitude"]))
            f["distance_from_prev_km"] = dist
            f["implied_velocity_kmh"] = implied_velocity_kmh(dist, dt_s)
        elif p["last_lat"] is not None and p["last_txn_time"] is not None:
            dt_s = (now - _ensure_aware(p["last_txn_time"])).total_seconds()
            f["time_since_last_txn_s"] = dt_s
            dist = float(haversine_km(txn.latitude, txn.longitude,
                                      p["last_lat"], p["last_lon"]))
            f["distance_from_prev_km"] = dist
            f["implied_velocity_kmh"] = implied_velocity_kmh(dist, dt_s)

        # amount behavior
        avg = max(p["avg_amount"], 0.01)
        f["amount"] = float(txn.amount)
        f["log_amount"] = math.log1p(max(txn.amount, 0))
        f["amount_vs_customer_avg"] = txn.amount / avg
        f["amount_zscore"] = (txn.amount - avg) / max(p["amount_std"], 0.01)

        # device / location novelty
        known_dev = set(p["known_devices"])
        if txn.device_id not in known_dev:
            dev_hist = self.txns.device_history(txn.device_id, limit=1)
            f["new_device"] = 0.0 if dev_hist else 1.0
        f["device_txn_count_prior"] = float(
            len(self.txns.device_history(txn.device_id, limit=200)))
        f["new_location"] = 1.0 if txn.location not in set(p["known_locations"]) else 0.0

        # merchant / account / time
        f["merchant_risk_score"] = self._merchant_risk(txn)
        f["merchant_category_risk"] = CATEGORY_RISK.get(txn.merchant_category, 0.05)
        if p["account_created_at"]:
            f["account_age_days"] = max((now - _ensure_aware(p["account_created_at"])).days, 0)
        f["customer_txn_count_30d"] = float(p["txn_count_30d"])
        f["customer_fraud_history"] = float(p["fraud_count"])

        hour = now.hour + now.minute / 60.0
        f["hour_sin"] = math.sin(2 * math.pi * hour / 24)
        f["hour_cos"] = math.cos(2 * math.pi * hour / 24)
        f["is_night"] = 1.0 if (now.hour <= 5 or now.hour == 23) else 0.0
        f["is_weekend"] = 1.0 if now.weekday() >= 5 else 0.0

        return {k: float(f[k]) for k in FEATURE_NAMES}

    # ---------- called AFTER scoring, by the inference service ----------
    def update_profile(self, txn: Transaction, fraud_probability: float) -> None:
        p = self._profile(txn)
        n = max(p["txn_count_30d"], 0)
        alpha = min(0.5, 1.0 / (n + 1))
        avg = (1 - alpha) * p["avg_amount"] + alpha * txn.amount
        std = 0.9 * p["amount_std"] + 0.1 * abs(txn.amount - avg)
        known_dev = set(p["known_devices"]) | {txn.device_id}
        known_loc = set(p["known_locations"]) | {txn.location}
        self.profiles.upsert_profile(
            txn.customer_id,
            avg_amount=float(avg), amount_std=float(std),
            txn_count_30d=n + 1,
            fraud_count=p["fraud_count"] + (1 if (fraud_probability or 0) > 0.8 else 0),
            known_devices=known_dev, known_locations=known_loc,
            last_txn_time=txn.timestamp, last_latitude=txn.latitude,
            last_longitude=txn.longitude,
            account_created_at=p["account_created_at"],
            current_risk_score=float(fraud_probability) * 100,
            risk_level="HIGH" if fraud_probability > 0.8 else "MEDIUM",
            updated_at=txn.timestamp)
        self.cache.set(f"profile:{txn.customer_id}", {
            "avg_amount": avg, "amount_std": std,
            "known_devices": list(known_dev), "known_locations": list(known_loc),
            "last_txn_time": txn.timestamp, "last_lat": txn.latitude,
            "last_lon": txn.longitude,
            "fraud_count": p["fraud_count"], "txn_count_30d": n + 1,
            "account_created_at": p["account_created_at"]}, PROFILE_TTL_S)