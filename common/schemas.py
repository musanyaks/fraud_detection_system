from __future__ import annotations
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
from uuid import UUID


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

    @staticmethod
    def from_score(score: float) -> "RiskLevel":
        if score < 30:
            return RiskLevel.LOW
        if score < 55:
            return RiskLevel.MEDIUM
        if score < 80:
            return RiskLevel.HIGH
        return RiskLevel.CRITICAL


ALERT_STATUSES = ("OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE")


@dataclass(slots=True)
class Transaction:
    transaction_id: UUID
    customer_id: UUID
    timestamp: datetime
    amount: float
    merchant_id: str
    merchant_name: str
    merchant_category: str
    channel: str                 # pos | online | atm
    card_present: bool
    device_id: str
    device_type: str
    ip_address: str
    latitude: float
    longitude: float
    location: str
    country: str
    currency: str = "USD"
    status: str = "approved"     # approved | declined | failed
    is_fraud: bool | None = None  # ground-truth label (simulator/backfill only)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["transaction_id"] = str(self.transaction_id)
        d["customer_id"] = str(self.customer_id)
        d["timestamp"] = self.timestamp.isoformat()
        return d


@dataclass(slots=True)
class FraudAssessment:
    transaction_id: UUID
    customer_id: UUID
    fraud_probability: float
    supervised_score: float
    anomaly_score: float
    risk_score: float
    risk_level: RiskLevel
    reasons: list[str]
    reason_weights: dict[str, float]
    top_features: dict[str, float]
    model_version: str
    predicted_at: datetime
    is_alert: bool = False