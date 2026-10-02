import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
         ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Kpi from "../components/Kpi.jsx";
import { Panel, Empty, RiskBadge } from "../components/bits.jsx";
import GeoMap from "../components/GeoMap.jsx";
import { money, compact, pct, cust, txn, hhmm } from "../lib/format.js";
import { useLive } from "../lib/useLive.js";

const RISK_COLORS = { LOW: "#22c55e", MEDIUM: "#eab308", HIGH: "#f97316", CRITICAL: "#ef4444" };
const TYPE_COLORS = {
  "Card Not Present": "#a855f7", "Account Takeover": "#f43f5e", "Velocity": "#f59e0b",
  "Location Anomaly": "#22c55e", "Merchant Fraud": "#3b82f6", "Large Amount": "#06b6d4",
  "Other": "#94a3b8",
};
const SEV = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308" };

function TypePill({ name }) {
  const c = TYPE_COLORS[name] || "#94a3b8";
  return <span className="type-pill" style={{ background: c + "26", color: c,
    border: "1px solid " + c + "55" }}>{name}</span>;
}

export default function FraudDetection({ onNavigate }) {
  const ov = useLive("/metrics/overview", {}, 5000);
  const an = useLive("/metrics/analytics", {}, 8000);
  const ev = useLive("/models/evaluation", {}, 60000);
  const al = useLive("/alerts", { status: "OPEN" }, 6000);
  const pr = useLive("/predictions/recent", { limit: 1000 }, 6000);
  const tx = useLive("/transactions/recent", { limit: 1000 }, 8000);

  const d = ov.data;
  const pctDelta = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

  // merchant lookup for the recent-fraudulent table
  const merchMap = useMemo(() => Object.fromEntries(
    (tx.data || []).map((t) => [String(t.transaction_id), t.merchant_name])), [tx.data]);

  const flaggedRows = useMemo(() => (pr.data || [])
    .filter((p) => p.risk_level === "HIGH" || p.risk_level === "CRITICAL")
    .sort((a, b) => (a.predicted_at < b.predicted_at ? 1 : -1))
    .slice(0, 5), [pr.data]);

  const fbt = useMemo(() => {
    const rows = an.data?.fraud_by_type || [];
    const total = rows.reduce((s, x) => s + x.count, 0);
    return rows.map((x, i) => ({ ...x,
      pct: total ? (100 * x.count / total).toFixed(1) + "%" : "0%",
      fill: TYPE_COLORS[x.name] || ["#a855f7", "#f43f5e", "#f59e0b",
        "#22c55e", "#3b82f6", "#94a3b8"][i % 6] }));
  }, [an.data]);

  const dist = useMemo(() => {
    const dd = an.data?.risk_distribution || {};
    const total = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]
      .reduce((s, k) => s + (dd[k] || 0), 0);
    return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((k) => ({
      name: k, count: dd[k] || 0,
      pctStr: total ? ((100 * (dd[k] || 0) / total)).toFixed(1) + "%" : "0%",
      fill: RISK_COLORS[k] }));
  }, [an.data]);

  const geoPts = useMemo(() => (an.data?.geo_points || []).map((g) => ({
    ...g, name: g.name || g.location,
    color: g.max_score >= 80 ? SEV.CRITICAL : g.max_score >= 55 ? SEV.HIGH : SEV.MEDIUM,
  })), [an.data]);

  const modelRows = useMemo(() => {
    if (!ev.data) return [];
    const nice = { ensemble: "Ensemble (Blended)", xgboost: "XGBoost",
      lightgbm: "LightGBM", random_forest: "Random Forest",
      logistic_regression: "Logistic Regression" };
    return Object.keys(nice).filter((k) => ev.data[k]).map((k) => ({
      name: nice[k], m: ev.data[k], hero: k === "ensemble" }));
  }, [ev.data]);

  const peakHour = useMemo(() => {
    const h = an.data?.hourly || [];
    if (!h.length) return null;
    const top = h.reduce((a, b) => (b.volume > a.volume ? b : a));
    return String(top.hour).padStart(2, "0") + ":00";
  }, [an.data]);

  const insights = [];
  if (d && d.yesterday_fraud_rate != null) {
    const delta = pctDelta(d.fraud_rate, d.yesterday_fraud_rate);
    if (delta != null) insights.push({
      icon: delta >= 0 ? "▲" : "▼", color: delta >= 0 ? "#f43f5e" : "#22c55e",
      title: "Fraud rate " + (delta >= 0 ? "increased" : "decreased") +
             " by " + Math.abs(delta).toFixed(1) + "%",
      sub: "Compared to yesterday." });
  }
  if (fbt.length) insights.push({
    icon: "◆", color: TYPE_COLORS[fbt[0].name] || "#a855f7",
    title: fbt[0].name + " is the top risk",
    sub: fbt[0].pct + " of flagged cases." });
  if (ev.data?.ensemble) insights.push({
    icon: "✓", color: "#22c55e",
    title: "Model performance is stable",
    sub: "Ensemble ROC-AUC " + ev.data.ensemble.roc_auc.toFixed(3) + "." });
  if (peakHour) insights.push({
    icon: "◷", color: "#3b82f6",
    title: "Peak traffic hour: " + peakHour,
    sub: "Highest transaction volume today." });

  const channelTotal = (an.data?.channel_mix || [])
    .reduce((s, x) => s + x.count, 0) || 1;
  const CH_COLORS = { pos: "#3b82f6", online: "#10b981", mobile: "#a855f7",
    bank: "#f59e0b", atm: "#ec4899" };

  return (
    <div>
      <div className="kpi-row fd-kpis">
        <Kpi tone="blue" icon="shield" label="Total Transactions"
             value={compact(d?.total_transactions ?? 0)}
             delta={d ? pctDelta(d.total_transactions, d.yesterday_total) : null} />
        <Kpi tone="green" icon="shield" label="Fraud Detected"
             value={compact(d?.fraud_detected ?? 0)}
             delta={d ? pctDelta(d.fraud_detected, d.yesterday_fraud_detected) : null} />
        <Kpi tone="purple" icon="rate" label="Fraud Rate"
             value={pct(d?.fraud_rate ?? 0)}
             delta={d ? pctDelta(d.fraud_rate, d.yesterday_fraud_rate) : null} />
        <Kpi tone="orange" icon="people" label="High-Risk Customers"
             value={d?.high_risk_customers ?? 0} note="today" />
        <Kpi tone="teal" icon="bell" label="Active Alerts"
             value={d?.open_alerts ?? 0} note="open now" />
      </div>

      <div className="fd-row1">
        <Panel title="Fraud Detection Trend" extra={
          <div className="legend-dots">
            <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Fraudulent</span>
            <span className="lg-item"><span className="lg-dot" style={{ background: "#3b82f6" }} />Legitimate</span>
          </div>}>
          {(an.data?.daily || []).length ? (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={an.data.daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => compact(v)} />
                <Tooltip contentStyle={{ background: "#0f172a",
                  border: "1px solid #1e293b", borderRadius: 8 }} />
                <Line dataKey="volume" name="Legitimate" stroke="#3b82f6"
                      strokeWidth={2} dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }} />
                <Line dataKey="flagged" name="Fraudulent" stroke="#f43f5e"
                      strokeWidth={2} dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty>No daily data yet.</Empty>}
        </Panel>

        <Panel title="Fraud by Type">
          {fbt.length ? (
            <div className="fbt-wrap">
              <div className="fbt-donut">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={fbt} dataKey="count" nameKey="name"
                         innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                      {fbt.map((x) => <Cell key={x.name} fill={x.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={{ background: "#0f172a",
                      border: "1px solid #1e293b", borderRadius: 8 }}
                      formatter={(v, n) => [v + " flagged", n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="fbt-center">
                  <div className="fbt-total">
                    {(an.data?.fraud_by_type || []).reduce((s, x) => s + x.count, 0).toLocaleString()}
                  </div>
                  <div className="fbt-sub">Fraud Cases</div>
                </div>
              </div>
              <div className="fbt-legend">
                {fbt.map((x) => (
                  <div key={x.name} className="fbt-row">
                    <span className="lg-dot" style={{ background: x.fill }} />
                    <span className="fbt-name">{x.name}</span>
                    <b className="fbt-pct">{x.pct}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty>No flagged transactions yet.</Empty>}
        </Panel>

        <Panel title="Risk Score Distribution">
          {dist.some((x) => x.count) ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={dist} margin={{ top: 22, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis hide domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "#0f172a",
                  border: "1px solid #1e293b", borderRadius: 8 }}
                  formatter={(v, n, item) => [item.payload.pctStr +
                    "  (" + item.payload.count + ")", item.payload.name]} />
                <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={44}>
                  {dist.map((x) => <Cell key={x.name} fill={x.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No predictions yet.</Empty>}
        </Panel>
      </div>

      <div className="fd-row2">
        <Panel title="Fraud Detection Models">
          {modelRows.length ? (
            <table className="tbl wide">
              <thead>
                <tr><th>Model</th><th>Precision</th><th>Recall</th>
                    <th>F1 Score</th><th>ROC-AUC</th><th>Status</th></tr>
              </thead>
              <tbody>
                {modelRows.map((r) => (
                  <tr key={r.name} className={r.hero ? "sel" : ""}>
                    <td>{r.name}</td>
                    <td>{r.m.precision.toFixed(3)}</td>
                    <td>{r.m.recall.toFixed(3)}</td>
                    <td>{r.m.f1.toFixed(3)}</td>
                    <td>{r.m.roc_auc.toFixed(3)}</td>
                    <td><span className="st st-approved">Active</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>Run training to populate model metrics.</Empty>}
        </Panel>

        <Panel title="Fraud Alerts" extra={<button className="view-all view-all-btn" onClick={() => onNavigate && onNavigate("alerts")}>View All →</button>}>
          {(al.data || []).length ? (
            <table className="tbl wide">
              <thead>
                <tr><th>Time</th><th>Customer ID</th><th>Amount</th>
                    <th>Risk Score</th><th>Status</th></tr>
              </thead>
              <tbody>
                {al.data.slice(0, 5).map((a) => (
                  <tr key={String(a.alert_id)}>
                    <td>{hhmm(a.created_at)}</td>
                    <td className="mono">{cust(a.customer_id)}</td>
                    <td>{money(a.amount)}</td>
                    <td className="risk-num">{Number(a.risk_score).toFixed(1)}</td>
                    <td><RiskBadge level={a.severity} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No open alerts.</Empty>}
        </Panel>

        <Panel title="Geographic Fraud Map">
          {geoPts.length ? (
            <div className="td-geo">
              <GeoMap points={geoPts} />
              <div className="fd-geo-legend">
                {geoPts.slice(0, 5).map((g) => (
                  <div key={g.name} className="fbt-row">
                    <span className="lg-dot" style={{ background: g.color }} />
                    <span className="fbt-name">{g.name}</span>
                    <b className="fbt-pct">{g.count}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty>No geo flags yet.</Empty>}
        </Panel>
      </div>

      <div className="fd-row3">
        <Panel title="Transaction Risk Breakdown">
          {(an.data?.channel_mix || []).length ? (
            <div className="hbars">
              {an.data.channel_mix.map((x) => (
                <div key={x.name} className="hbar-row">
                  <span className="hbar-name">
                    {({ pos: "Card Payment", online: "Online Purchase",
                        mobile: "Mobile Money", bank: "Bank Transfer",
                        atm: "ATM Withdrawal" })[x.name] || "Other"}
                  </span>
                  <div className="hbar-track">
                    <div className="hbar-fill"
                         style={{ width: Math.max(2, 100 * x.count / channelTotal) + "%",
                                  background: CH_COLORS[x.name] || "#94a3b8" }} />
                  </div>
                  <b className="hbar-pct">{(100 * x.count / channelTotal).toFixed(1)}%</b>
                </div>
              ))}
            </div>
          ) : <Empty>No data yet.</Empty>}
        </Panel>

        <Panel title="Recent Fraudulent Transactions"
               extra={<button className="view-all view-all-btn" onClick={() => onNavigate && onNavigate("transactions")}>View All →</button>}>
          {flaggedRows.length ? (
            <table className="tbl wide">
              <thead>
                <tr><th>Transaction ID</th><th>Customer ID</th><th>Merchant</th>
                    <th>Amount</th><th>Risk Score</th><th>Type</th></tr>
              </thead>
              <tbody>
                {flaggedRows.map((p) => (
                  <tr key={String(p.transaction_id)}>
                    <td className="mono">{txn(p.transaction_id)}</td>
                    <td className="mono">{cust(p.customer_id)}</td>
                    <td>{merchMap[String(p.transaction_id)] || "—"}</td>
                    <td>{money(p.amount)}</td>
                    <td className="risk-num">{p.risk_score.toFixed(1)}</td>
                    <td><TypePill name={p.fraud_type || "Other"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty>No fraudulent transactions yet.</Empty>}
        </Panel>

        <Panel title="Fraud Detection Insights">
          {insights.length ? (
            <div className="insights">
              {insights.map((x, i) => (
                <div key={i} className="insight">
                  <span className="insight-icon"
                        style={{ background: x.color + "26", color: x.color,
                                 border: "1px solid " + x.color + "55" }}>{x.icon}</span>
                  <div>
                    <div className="insight-title">{x.title}</div>
                    <div className="insight-sub">{x.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty>Collecting insights…</Empty>}
        </Panel>
      </div>
    </div>
  );
}
