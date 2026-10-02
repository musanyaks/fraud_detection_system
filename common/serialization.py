import json
from datetime import datetime
from uuid import UUID

from common.schemas import Transaction, FraudAssessment, RiskLevel


def txn_from_json(payload: dict | str) -> Transaction:
    d = json.loads(payload) if isinstance(payload, (str, bytes)) else dict(payload)
    d["transaction_id"] = UUID(d["transaction_id"])
    d["customer_id"] = UUID(d["customer_id"])
    d["timestamp"] = datetime.fromisoformat(d["timestamp"])
    d["is_fraud"] = d.get("is_fraud")
    return Transaction(**d)


def txn_to_json(t: Transaction) -> str:
    return json.dumps(t.to_dict())


def assessment_to_json(a: FraudAssessment) -> dict:
    return {
        "transaction_id": str(a.transaction_id),
        "customer_id": str(a.customer_id),
        "fraud_probability": a.fraud_probability,
        "supervised_score": a.supervised_score,
        "anomaly_score": a.anomaly_score,
        "risk_score": a.risk_score,
        "risk_level": a.risk_level.value,
        "reasons": a.reasons,
        "model_version": a.model_version,
        "predicted_at": a.predicted_at.isoformat(),
        "is_alert": a.is_alert,
    }