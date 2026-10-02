"""
Batch (training-time) feature engineering.

Leakage policy (critical):
  * all per-customer aggregates use PRIOR transactions only (shift(1) / expanding / cumcount)
  * merchant risk rate is a trailing rate computed strictly before each row's timestamp
  * 'new_device'/'new_location' = first-ever occurrence at that point in time
"""
import numpy as np
import pandas as pd

from common.geoutils import haversine_km, implied_velocity_kmh
from features.definitions import FEATURE_NAMES, CATEGORY_RISK

LAPLACE_PRIOR = 20.0  # smoothing strength for merchant fraud rate


def build_training_dataframe(txns: list, customers: list) -> pd.DataFrame:
    rows, created = [], {c.customer_id: c.created_at for c in customers}
    for t in txns:
        rows.append({
            "transaction_id": t.transaction_id, "customer_id": t.customer_id,
            "timestamp": t.timestamp, "amount": t.amount, "merchant_id": t.merchant_id,
            "merchant_category": t.merchant_category, "device_id": t.device_id,
            "location": t.location, "latitude": t.latitude, "longitude": t.longitude,
            "channel": t.channel, "status": t.status, "is_fraud": bool(t.is_fraud),
            "customer_created_at": created.get(t.customer_id),
        })
    return pd.DataFrame(rows)


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    # ---------- pass 1: merchant risk (time-ordered, trailing only) ----------
    df = df.sort_values("timestamp").reset_index(drop=True)
    y = df["is_fraud"].astype(int)
    global_rate = y.mean() if len(y) else 0.0
    prior_fraud = df.groupby("merchant_id", sort=False)["is_fraud"].cumsum() - y
    prior_n = df.groupby("merchant_id", sort=False).cumcount()
    df["merchant_risk_score"] = (prior_fraud + LAPLACE_PRIOR * global_rate) \
        / (prior_n + LAPLACE_PRIOR)

    # ---------- pass 2: per-customer sequential features ----------
    df = df.sort_values(["customer_id", "timestamp"]).reset_index(drop=True)
    g = df.groupby("customer_id", sort=False)
    prev = g.shift(1)

    dt_s = (df["timestamp"] - prev["timestamp"]).dt.total_seconds()
    df["time_since_last_txn_s"] = dt_s

    dist = haversine_km(df["latitude"].values, df["longitude"].values,
                        prev["latitude"].values, prev["longitude"].values)
    df["distance_from_prev_km"] = np.nan_to_num(dist, nan=0.0)
    df["implied_velocity_kmh"] = [
        implied_velocity_kmh(d, s) for d, s in
        zip(df["distance_from_prev_km"], dt_s.fillna(0))]

    # prior amount statistics (expanding, shifted -> excludes current row)
    prior_amount = g["amount"].shift(1)
    exp = prior_amount.groupby(df["customer_id"], sort=False).expanding()
    df["cust_avg_prior"] = exp.mean().to_numpy()
    df["cust_std_prior"] = exp.std().to_numpy()
    df["cust_avg_prior"] = df["cust_avg_prior"].fillna(df["amount"].mean())
    df["cust_std_prior"] = df["cust_std_prior"].fillna(df["cust_std_prior"].mean() or 1.0)

    df["amount_vs_customer_avg"] = df["amount"] / df["cust_avg_prior"].clip(lower=0.01)
    df["amount_zscore"] = (df["amount"] - df["cust_avg_prior"]) \
        / df["cust_std_prior"].clip(lower=0.01)

    # first-ever occurrences == exactly what the online service checks
    df["new_device"] = (df.groupby(["customer_id", "device_id"],
                                   sort=False).cumcount() == 0).astype(int)
    df["new_location"] = (df.groupby(["customer_id", "location"],
                                     sort=False).cumcount() == 0).astype(int)
    df["device_txn_count_prior"] = df.groupby("device_id", sort=False).cumcount().astype(float)
    df["customer_fraud_history"] = (g["is_fraud"].cumsum() - y).astype(float)

    # ---------- pass 3: time-window features (per-customer rolling) ----------
    # df is sorted by (customer_id, timestamp); groupby(sort=False) + rolling(on=...)
    # preserves row order, so `.to_numpy()` aligns with df rows.
    for win, name in [("5min", "txn_count_5m"), ("15min", "txn_count_15m"),
                      ("60min", "txn_count_60m"), ("24h", "txn_count_24h"),
                      ("30D", "customer_txn_count_30d")]:
        roll = df.groupby("customer_id", sort=False).rolling(win, on="timestamp")["amount"]
        df[name] = roll.count().to_numpy() - 1
    df["sum_amount_15m"] = (
        df.groupby("customer_id", sort=False)
          .rolling("15min", on="timestamp")["amount"].sum().to_numpy() - df["amount"])
    df["sum_amount_15m"] = df["sum_amount_15m"].clip(lower=0)

    df["_failed"] = (df["status"] == "failed").astype(float)
    df["failed_txn_count_24h"] = (
        df.groupby("customer_id", sort=False)
          .rolling("24h", on="timestamp")["_failed"].sum().to_numpy() - df["_failed"])
    df["failed_txn_count_24h"] = df["failed_txn_count_24h"].clip(lower=0)

    # ---------- pass 4: time / static features ----------
    hours = df["timestamp"].dt.hour + df["timestamp"].dt.minute / 60.0
    df["hour_sin"] = np.sin(2 * np.pi * hours / 24)
    df["hour_cos"] = np.cos(2 * np.pi * hours / 24)
    h = df["timestamp"].dt.hour
    df["is_night"] = ((h <= 5) | (h == 23)).astype(int)
    df["is_weekend"] = (df["timestamp"].dt.dayofweek >= 5).astype(int)
    df["log_amount"] = np.log1p(df["amount"].clip(lower=0))
    df["merchant_category_risk"] = df["merchant_category"].map(CATEGORY_RISK).fillna(0.05)
    df["account_age_days"] = (df["timestamp"] - df["customer_created_at"]).dt.days \
        .clip(lower=0)

    # ---------- assemble + defaults ----------
    for col, default in {
        "time_since_last_txn_s": -1.0, "implied_velocity_kmh": 0.0,
        "customer_txn_count_30d": 0.0, "amount_vs_customer_avg": 1.0,
        "amount_zscore": 0.0, "merchant_risk_score": global_rate,
    }.items():
        df[col] = df[col].fillna(default)

    return df


def get_feature_matrix(df: pd.DataFrame) -> pd.DataFrame:
    return df[FEATURE_NAMES].astype(float)