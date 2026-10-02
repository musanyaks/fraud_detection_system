import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer,
         Tooltip, XAxis, YAxis } from "recharts";
import Kpi from "../components/Kpi.jsx";
import { Panel, Empty } from "../components/bits.jsx";
import { money, cust, txn, hhmm } from "../lib/format.js";
import { useLive } from "../lib/useLive.js";
import { apiGet } from "../lib/api.js";

const TT = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 };

const pretty = (s) => String(s).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export default function ModelMonitor() {
  const ev = useLive("/models/evaluation", {}, 60000);
  const pr = useLive("/predictions/recent", { limit: 300 }, 8000);
  const fi = useLive("/models/feature-importance", {}, 60000);

  const [drift, setDrift] = useState(null);
  const [driftBusy, setDriftBusy] = useState(false);
  const [driftErr, setDriftErr] = useState(null);

  const runDrift = async () => {
    setDriftBusy(true); setDriftErr(null);
    try { setDrift(await apiGet("/models/drift")); }
    catch (e) { setDriftErr(e.message); }
    finally { setDriftBusy(false); }
  };

  const e = ev.data?.ensemble;
  const cm = e?.confusion_matrix;                       // [[TN, FP], [FN, TP]]
  const accuracy = cm ? (cm[0][0] + cm[1][1]) /
    cm.flat().reduce((a, b) => a + b, 0) : null;

  const kpis = e ? [
    { tone: "blue",   icon: "rate",  label: "Model Accuracy",
      value: accuracy != null ? (accuracy * 100).toFixed(1) + "%" : "-", note: "test set" },
    { tone: "green",  icon: "shield", label: "Precision",
      value: (e.precision * 100).toFixed(1) + "%", note: "test set" },
    { tone: "purple", icon: "rate",  label: "Recall",
      value: (e.recall * 100).toFixed(1) + "%", note: "test set" },
    { tone: "orange", icon: "coins", label: "F1 Score",
      value: (e.f1 * 100).toFixed(1) + "%", note: "test set" },
    { tone: "teal",   icon: "txn",   label: "ROC-AUC",
      value: (e.roc_auc * 100).toFixed(1) + "%", note: "test set" },
  ] : [];

  const modelRows = useMemo(() => {
    if (!ev.data) return [];
    const nice = { ensemble: "Ensemble (Blended)", xgboost: "XGBoost",
      lightgbm: "LightGBM", random_forest: "Random Forest",
      logistic_regression: "Logistic Regression" };
    return Object.keys(nice).filter((k) => ev.data[k]).map((k) => ({
      key: k, name: nice[k], m: ev.data[k], hero: k === "ensemble" }));
  }, [ev.data]);

  const cmpData = useMemo(() => modelRows
    .filter((r) => r.key !== "ensemble")
    .map((r) => ({ name: r.name.replace(" Regression", ""),
      Precision: +(r.m.precision * 100).toFixed(1),
      Recall: +(r.m.recall * 100).toFixed(1),
      F1: +(r.m.f1 * 100).toFixed(1) })), [modelRows]);

  const metricBars = useMemo(() => {
    if (!e) return [];
    return [
      { name: "Accuracy",  val: accuracy != null ? accuracy * 100 : 0, color: "#3b82f6" },
      { name: "Precision", val: e.precision * 100, color: "#22c55e" },
      { name: "Recall",    val: e.recall * 100,    color: "#a855f7" },
      { name: "F1 Score",  val: e.f1 * 100,        color: "#f59e0b" },
      { name: "ROC-AUC",   val: e.roc_auc * 100,   color: "#06b6d4" },
      { name: "PR-AUC",    val: e.pr_auc * 100,    color: "#f43f5e" },
    ];
  }, [e, accuracy]);

  const recent = useMemo(() => (pr.data || [])
    .filter((x) => x.risk_level === "HIGH" || x.risk_level === "CRITICAL")
    .sort((a, b) => (a.predicted_at < b.predicted_at ? 1 : -1))
    .slice(0, 6), [pr.data]);

  const driftStatusColor = {
    OK: "#22c55e", WARN: "#eab308", CRITICAL_DRIFT: "#ef4444",
    INSUFFICIENT_DATA: "#64748b",
  }[drift?.status] || "#64748b";

  if (ev.error || !ev.data) {
    return <Panel title="Model Monitoring">
      <Empty>No evaluation artifact - run `./scripts/dev.sh train` first.</Empty>
    </Panel>;
  }

  return (
    <div>
      <div className="kpi-row fd-kpis">
        {kpis.map((k) => <Kpi key={k.label} tone={k.tone} icon={k.icon}
          label={k.label} value={k.value} note={k.note} />)}
      </div>

      <div className="fd-row1" style={{ gridTemplateColumns: "1.4fr 1fr 1fr" }}>
        <Panel title="Metric Comparison Across Models" extra={
          <span className="muted">single training run - trend history on roadmap</span>}>
          {cmpData.length ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={cmpData} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }}
                       domain={[0, 100]} tickFormatter={(v) => v + "%"} />
                <Tooltip contentStyle={TT} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Precision" fill="#22c55e" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="Recall" fill="#a855f7" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar dataKey="F1" fill="#f59e0b" radius={[3, 3, 0, 0]} maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No model data.</Empty>}
        </Panel>

        <Panel title="Confusion Matrix">
          {cm ? (
            <table className="tbl center cm-table">
              <thead>
                <tr><th></th><th>Predicted Legit</th><th>Predicted Fraud</th></tr>
              </thead>
              <tbody>
                <tr>
                  <th>Actual Legit</th>
                  <td className="cm-cell cm-good">{cm[0][0].toLocaleString()}<span className="cm-sub">(TN)</span></td>
                  <td className="cm-cell cm-bad">{cm[0][1].toLocaleString()}<span className="cm-sub">(FP)</span></td>
                </tr>
                <tr>
                  <th>Actual Fraud</th>
                  <td className="cm-cell cm-bad">{cm[1][0].toLocaleString()}<span className="cm-sub">(FN)</span></td>
                  <td className="cm-cell cm-good">{cm[1][1].toLocaleString()}<span className="cm-sub">(TP)</span></td>
                </tr>
              </tbody>
            </table>
          ) : <Empty>No confusion matrix.</Empty>}
        </Panel>

        <Panel title="Model Metrics">
          {metricBars.length ? (
            <div className="hbars">
              {metricBars.map((x) => (
                <div key={x.name} className="hbar-row">
                  <span className="hbar-name">{x.name}</span>
                  <div className="hbar-track">
                    <div className="hbar-fill" style={{ width: x.val + "%",
                                                         background: x.color }} />
                  </div>
                  <b className="hbar-pct">{x.val.toFixed(1)}%</b>
                </div>))}
            </div>
          ) : <Empty>No metrics.</Empty>}
        </Panel>
      </div>

      <div className="fd-row2" style={{ gridTemplateColumns: "1.5fr 1fr 1fr" }}>
        <Panel title="Model Performance Comparison">
          {modelRows.length ? (
            <table className="tbl wide">
              <thead>
                <tr><th>Model</th><th>Precision</th><th>Recall</th>
                    <th>F1 Score</th><th>ROC-AUC</th><th>Status</th></tr>
              </thead>
              <tbody>
                {modelRows.map((r) => (
                  <tr key={r.key} className={r.hero ? "sel" : ""}>
                    <td>{r.name}</td>
                    <td>{r.m.precision.toFixed(3)}</td>
                    <td>{r.m.recall.toFixed(3)}</td>
                    <td>{r.m.f1.toFixed(3)}</td>
                    <td>{r.m.roc_auc.toFixed(3)}</td>
                    <td><span className={"st " + (r.hero ? "st-approved" : "st-review")}>
                      {r.hero ? "Running" : "Active"}</span></td>
                  </tr>))}
              </tbody>
            </table>
          ) : <Empty>No models.</Empty>}
        </Panel>

        <Panel title="Data Drift Monitoring (PSI)" extra={
          drift ? <span className="st st-review" style={{
            background: driftStatusColor + "26", color: driftStatusColor,
            border: "1px solid " + driftStatusColor + "55" }}>{drift.status}</span> : null}>
          <button className="btn-primary" style={{ width: "100%", marginBottom: 10 }}
                  disabled={driftBusy} onClick={runDrift}>
            {driftBusy ? "Running PSI check..." : "Run Drift Check Now"}
          </button>
          {driftErr && <div className="td-reason">{driftErr}</div>}
          {drift ? (
            <div>
              <div className="muted" style={{ marginBottom: 6 }}>
                samples: {drift.samples} · drifted features: {
                  Object.keys(drift.drifted_features || {}).length}
              </div>
              {Object.keys(drift.drifted_features || {}).length ? (
                <div className="hbars">
                  {Object.entries(drift.drifted_features).slice(0, 6)
                    .map(([name, score]) => (
                      <div key={name} className="hbar-row">
                        <span className="hbar-name">{pretty(name)}</span>
                        <div className="hbar-track">
                          <div className="hbar-fill"
                               style={{ width: Math.min(100, score * 400) + "%",
                                        background: "#ef4444" }} />
                        </div>
                        <b className="hbar-pct">{score.toFixed(3)}</b>
                      </div>))}
                </div>
              ) : (
                <div className="insight">
                  <span className="insight-icon"
                        style={{ background: "#22c55e26", color: "#4ade80" }}>✓</span>
                  <div>
                    <div className="insight-title">No significant drift</div>
                    <div className="insight-sub">All features within PSI thresholds.</div>
                  </div>
                </div>
              )}
            </div>
          ) : <Empty>Run the check to compare live feature distributions
                 against training references (PSI).</Empty>}
        </Panel>

        <Panel title="Feature Importance" extra={
          <span className="muted">XGBoost gain-based</span>}>
          {(fi.data?.features || []).length ? (
            <div className="hbars">
              {fi.data.features.map((x) => (
                <div key={x.name} className="hbar-row">
                  <span className="hbar-name">{pretty(x.name)}</span>
                  <div className="hbar-track">
                    <div className="hbar-fill"
                         style={{ width: Math.max(3, x.share * 4) + "%",
                                  background: "#3b82f6" }} />
                  </div>
                  <b className="hbar-pct">{x.share}%</b>
                </div>))}
            </div>
          ) : fi.error ? <Empty>Feature importance unavailable.</Empty>
            : <Empty>Loading model data...</Empty>}
        </Panel>
      </div>

      <div className="fd-row3" style={{ gridTemplateColumns: "1.6fr 1fr" }}>
        <Panel title="Recent Flagged Predictions" extra={
          <span className="muted">scored by: {ev.data ? "Ensemble " + ev.data.version.slice(0, 18) : "-"}</span>}>
          {recent.length ? (
            <table className="tbl wide">
              <thead>
                <tr><th>Transaction ID</th><th>Customer ID</th><th>Amount</th>
                    <th>Risk Score</th><th>Prediction</th><th>Time</th></tr>
              </thead>
              <tbody>
                {recent.map((x) => (
                  <tr key={String(x.transaction_id)}>
                    <td className="mono">{txn(x.transaction_id)}</td>
                    <td className="mono">{cust(x.customer_id)}</td>
                    <td>{money(x.amount)}</td>
                    <td className="risk-num">{x.risk_score.toFixed(1)}</td>
                    <td><span className={"st " +
                      (x.risk_level === "CRITICAL" ? "st-flagged" : "st-review")}>
                      {x.risk_level === "CRITICAL" ? "Fraud" : "High Risk"}</span></td>
                    <td className="mono">{hhmm(x.predicted_at)}</td>
                  </tr>))}
              </tbody>
            </table>
          ) : <Empty>No flagged predictions yet.</Empty>}
        </Panel>

        <Panel title="Model Status" extra={
          <span className="muted">{ev.data ? "v" + ev.data.version : ""}</span>}>
          <div className="insights">
            <div className="insight">
              <span className="insight-icon" style={{ background: "#22c55e26", color: "#4ade80" }}>●</span>
              <div>
                <div className="insight-title">Ensemble (Blended)</div>
                <div className="insight-sub">Serving live traffic via FastAPI.</div>
              </div>
            </div>
            {["XGBoost", "LightGBM", "Random Forest", "Logistic Regression"].map((m) => (
              <div key={m} className="insight">
                <span className="insight-icon" style={{ background: "#3b82f626", color: "#60a5fa" }}>●</span>
                <div>
                  <div className="insight-title">{m}</div>
                  <div className="insight-sub">Active - contributing to ensemble blend.</div>
                </div>
              </div>))}
            <div className="insight">
              <span className="insight-icon" style={{ background: "#f59e0b26", color: "#fbbf24" }}>●</span>
              <div>
                <div className="insight-title">Isolation Forest + Autoencoder</div>
                <div className="insight-sub">Active - anomaly component (30% blend).</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
