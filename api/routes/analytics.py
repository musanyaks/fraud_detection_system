import time as _time
from datetime import datetime, timedelta, timezone

import pandas as pd
from fastapi import APIRouter, Depends

from api.authentication.auth import get_current_user
from db.repositories.transactions import TransactionRepository
from db.repositories.fraud import PredictionRepository

router = APIRouter(prefix="/api/v1/metrics", tags=["analytics"])

DAY = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d")

_CACHE: dict = {}
_TTL = 30.0


def _cached(key, fn):
    now = _time.monotonic()
    hit = _CACHE.get(key)
    if hit and now - hit[0] < _TTL:
        return hit[1]
    try:
        val = fn()
    except Exception:
        if hit:
            return hit[1]        # stale beats a 500 during Cassandra hiccups
        raise
    _CACHE[key] = (now, val)
    return val


def _top(series, n=8):
    if not len(series):
        return []
    return [{"name": str(k), "count": int(v)}
            for k, v in series.value_counts().head(n).items()]


def _daily_series(txn_repo, pred_repo):
    """7-day volume + flagged-rate series from exact day-partition counts."""
    now = datetime.now(timezone.utc)
    out = []
    for i in range(6, -1, -1):
        d = now - timedelta(days=i)
        ds = d.strftime("%Y-%m-%d")
        vol = txn_repo.count_by_day(ds)              # txns by txn-time (bar)
        scored = pred_repo.count_by_day(ds)          # preds by processing-time (line base)
        flagged = pred_repo.flagged_count_by_day(ds)
        out.append({"day": f"{d:%b} {d.day}", "volume": vol,
                    "flagged": flagged,
                    "fraud_rate": round(flagged / scored, 4) if scored else 0.0})
    return out


def _analytics_impl():
    day = DAY()
    txn_repo = TransactionRepository()
    pred_repo = PredictionRepository()

    txns = pd.DataFrame(txn_repo.recent_by_day(day, 2000))
    preds = pd.DataFrame(pred_repo.recent_by_day(day, 2000))

    # hourly (today)
    hourly = []
    if len(txns):
        t = txns.copy()
        t["hour"] = pd.to_datetime(t["transaction_time"]).dt.hour
        g = t.groupby("hour").agg(volume=("amount", "size"),
                                  fraud=("is_fraud", "sum"),
                                  value=("amount", "sum")).reset_index()
        g["fraud_rate"] = (g["fraud"] / g["volume"].clip(lower=1)).round(4)
        hourly = g.astype({"volume": int, "fraud": int}).to_dict("records")

    # risk distribution (today)
    dist = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    if len(preds):
        for k, v in preds["risk_level"].value_counts().items():
            dist[str(k)] = int(v)

    flagged = preds[preds["risk_level"].isin(["HIGH", "CRITICAL"])] if len(preds) else preds

    # top risk customers
    top_cust = []
    if len(preds):
        g = preds.groupby("customer_id").agg(
            risk_score=("risk_score", "max"), amount=("amount", "sum"))
        top_cust = g.sort_values("risk_score", ascending=False).head(5).reset_index()
        top_cust["risk_level"] = top_cust["risk_score"].apply(
            lambda s: "LOW" if s < 30 else "MEDIUM" if s < 55
            else "HIGH" if s < 80 else "CRITICAL")
        top_cust = top_cust.round(1).to_dict("records")

    # geo points (flagged joins txn lat/lon)
    geo_points = []
    if len(preds) and len(txns):
        tt = txns[["transaction_id", "latitude", "longitude"]].dropna()
        m = flagged.merge(tt, on="transaction_id", how="inner")
        if len(m):
            g = m.groupby("location").agg(
                lat=("latitude", "mean"), lon=("longitude", "mean"),
                count=("transaction_id", "size"),
                max_score=("risk_score", "max")).reset_index()
            geo_points = g.round(2).to_dict("records")

    # canonical 5-channel mix, zero-filled
    CANON = ["pos", "bank", "online", "mobile", "atm"]
    ch = txns["channel"].value_counts() if len(txns) else pd.Series(dtype=int)
    channel_mix = [{"name": c, "count": int(ch.get(c, 0))} for c in CANON]

    # top merchants by transaction value (today's sample)
    top_merchants = []
    if len(txns):
        g = txns.groupby("merchant_name")["amount"].sum()\
                .sort_values(ascending=False).head(6)
        top_merchants = [{"name": str(k), "value": round(float(v), 2)}
                         for k, v in g.items()]

    # per-channel daily counts (last 7 day-partitions, sampled) for the
    # multi-line time series
    CANON = ["pos", "online", "mobile", "bank", "atm"]
    LABELS = {"pos": "Card Payment", "online": "Online Purchase",
              "mobile": "Mobile Money", "bank": "Bank Transfer",
              "atm": "ATM Withdrawal"}
    now = datetime.now(timezone.utc)
    channel_daily = []
    for i in range(6, -1, -1):
        dt = now - timedelta(days=i)
        ds = dt.strftime("%Y-%m-%d")
        row = {"day": f"{dt:%b} {dt.day}"}
        try:
            day_txns = pd.DataFrame(txn_repo.recent_by_day(ds, 500))
            counts = day_txns["channel"].value_counts() if len(day_txns) else {}
        except Exception:
            counts = {}
        for c in CANON:
            row[LABELS[c]] = int(counts.get(c, 0))
        channel_daily.append(row)

    return {
        "day": day,
        "daily": _daily_series(txn_repo, pred_repo),
        "hourly": hourly,
        "risk_distribution": dist,
        "fraud_by_category": _top(flagged["merchant_category"]) if len(flagged) else [],
        "fraud_by_type": _top(flagged["fraud_type"].fillna("Other")) if len(flagged) else [],
        "fraud_by_type": _top(flagged["fraud_type"].fillna("Other")) if len(flagged) else [],
        "fraud_by_location": _top(flagged["location"]) if len(flagged) else [],
        "channel_mix": channel_mix,
        "top_risk_customers": top_cust,
        "top_merchants": top_merchants,
        "channel_daily": channel_daily,
        "geo_points": geo_points,
    }


@router.get("/analytics")
def analytics(user: dict = Depends(get_current_user)):
    return _cached("analytics", _analytics_impl)
