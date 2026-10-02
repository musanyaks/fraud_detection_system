"""
Ensemble risk-scoring engine.

    supervised (XGBoost + LightGBM + RandomForest + LogisticRegression,
                weights derived from validation AUC)
        +
    anomaly   (Isolation Forest + MLP-autoencoder reconstruction error)
        +
    deterministic rule boosts
        ->
    fraud probability -> risk score 0-100 -> risk level -> human-readable reasons
"""
import json
import os
from dataclasses import replace
from datetime import datetime, timezone

import joblib
import numpy as np

from common.schemas import FraudAssessment, RiskLevel
from features.definitions import FEATURE_NAMES

W_SUPERVISED = 0.70
W_ANOMALY = 0.30


def _rule_boosts(f: dict) -> float:
    boost = 0.0
    if f["implied_velocity_kmh"] > 600 and f["distance_from_prev_km"] > 100:
        boost += 0.12
    if f["txn_count_5m"] >= 4:
        boost += 0.08
    if f["new_device"] == 1 and f["amount_vs_customer_avg"] >= 4:
        boost += 0.05
    return boost


def _reasons(f: dict) -> list[tuple[str, float]]:
    out = []
    if f["txn_count_5m"] >= 3:
        out.append((f"Velocity anomaly: {int(f['txn_count_5m'])} transactions in the "
                    f"last 5 minutes (possible card testing)", f["txn_count_5m"] / 10))
    if f["implied_velocity_kmh"] > 600 and f["distance_from_prev_km"] > 100:
        out.append((f"Impossible travel: {f['distance_from_prev_km']:.0f} km from the "
                    f"previous transaction {f['time_since_last_txn_s']/60:.0f} min ago",
                    1.0))
    if f["amount_vs_customer_avg"] >= 4:
        out.append((f"Amount is {f['amount_vs_customer_avg']:.1f}x the customer's "
                    f"average", f["amount_vs_customer_avg"] / 10))
    if f["amount_zscore"] >= 4:
        out.append((f"Amount deviates {f['amount_zscore']:.1f} sigma from the customer "
                    f"baseline", f["amount_zscore"] / 10))
    if f["new_device"] == 1 and f["amount"] >= 500:
        out.append(("High-value transaction from a never-seen device", 0.8))
    if f["new_location"] == 1 and f["is_night"] == 1:
        out.append(("First-seen location during night hours", 0.6))
    if f["failed_txn_count_24h"] >= 2:
        out.append((f"{int(f['failed_txn_count_24h'])} failed attempts in the 24h "
                    f"before this transaction", 0.7))
    if f["merchant_risk_score"] >= 0.15:
        out.append(("High-risk merchant (historical fraud rate)", 0.4))
    if f["customer_fraud_history"] >= 1:
        out.append(("Customer has prior confirmed fraud", 0.5))
    return sorted(out, key=lambda x: -x[1])[:4]


class EnsembleFraudDetector:
    """Loads the trained bundle and scores single feature vectors."""

    def __init__(self, artifacts_dir: str):
        path = os.path.join(artifacts_dir, "bundle.joblib")
        if not os.path.exists(path):
            raise FileNotFoundError(
                f"Model bundle not found at {path}. Run `python -m models.train` first.")
        bundle = joblib.load(path)
        self.models = bundle["models"]              # name -> estimator (proba-capable)
        self.weights = bundle["weights"]            # name -> float
        self.scaler = bundle["scaler"]              # StandardScaler (LR/AE space)
        self.iso = bundle.get("iso") or bundle.get("isolation_forest")
        self.iso_bounds = bundle["iso_bounds"]      # (min, max) of val anomaly score
        self.ae = bundle.get("autoencoder") or bundle.get("ae")             # MLPRegressor reconstructing X
        self.ae_ref = bundle["ae_ref"]              # {"median": , "p995": }
        self.threshold = bundle["threshold"]
        self.version = bundle["version"]
        self.feature_names = bundle["feature_names"]

    # ---------- anomaly scorers ----------
    def _iso_score(self, X: np.ndarray) -> np.ndarray:
        raw = -self.iso.decision_function(X)         # higher = more anomalous
        lo, hi = self.iso_bounds
        return np.clip((raw - lo) / max(hi - lo, 1e-9), 0.0, 1.0)

    def _ae_score(self, X: np.ndarray) -> np.ndarray:
        err = np.mean((X - self.ae.predict(X)) ** 2, axis=1)
        return np.clip(err / max(self.ae_ref["p995"], 1e-9), 0.0, 1.0)

    # ---------- main API ----------
    def predict(self, features: dict, transaction_id=None, customer_id=None) -> FraudAssessment:
        x = np.array([[float(features[k]) for k in self.feature_names]])
        x_scaled = self.scaler.transform(x)

        probas = {}
        for name, model in self.models.items():
            try:
                probas[name] = float(model.predict_proba(x)[0, 1])
            except Exception:
                X_in = x_scaled if name == "logistic_regression" else x
                probas[name] = float(model.predict_proba(X_in)[0, 1])
        wsum = sum(self.weights.values()) or 1.0
        supervised = sum(self.weights[n] * probas[n] for n in probas) / wsum

        anomaly = float(0.5 * self._iso_score(x_scaled)[0]
                        + 0.5 * self._ae_score(x_scaled)[0])

        prob = float(np.clip(W_SUPERVISED * supervised + W_ANOMALY * anomaly
                             + _rule_boosts(features), 0.001, 0.999))
        risk_score = round(prob * 100, 1)
        level = RiskLevel.from_score(risk_score)

        reasons = _reasons(features)
        top = dict(sorted(((k, float(features[k])) for k in
                           ("amount_vs_customer_avg", "txn_count_5m",
                            "implied_velocity_kmh", "new_device", "new_location",
                            "amount_zscore", "failed_txn_count_24h")),
                          key=lambda kv: -abs(kv[1]))[:3])

        return FraudAssessment(
            transaction_id=transaction_id, customer_id=customer_id,
            fraud_probability=round(prob, 4),
            supervised_score=round(float(supervised), 4),
            anomaly_score=round(anomaly, 4),
            risk_score=risk_score, risk_level=level,
            reasons=[r for r, _ in reasons],
            reason_weights={r: round(float(w), 3) for r, w in reasons},
            top_features=top,
            model_version=self.version,
            predicted_at=datetime.now(timezone.utc),
            is_alert=level in (RiskLevel.HIGH, RiskLevel.CRITICAL))