FEATURE_NAMES = [
    "amount", "log_amount", "amount_vs_customer_avg", "amount_zscore",
    "txn_count_5m", "txn_count_15m", "txn_count_60m", "txn_count_24h",
    "sum_amount_15m", "failed_txn_count_24h",
    "time_since_last_txn_s", "distance_from_prev_km", "implied_velocity_kmh",
    "new_device", "new_location", "device_txn_count_prior",
    "merchant_risk_score", "merchant_category_risk",
    "account_age_days", "customer_txn_count_30d", "customer_fraud_history",
    "hour_sin", "hour_cos", "is_night", "is_weekend",
]

CATEGORY_RISK = {
    "grocery": 0.02, "restaurant": 0.03, "retail": 0.04, "fuel": 0.03,
    "electronics": 0.12, "jewelry": 0.18, "travel": 0.08, "entertainment": 0.05,
    "online_services": 0.15, "atm_cash": 0.10, "gambling": 0.30, "crypto": 0.35,
}

FEATURE_DEFAULTS = {
    "amount": 0.0, "log_amount": 0.0, "amount_vs_customer_avg": 1.0, "amount_zscore": 0.0,
    "txn_count_5m": 0.0, "txn_count_15m": 0.0, "txn_count_60m": 0.0, "txn_count_24h": 0.0,
    "sum_amount_15m": 0.0, "failed_txn_count_24h": 0.0,
    "time_since_last_txn_s": -1.0, "distance_from_prev_km": 0.0,
    "implied_velocity_kmh": 0.0, "new_device": 0.0, "new_location": 0.0,
    "device_txn_count_prior": 0.0, "merchant_risk_score": 0.05,
    "merchant_category_risk": 0.05, "account_age_days": 0.0,
    "customer_txn_count_30d": 0.0, "customer_fraud_history": 0.0,
    "hour_sin": 0.0, "hour_cos": 0.0, "is_night": 0.0, "is_weekend": 0.0,
}