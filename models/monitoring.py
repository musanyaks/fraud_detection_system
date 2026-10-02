"""Population-Stability-Index drift monitoring against training reference stats."""
import json
import os
from datetime import datetime, timezone

import numpy as np

from common.config import settings
from db.connection import CassandraConnection
from db.repositories import PredictionRepository, MonitoringRepository

PSI_WARN, PSI_CRITICAL = 0.10, 0.25


def psi(expected_edges: list[float], actual: np.ndarray) -> float:
    edges = np.array(expected_edges, dtype=float)
    edges[0], edges[-1] = -np.inf, np.inf
    e_prop = np.diff(np.histogram(np.linspace(edges[1], edges[-2], 10_000),
                                 bins=edges)[0]) / 10_000
    a_prop = np.diff(np.histogram(actual, bins=edges)[0]) / max(len(actual), 1)
    e_prop, a_prop = np.clip(e_prop, 1e-4, None), np.clip(a_prop, 1e-4, None)
    return float(np.sum((a_prop - e_prop) * np.log(a_prop / e_prop)))


def run_drift_check(artifacts_dir: str | None = None, day: str | None = None) -> dict:
    artifacts_dir = artifacts_dir or settings.artifacts_dir
    day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with open(os.path.join(artifacts_dir, "reference_stats.json")) as fh:
        reference = json.load(fh)

    conn = CassandraConnection.get()
    rows = PredictionRepository(conn).sample_features(day, limit=5000)
    if len(rows) < 100:
        return {"status": "INSUFFICIENT_DATA", "samples": len(rows), "day": day}

    drifted, scores = {}, {}
    for feat, ref in reference.items():
        vals = np.array([r["features"].get(feat, ref["mean"]) for r in rows], dtype=float)
        score = psi(ref["edges"], vals)
        scores[feat] = round(score, 4)
        if score > PSI_WARN:
            drifted[feat] = score

    mon = MonitoringRepository(conn)
    version_row = mon.latest_version("fraud_ensemble")
    version = version_row["model_version"] if version_row else "unknown"
    mon.save_metrics("drift_monitor", version,
                     {"psi_mean": float(np.mean(list(scores.values()))),
                      "psi_max": float(max(scores.values())),
                      "features_drifted": len(drifted)})

    status = "CRITICAL_DRIFT" if max(scores.values()) > PSI_CRITICAL else \
             "WARN" if drifted else "OK"
    result = {"status": status, "day": day, "samples": len(rows),
              "drifted_features": dict(sorted(drifted.items(), key=lambda kv: -kv[1])[:10]),
              "psi": scores}
    print(json.dumps({k: result[k] for k in ("status", "day", "samples",
                                             "drifted_features")}, indent=2))
    return result


if __name__ == "__main__":
    run_drift_check()