"""
Training pipeline:
  generate history -> engineer features (leak-free) -> TIME-BASED split ->
  train XGBoost / LightGBM / RandomForest / LogisticRegression + IsolationForest
  + MLP-autoencoder -> derive ensemble weights from validation AUC ->
  evaluate on the untouched test window -> persist bundle + evaluation +
  reference stats (drift) -> log to MLflow -> register in Cassandra.
"""
import json
import os
from datetime import datetime, timezone

import joblib
import mlflow
import numpy as np
import pandas as pd
from lightgbm import LGBMClassifier
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, confusion_matrix,
                             precision_recall_curve, precision_score, recall_score,
                             f1_score, roc_auc_score, roc_curve)
from sklearn.neural_network import MLPRegressor
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

from common.config import settings
from data.ingestion.generator import FraudTransactionGenerator
from features.engineering import build_training_dataframe, engineer_features
from features.definitions import FEATURE_NAMES

RANDOM_STATE = 42


def _time_split(df, train_q=0.80, val_q=0.90):
    t1, t2 = df["timestamp"].quantile(train_q), df["timestamp"].quantile(val_q)
    return (df[df["timestamp"] < t1],
            df[(df["timestamp"] >= t1) & (df["timestamp"] < t2)],
            df[df["timestamp"] >= t2])


def _supervised_models(y_train):
    spw = float((y_train == 0).sum() / max((y_train == 1).sum(), 1))
    return {
        "xgboost": XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1,
                                 subsample=0.8, colsample_bytree=0.8,
                                 scale_pos_weight=spw, eval_metric="auc",
                                 tree_method="hist", random_state=RANDOM_STATE,
                                 verbosity=0),
        "lightgbm": LGBMClassifier(n_estimators=300, num_leaves=63, learning_rate=0.1,
                                   subsample=0.8, colsample_bytree=0.8,
                                   scale_pos_weight=spw, random_state=RANDOM_STATE,
                                   verbosity=-1),
        "random_forest": RandomForestClassifier(n_estimators=300, min_samples_leaf=5,
                                                class_weight="balanced_subsample",
                                                n_jobs=-1, random_state=RANDOM_STATE),
        "logistic_regression": LogisticRegression(max_iter=2000,
                                                  class_weight="balanced",
                                                  random_state=RANDOM_STATE),
    }


def _evaluate(y, proba, threshold):
    pred = (proba >= threshold).astype(int)
    fpr, tpr, _ = roc_curve(y, proba)
    prec, rec, _ = precision_recall_curve(y, proba)
    step = max(len(fpr) // 200, 1)
    return {
        "roc_auc": float(roc_auc_score(y, proba)),
        "pr_auc": float(average_precision_score(y, proba)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "confusion_matrix": confusion_matrix(y, pred).tolist(),
        "roc_points": {"fpr": np.round(fpr[::step], 4).tolist(),
                       "tpr": np.round(tpr[::step], 4).tolist()},
        "pr_points": {"recall": np.round(rec[::step], 4).tolist(),
                      "precision": np.round(prec[::step], 4).tolist()},
    }


def train(artifacts_dir: str = settings.artifacts_dir, n_customers: int = 300,
          days: int = 60, fraud_rate: float = 0.025) -> dict:
    os.makedirs(artifacts_dir, exist_ok=True)
    version = f"ensemble-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

    # ---------- data ----------
    gen = FraudTransactionGenerator(n_customers=n_customers, seed=RANDOM_STATE)
    txns = gen.generate_history(days=days, fraud_rate=fraud_rate)
    df = engineer_features(build_training_dataframe(txns, gen.customers))
    print(f"[train] dataset: {len(df):,} transactions, "
          f"{df['is_fraud'].mean():.2%} fraud, {len(FEATURE_NAMES)} features")

    train_df, val_df, test_df = _time_split(df)
    X_train = train_df[FEATURE_NAMES].astype(float).values
    X_val = val_df[FEATURE_NAMES].astype(float).values
    X_test = test_df[FEATURE_NAMES].astype(float).values
    y_train, y_val, y_test = (train_df["is_fraud"].astype(int).values,
                              val_df["is_fraud"].astype(int).values,
                              test_df["is_fraud"].astype(int).values)

    scaler = StandardScaler().fit(X_train)
    X_train_s, X_val_s = scaler.transform(X_train), scaler.transform(X_val)

    # ---------- supervised ----------
    models, val_auc = {}, {}
    for name, model in _supervised_models(y_train).items():
        X = X_train_s if name == "logistic_regression" else X_train
        Xv = X_val_s if name == "logistic_regression" else X_val
        model.fit(X, y_train)
        p = model.predict_proba(Xv)[:, 1]
        val_auc[name] = roc_auc_score(y_val, p)
        models[name] = model
        print(f"[train] {name:22s} val AUC = {val_auc[name]:.4f}")

    # ensemble weights ∝ (AUC - 0.5): better models dominate
    weights = {n: max(a - 0.5, 0.01) for n, a in val_auc.items()}
    sup_val = sum(weights[n] * models[n].predict_proba(
        X_val_s if n == "logistic_regression" else X_val)[:, 1]
        for n in models) / sum(weights.values())

    # ---------- unsupervised ----------
    iso = IsolationForest(n_estimators=200, contamination=fraud_rate,
                          random_state=RANDOM_STATE, n_jobs=-1).fit(X_train_s)
    iso_raw_val = -iso.decision_function(X_val_s)
    iso_bounds = (float(iso_raw_val.min()), float(iso_raw_val.max()))

    normal_mask = y_train == 0
    ae = MLPRegressor(hidden_layer_sizes=(16, 8, 16), activation="relu",
                      max_iter=200, early_stopping=True,
                      random_state=RANDOM_STATE).fit(X_train_s[normal_mask],
                                                     X_train_s[normal_mask])
    ae_err_val = np.mean((X_val_s - ae.predict(X_val_s)) ** 2, axis=1)
    ae_ref = {"median": float(np.median(ae_err_val)),
              "p995": float(np.quantile(ae_err_val, 0.995))}

    # ---------- threshold on validation ----------
    anomaly_val = 0.5 * np.clip(
        (iso_raw_val - iso_bounds[0]) / max(iso_bounds[1] - iso_bounds[0], 1e-9), 0, 1) \
        + 0.5 * np.clip(ae_err_val / max(ae_ref["p995"], 1e-9), 0, 1)
    blend_val = 0.7 * sup_val + 0.3 * anomaly_val
    prec, rec, thr = precision_recall_curve(y_val, blend_val)
    f1 = 2 * prec * rec / (prec + rec + 1e-9)
    threshold = float(thr[int(np.argmax(f1[:-1]))]) if len(thr) else 0.5

    # ---------- test evaluation ----------
    sup_test = sum(weights[n] * models[n].predict_proba(
        X_test if n != "logistic_regression" else scaler.transform(X_test))[:, 1]
        for n in models) / sum(weights.values())
    iso_raw_test = -iso.decision_function(scaler.transform(X_test))
    ae_err_test = np.mean((scaler.transform(X_test) - ae.predict(
        scaler.transform(X_test))) ** 2, axis=1)
    anomaly_test = 0.5 * np.clip(
        (iso_raw_test - iso_bounds[0]) / max(iso_bounds[1] - iso_bounds[0], 1e-9), 0, 1) \
        + 0.5 * np.clip(ae_err_test / max(ae_ref["p995"], 1e-9), 0, 1)
    blend_test = 0.7 * sup_test + 0.3 * anomaly_test

    evaluation = {"version": version, "threshold": threshold,
                  "val_weights": weights, "val_auc": val_auc,
                  "ensemble": _evaluate(y_test, blend_test, threshold)}
    for n, m in models.items():
        Xte = scaler.transform(X_test) if n == "logistic_regression" else X_test
        evaluation[n] = _evaluate(y_test, m.predict_proba(Xte)[:, 1], threshold)
    ens_summary = {k: round(v, 4) for k, v in evaluation["ensemble"].items()
                   if isinstance(v, float)}
    print("[train] ENSEMBLE test: " + json.dumps(ens_summary, indent=2))

    # ---------- persist ----------
    bundle = {"models": models, "weights": weights, "scaler": scaler, "iso": iso,
              "iso_bounds": iso_bounds, "autoencoder": ae, "ae_ref": ae_ref,
              "threshold": threshold, "version": version,
              "feature_names": FEATURE_NAMES}
    joblib.dump(bundle, os.path.join(artifacts_dir, "bundle.joblib"))
    with open(os.path.join(artifacts_dir, "evaluation.json"), "w") as fh:
        json.dump(evaluation, fh, indent=2)

    # reference distributions for drift monitoring (PSI)
    ref = {}
    for i, feat in enumerate(FEATURE_NAMES):
        col = X_train[:, i]
        ref[feat] = {"edges": np.quantile(col, np.linspace(0, 1, 11)).tolist(),
                     "mean": float(col.mean()), "std": float(col.std())}
    with open(os.path.join(artifacts_dir, "reference_stats.json"), "w") as fh:
        json.dump(ref, fh)

    # ---------- MLflow ----------
    try:
        mlflow.set_tracking_uri(settings.mlflow_uri)
        mlflow.set_experiment("fraud-detection")
        with mlflow.start_run(run_name=version):
            mlflow.log_params({"n_customers": n_customers, "days": days,
                               "fraud_rate": fraud_rate, "threshold": threshold,
                               "n_features": len(FEATURE_NAMES)})
            mlflow.log_metrics({f"val_auc_{k}": v for k, v in val_auc.items()}
                               | {f"test_{k}": v for k, v
                                  in evaluation["ensemble"].items()
                                  if isinstance(v, float)})
            mlflow.log_artifacts(artifacts_dir)
    except Exception as e:
        print(f"[train] MLflow unavailable ({e}); continuing.")

    # ---------- Cassandra registration (best-effort) ----------
    try:
        from db.connection import CassandraConnection
        from db.repositories import MonitoringRepository, ProfileRepository
        mon = MonitoringRepository(CassandraConnection.get())
        mon.save_metrics("fraud_ensemble", version,
                         {k: v for k, v in evaluation["ensemble"].items()
                          if isinstance(v, float)})
        mon.register_model("fraud_ensemble", version, artifacts_dir,
                           {k: v for k, v in evaluation["ensemble"].items()
                            if isinstance(v, float)})
        prof = ProfileRepository(CassandraConnection.get())
        counts = df.groupby("merchant_id").agg(
            merchant_name=("merchant_id", "first"), txn_count=("is_fraud", "size"),
            fraud_count=("is_fraud", "sum")).reset_index()
        from features.definitions import CATEGORY_RISK
        for _, r in counts.iterrows():
            prof.save_merchant({
                "merchant_id": r["merchant_id"], "merchant_name": r["merchant_name"],
                "category": r["merchant_name"], "txn_count": int(r["txn_count"]),
                "fraud_count": int(r["fraud_count"]),
                "fraud_rate": float(r["fraud_count"] / max(r["txn_count"], 1)),
                "risk_score": float(r["fraud_count"] / max(r["txn_count"], 1))})
        for c in gen.customers:
            prof.save_customer(c.to_record())
        print("[train] model registered in Cassandra + merchant/customer seed rows written")
    except Exception as e:
        print(f"[train] Cassandra registration skipped ({e})")

    return evaluation


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--customers", type=int, default=300)
    ap.add_argument("--days", type=int, default=60)
    ap.add_argument("--fraud-rate", type=float, default=0.025)
    args = ap.parse_args()
    train(n_customers=args.customers, days=args.days, fraud_rate=args.fraud_rate)