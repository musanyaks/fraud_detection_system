from common.schemas import RiskLevel
from models.ensemble import _reasons, _rule_boosts


def _base_features(**over):
    base = {"amount": 100, "log_amount": 4.6, "amount_vs_customer_avg": 1.0,
            "amount_zscore": 0.0, "txn_count_5m": 0, "txn_count_15m": 0,
            "implied_velocity_kmh": 0, "distance_from_prev_km": 0,
            "new_device": 0, "new_location": 0, "is_night": 0,
            "failed_txn_count_24h": 0, "merchant_risk_score": 0.03,
            "customer_fraud_history": 0}
    base.update(over)
    return base


def test_reasons_card_testing():
    reasons = _reasons(_base_features(txn_count_5m=8))
    assert any("card testing" in r for r, _ in reasons)


def test_reasons_impossible_travel():
    reasons = _reasons(_base_features(implied_velocity_kmh=1500,
                                      distance_from_prev_km=2000,
                                      time_since_last_txn_s=600))
    assert any("Impossible travel" in r for r, _ in reasons)


def test_rule_boost_monotonic():
    clean = _rule_boosts(_base_features())
    hot = _rule_boosts(_base_features(txn_count_5m=6, new_device=1,
                                      amount_vs_customer_avg=10,
                                      implied_velocity_kmh=900,
                                      distance_from_prev_km=1500))
    assert hot > clean >= 0


def test_risk_level_bands():
    assert RiskLevel.from_score(10) is RiskLevel.LOW
    assert RiskLevel.from_score(40) is RiskLevel.MEDIUM
    assert RiskLevel.from_score(65) is RiskLevel.HIGH
    assert RiskLevel.from_score(95) is RiskLevel.CRITICAL