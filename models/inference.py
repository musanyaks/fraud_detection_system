"""End-to-end real-time scoring service: features -> ensemble -> persistence -> alerts."""
import time
from datetime import datetime, timezone

import structlog

from common.metrics import (TXN_PROCESSED, TXN_FLAGGED, ALERTS_CREATED,
                            SCORING_LATENCY, LAST_PROCESSED, PIPELINE_ERRORS)
from common.schemas import Transaction
from common.config import settings
from data.validation.validators import validate_transaction, validate_features
from features.definitions import FEATURE_NAMES
from features.realtime_features import RealtimeFeatureService
from db.connection import CassandraConnection
from db.repositories import (TransactionRepository, PredictionRepository,
                                    AlertRepository, ProfileRepository)
from models.ensemble import EnsembleFraudDetector

log = structlog.get_logger()


class FraudDetectionService:
    def __init__(self, artifacts_dir: str | None = None):
        conn = CassandraConnection.get()
        self.txn_repo = TransactionRepository(conn)
        self.pred_repo = PredictionRepository(conn)
        self.alert_repo = AlertRepository(conn)
        self.features = RealtimeFeatureService(
            self.txn_repo, ProfileRepository(conn), settings.redis_url)
        self.detector = EnsembleFraudDetector(artifacts_dir or settings.artifacts_dir)
        log.info("inference_service_ready", model_version=self.detector.version)

    def process(self, txn: Transaction) -> "object":
        start = time.perf_counter()
        try:
            ok, errors = validate_transaction(txn.to_dict())
            if not ok:
                PIPELINE_ERRORS.inc()
                raise ValueError(f"invalid transaction: {errors}")

            feats = self.features.build_features(txn)
            ok, problems = validate_features(feats, FEATURE_NAMES)
            if not ok:
                log.warn("feature_validation_issues", issues=problems[:3])

            assessment = self.detector.predict(feats, txn.transaction_id, txn.customer_id)

            # persist: transaction (4 access paths), prediction + features, profile
            self.txn_repo.save(txn)
            self.pred_repo.save(txn, assessment, features=feats,
                                label=1 if txn.is_fraud else 0)
            self.features.update_profile(txn, assessment.fraud_probability)

            if assessment.is_alert:
                self.alert_repo.create(txn, assessment)
                ALERTS_CREATED.inc()
                TXN_FLAGGED.labels(risk_level=assessment.risk_level.value).inc()
                log.warning("fraud_alert_created",
                            transaction_id=str(txn.transaction_id),
                            risk_score=assessment.risk_score,
                            reasons=assessment.reasons)

            TXN_PROCESSED.inc()
            LAST_PROCESSED.set(datetime.now(timezone.utc).timestamp())
            SCORING_LATENCY.observe(time.perf_counter() - start)
            return assessment
        except ValueError:
            raise
        except Exception:
            PIPELINE_ERRORS.inc()
            log.exception("scoring_failed")
            raise