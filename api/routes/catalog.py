import os
from datetime import datetime, timedelta, timezone
from uuid import UUID

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query

from api.authentication.auth import get_current_user
from common.config import settings
from common.schemas import RiskLevel
from common.serialization import txn_from_json
from db.repositories import (TransactionRepository, PredictionRepository,
                                    ProfileRepository, MonitoringRepository, AlertRepository)

router = APIRouter(prefix="/api/v1", tags=["catalog"])

DAY = lambda: datetime.now(timezone.utc).strftime("%Y-%m-%d")

_OVH_CACHE: dict = {}
_OVH_TTL = 15.0


@router.get("/health")
def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat()}


# ---------------- transactions ----------------
@router.post("/transactions/score")
def score_transaction(payload: dict, user: dict = Depends(get_current_user)):
    """Synchronous scoring of a single transaction (full pipeline)."""
    from models.inference import FraudDetectionService
    svc: FraudDetectionService = router.app_state["inference"]
    txn = txn_from_json(payload)
    a = svc.process(txn)
    from common.serialization import assessment_to_json
    return assessment_to_json(a)


@router.get("/transactions/recent")
def recent_transactions(limit: int = Query(200, le=1000),
                        day: str | None = None,
                        user: dict = Depends(get_current_user)):
    rows = TransactionRepository().recent_by_day(day or DAY(), limit)
    return pd.DataFrame(rows).to_dict("records") if rows else []


@router.get("/predictions/recent")
def recent_predictions(limit: int = Query(300, le=2000),
                       day: str | None = None,
                       user: dict = Depends(get_current_user)):
    rows = PredictionRepository().recent_by_day(day or DAY(), limit)
    return pd.DataFrame(rows).to_dict("records") if rows else []


@router.get("/predictions/{transaction_id}")
def prediction(transaction_id: UUID, user: dict = Depends(get_current_user)):
    row = PredictionRepository().get_by_transaction(transaction_id)
    if not row:
        raise HTTPException(404, "prediction not found")
    return row


# ---------------- customers ----------------
@router.get("/customers")
def customers(limit: int = 100, user: dict = Depends(get_current_user)):
    rows = ProfileRepository().list_customers(limit)
    return [{k: (str(v) if isinstance(v, UUID) else v) for k, v in r.items()}
            for r in rows]


@router.get("/customers/{customer_id}/profile")
def customer_profile(customer_id: UUID, user: dict = Depends(get_current_user)):
    repo = ProfileRepository()
    prof = repo.get_profile(customer_id)
    cust = repo.get_customer(customer_id)
    if not prof and not cust:
        raise HTTPException(404, "customer not found")
    return {"customer": cust, "profile": prof}


@router.get("/customers/{customer_id}/transactions")
def customer_transactions(customer_id: UUID, limit: int = 50,
                          user: dict = Depends(get_current_user)):
    from datetime import timedelta
    now = datetime.now(timezone.utc)
    rows = TransactionRepository().customer_window(
        customer_id, now - timedelta(days=30), now, limit)
    return pd.DataFrame(rows).to_dict("records") if rows else []


@router.get("/customers/{customer_id}/predictions")
def customer_predictions(customer_id: UUID, days: int = 7,
                         user: dict = Depends(get_current_user)):
    rows = PredictionRepository().by_customer(customer_id, days)
    return pd.DataFrame(rows).to_dict("records") if rows else []


# ---------------- overview metrics ----------------
@router.get("/metrics/overview")
def overview(user: dict = Depends(get_current_user)):
    day = DAY()
    txn_repo, pred_repo = TransactionRepository(), PredictionRepository()

    # 10s TTL cache — heavy exact-count queries, polled by two dashboards
    now_ts = datetime.now(timezone.utc).timestamp()
    hit = _OVH_CACHE.get(day)
    if hit and now_ts - hit[0] < _OVH_TTL:
        total, flagged_rows = hit[1], hit[2]
    else:
        try:
            total = txn_repo.count_by_day(day)
            flagged_rows = pred_repo.flagged_by_day(day)
            _OVH_CACHE[day] = (now_ts, total, flagged_rows)
        except Exception:
            if hit:                          # serve stale on Cassandra timeout
                total, flagged_rows = hit[1], hit[2]
            else:
                raise

    alerts = AlertRepository().list("OPEN", 1000)
    recent = txn_repo.recent_by_day(day, 1000)

    # yesterday's counters for the dashboard deltas
    yday = (datetime.now(timezone.utc) - timedelta(days=1)).strftime("%Y-%m-%d")
    y_total = txn_repo.count_by_day(yday)
    y_scored = pred_repo.count_by_day(yday)
    y_flagged = pred_repo.flagged_count_by_day(yday)
    sampled_volume = float(sum(r.get("amount") or 0 for r in recent))

    return {
        "day": day,
        "total_transactions": total,
        "fraud_detected": len(flagged_rows),
        "fraud_rate": round(len(flagged_rows) / total, 4) if total else 0.0,
        "amount_at_risk": round(sum(float(r.get("amount") or 0)
                                    for r in flagged_rows), 2),
        "high_risk_customers": len({str(r["customer_id"]) for r in flagged_rows}),
        "open_alerts": len(alerts),
        "critical_alerts": sum(1 for a in alerts if a["severity"] == "CRITICAL"),
        "total_amount": round(sampled_volume, 2),
        "yesterday_total": y_total,
        "yesterday_fraud_detected": y_flagged,
        "yesterday_fraud_rate": round(y_flagged / y_scored, 4) if y_scored else 0.0,
    }


@router.get("/models/metrics")
def model_metrics(user: dict = Depends(get_current_user)):
    mon = MonitoringRepository()
    latest = mon.latest_version("fraud_ensemble")
    if not latest:
        return {"registry": None, "metrics": []}
    return {"registry": {k: str(v) for k, v in latest.items()},
            "metrics": mon.get_metrics("fraud_ensemble", latest["model_version"])}


@router.get("/models/evaluation")
def model_evaluation(user: dict = Depends(get_current_user)):
    path = os.path.join(settings.artifacts_dir, "evaluation.json")
    if not os.path.exists(path):
        raise HTTPException(404, "no evaluation artifact — run training")
    with open(path) as fh:
        return json.load(fh)


import json  # noqa: E402  (used above)

_CUST_CACHE: dict = {}
_CUST_TTL = 30.0


@router.get("/customers/summary")
def customers_summary(user: dict = Depends(get_current_user)):
    """All customers enriched with profile-derived risk/activity fields."""
    import time as _t
    now = _t.monotonic()
    hit = _CUST_CACHE.get("rows")
    if hit and now - hit[0] < _CUST_TTL:
        return hit[1]

    repo = ProfileRepository()
    rows = []
    dist = {"LOW": 0, "MEDIUM": 0, "HIGH": 0, "CRITICAL": 0}
    for c in repo.list_customers(500):
        prof = repo.get_profile(c["customer_id"]) or {}
        score = float(prof.get("current_risk_score") or 0)
        lvl = ("LOW" if score < 30 else "MEDIUM" if score < 55
               else "HIGH" if score < 80 else "CRITICAL")
        dist[lvl] += 1
        last = prof.get("last_txn_time")
        active = bool(last) and (datetime.now(timezone.utc) - last).total_seconds() < 172800
        cnt = int(prof.get("txn_count_30d") or 0)
        avg = float(prof.get("avg_amount") or 0)
        rows.append({
            "customer_id": str(c["customer_id"]),
            "name": c.get("name") or "Unknown",
            "email": c.get("email") or "",
            "city": c.get("home_city") or "", "country": c.get("home_country") or "",
            "risk_level": lvl, "risk_score": round(score, 1),
            "txn_count": cnt,
            "total_spent": round(avg * cnt, 2),
            "avg_amount": round(avg, 2),
            "last_activity": last.isoformat() if last else None,
            "status": "Active" if active else "Inactive",
        })
    rows.sort(key=lambda r: -r["risk_score"])

    txns = pd.DataFrame(TransactionRepository().recent_by_day(DAY(), 2000))
    cats = []
    if len(txns):
        g = txns.groupby("merchant_category")["amount"].sum()\
                .sort_values(ascending=False).head(5)
        tot = float(txns["amount"].sum()) or 1.0
        cats = [{"name": str(k), "share": round(100 * v / tot, 1)} for k, v in g.items()]

    out = {"distribution": dist, "rows": rows, "top_categories": cats}
    _CUST_CACHE["rows"] = (now, out)
    return out


_FI_CACHE: dict = {}


@router.get("/models/feature-importance")
def feature_importance(user: dict = Depends(get_current_user)):
    """Real XGBoost feature importances from the loaded ensemble bundle."""
    svc = getattr(router, "app_state", None)
    svc = getattr(svc, "inference", None) if svc else None
    if svc is None:
        raise HTTPException(404, "model not loaded")
    model = svc.detector.models.get("xgboost")
    if model is None or not hasattr(model, "feature_importances_"):
        raise HTTPException(404, "feature importances unavailable")

    hit = _FI_CACHE.get("v")
    if hit:
        return hit
    names = svc.detector.feature_names
    pairs = sorted(zip(names, model.feature_importances_),
                   key=lambda x: -float(x[1]))[:10]
    out = {"features": [{"name": n, "share": round(float(v) * 100, 1)}
                        for n, v in pairs]}
    _FI_CACHE["v"] = out
    return out


@router.get("/models/drift")
def drift(user: dict = Depends(get_current_user)):
    """Run PSI drift check against training reference distributions."""
    from models.monitoring import run_drift_check
    try:
        return run_drift_check()
    except FileNotFoundError:
        raise HTTPException(404, "reference stats missing - run training")
    except Exception as e:
        raise HTTPException(500, f"drift check failed: {e}")
