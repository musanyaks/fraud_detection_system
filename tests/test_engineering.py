import pytest
import pandas as pd
from datetime import datetime, timedelta, timezone

from features.engineering import engineer_features
from features.definitions import FEATURE_NAMES


def _tiny_df():
    now = datetime.now(timezone.utc)
    rows = []
    cust, dev = "c1", "d1"
    for i in range(6):
        rows.append(dict(transaction_id=f"t{i}", customer_id=cust,
                         timestamp=now + timedelta(minutes=10 * i),
                         amount=100.0, merchant_id="m1", merchant_category="retail",
                         device_id=dev, location="Berlin", latitude=52.5,
                         longitude=13.4, channel="pos", status="approved",
                         is_fraud=False, customer_created_at=now - timedelta(days=365)))
    for i in range(5):
        rows.append(dict(transaction_id=f"f{i}", customer_id=cust,
                         timestamp=now + timedelta(minutes=61, seconds=i * 20),
                         amount=5.0, merchant_id="m1", merchant_category="retail",
                         device_id="d-new", location="Berlin", latitude=52.5,
                         longitude=13.4, channel="online", status="approved",
                         is_fraud=True, customer_created_at=now - timedelta(days=365)))
    return pd.DataFrame(rows)


def test_no_nan_features():
    out = engineer_features(_tiny_df())
    assert out[FEATURE_NAMES].isna().sum().sum() == 0


def test_velocity_and_new_device():
    out = engineer_features(_tiny_df())

    # f0 is the first-ever use of d-new
    f0 = out[out["transaction_id"] == "f0"].iloc[0]
    assert f0["new_device"] == 1
    assert f0["device_txn_count_prior"] == 0

    # f2 is mid-burst: two prior burst txns inside 5 minutes, device already seen
    f2 = out[out["transaction_id"] == "f2"].iloc[0]
    assert f2["txn_count_5m"] >= 2
    assert f2["new_device"] == 0
    assert f2["device_txn_count_prior"] == 2

    # the first legit row is also a first-use of d1
    t0 = out[out["transaction_id"] == "t0"].iloc[0]
    assert t0["new_device"] == 1
    assert t0["customer_fraud_history"] == 0


def test_merchant_risk_is_trailing_not_leaky():
    out = engineer_features(_tiny_df()).sort_values("timestamp").reset_index(drop=True)

    # 11 rows, 5 frauds -> global rate 5/11 is the smoothing prior
    prior = 20 * (5 / 11)

    # row 0 has no history: score equals the smoothed prior exactly
    assert out.iloc[0]["merchant_risk_score"] == pytest.approx(prior / 20, abs=1e-9)

    # f0 IS the first fraud, yet its own label must be excluded (trailing):
    #   zero prior frauds over 6 prior rows -> (0 + prior) / (6 + 20)
    f0 = out[out["transaction_id"] == "f0"].iloc[0]
    assert f0["merchant_risk_score"] == pytest.approx(prior / (6 + 20), abs=1e-6)

    # by f4, exactly 4 prior frauds over 10 prior rows are visible
    f4 = out[out["transaction_id"] == "f4"].iloc[0]
    assert f4["merchant_risk_score"] == pytest.approx((4 + prior) / (10 + 20), abs=1e-6)


def test_leakage_guard_fraud_history():
    out = engineer_features(_tiny_df())
    fraud_rows = out[out["is_fraud"]]
    prior = out[out["timestamp"] < fraud_rows["timestamp"].min()]
    assert prior["is_fraud"].sum() == 0
