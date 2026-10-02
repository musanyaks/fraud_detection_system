import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend,
         Line, Pie, PieChart, RadialBar, RadialBarChart, ResponsiveContainer,
         Tooltip, XAxis, YAxis, LabelList } from "recharts";
import Kpi from "../components/Kpi.jsx";
import { CHANNEL_LABEL } from "../lib/format.js";
import GeoMap from "../components/GeoMap.jsx";
import GaugeRing from "../components/GaugeRing.jsx";
import { Panel, RiskBadge, Empty, RISK_COLOR } from "../components/bits.jsx";
import { money, compact, pct, hhmm, short, cust } from "../lib/format.js";
import { useLive } from "../lib/useLive.js";

const RANGE_LABEL = {
  LOW: ["Low", "(0-30)"], MEDIUM: ["Medium", "(31-60)"],
  HIGH: ["High", "(61-80)"], CRITICAL: ["Critical", "(81-100)"],
};
const FRAUD_TYPE_COLORS = {
  "Card Not Present": "#a855f7", "Account Takeover": "#f43f5e",
  "Velocity": "#f59e0b", "Location Anomaly": "#22c55e",
  "Merchant Fraud": "#3b82f6", "Large Amount": "#06b6d4", "Other": "#94a3b8",
};
const SEV = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308" };
const DONUT = ["#a855f7", "#ef4444", "#eab308", "#22c55e", "#3b82f6", "#64748b"];

export default function Overview() {
  const ov = useLive("/metrics/overview", {}, 4000);
  const an = useLive("/metrics/analytics", {}, 6000);
  const al = useLive("/alerts", { status: "OPEN" }, 8000);
  const tx = useLive("/transactions/recent", { limit: 12 }, 5000);
  const ev = useLive("/models/evaluation", {}, 60000);
  const pr = useLive("/predictions/recent", { limit: 300 }, 6000);

  const d = ov.data;
  if (ov.error) return <Empty>API error: {ov.error}</Empty>;
  if (!d) return <Empty>Loading…</Empty>;

  const riskMap = Object.fromEntries(
    (pr.data || []).map((p) => [String(p.transaction_id), p.risk_level]));
  const txns = tx.data || [];
  const alerts = (al.data || []).slice(0, 6);
  const e = ev.data?.ensemble;
  const cmArr = ev.data?.ensemble?.confusion_matrix;
  const accuracy = cmArr
    ? (cmArr[0][0] + cmArr[1][1]) / cmArr.flat().reduce((a, b) => a + b, 0)
    : null;
  const gauges = e ? [
    { name: "Accuracy", v: accuracy, fill: "#3b82f6" },
    { name: "Precision", v: e.precision, fill: "#22c55e" },
    { name: "Recall", v: e.recall, fill: "#a855f7" },
    { name: "F1 Score", v: e.f1, fill: "#f97316" },
  ].filter((g) => g.v != null) : [];
  const donut = (an.data?.fraud_by_category || []).map((x, i) => ({ ...x, fill: DONUT[i % DONUT.length] }));
  const dist = Object.entries(an.data?.risk_distribution || {}).map(([k, v]) => ({ name: k, count: v }));

  const pctDelta = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

  const geoPts = (an.data?.geo_points || []).map((g) => ({
    ...g,
    name: g.name || g.location,
    color: g.max_score >= 80 ? SEV.CRITICAL : g.max_score >= 55 ? SEV.HIGH : SEV.MEDIUM,
  }));

  return (
    <>
      <div className="kpi-row">
        <Kpi tone="blue" icon="txn" label="Total Transactions"
             value={compact(d.total_transactions)}
             delta={pctDelta(d.total_transactions, d.yesterday_total)} />
        <Kpi tone="green" icon="coins" label="Transaction Value"
             value={"$" + compact(Math.round(d.total_amount || 0))}
             note="today · sampled" />
        <Kpi tone="red" icon="shield" label="Fraud Detected"
             value={compact(d.fraud_detected)}
             delta={pctDelta(d.fraud_detected, d.yesterday_fraud_detected)} />
        <Kpi tone="purple" icon="rate" label="Fraud Rate"
             value={pct(d.fraud_rate)}
             delta={pctDelta(d.fraud_rate, d.yesterday_fraud_rate)} />
        <Kpi tone="orange" icon="people" label="High-Risk Customers"
             value={d.high_risk_customers} note="today" />
        <Kpi tone="teal" icon="bell" label="Active Alerts"
             value={d.open_alerts} note="open now" />
      </div>

      <div className="grid-3">
        <Panel title="Transaction Volume & Fraud Rate"
               extra={
                 <div className="legend-dots">
                   <span className="lg-item"><span className="lg-dot" style={{ background: "#3b82f6" }} />Transaction Volume</span>
                   <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Fraud Rate</span>
                 </div>
               }>
          {an.data?.daily?.length ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={an.data.daily} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="volGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.95} />
                    <stop offset="100%" stopColor="#1e40af" stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 11 }} interval={0} />
                <YAxis yAxisId="vol" stroke="#64748b" tick={{ fontSize: 11 }}
                       tickFormatter={(v) => compact(v)} />
                <YAxis yAxisId="rate" orientation="right" stroke="#64748b" tick={{ fontSize: 11 }}
                       tickFormatter={(v) => (v * 100).toFixed(2) + "%"}
                       domain={[0, (max) => Math.max(0.002, Math.ceil((max || 0.002) * 1.25 * 10000) / 10000)]} />
                <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b",
                                         borderRadius: 8 }}
                         formatter={(v, n) => n === "Fraud Rate"
                           ? [(v * 100).toFixed(3) + "%", n]
                           : [Number(v).toLocaleString(), n]} />
                <Bar yAxisId="vol" dataKey="volume" name="Transaction Volume"
                     fill="url(#volGrad)" radius={[3, 3, 0, 0]} maxBarSize={38} />
                <Line yAxisId="rate" dataKey="fraud_rate" name="Fraud Rate"
                      stroke="#f43f5e" strokeWidth={2}
                      dot={{ r: 4, fill: "#f43f5e", strokeWidth: 0 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <Empty>Building the weekly view…</Empty>}
        </Panel>

        <Panel title="Fraud by Type">
          {(an.data?.fraud_by_type || []).length ? (() => {
            const rowsAll = an.data.fraud_by_type;
            const total = rowsAll.reduce((s, x) => s + x.count, 0);
            const palette = ["#a855f7", "#f43f5e", "#f59e0b", "#22c55e", "#3b82f6", "#94a3b8"];
            const rows = rowsAll.map((x, i) => ({ ...x,
              pct: (100 * x.count / total).toFixed(1) + "%",
              fill: FRAUD_TYPE_COLORS[x.name] || palette[i % palette.length] }));
            return (
              <div className="fbt-wrap">
                <div className="fbt-donut">
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                      <Pie data={rows} dataKey="count" nameKey="name"
                           innerRadius={52} outerRadius={82} paddingAngle={3}
                           stroke="none">
                        {rows.map((x) => <Cell key={x.name} fill={x.fill} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0f172a",
                                               border: "1px solid #1e293b",
                                               borderRadius: 8 }}
                               formatter={(v, n) => [v + " flagged", n]} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="fbt-center">
                    <div className="fbt-total">{total.toLocaleString()}</div>
                    <div className="fbt-sub">Fraud Cases</div>
                  </div>
                </div>
                <div className="fbt-legend">
                  {rows.map((x) => (
                    <div key={x.name} className="fbt-row">
                      <span className="lg-dot" style={{ background: x.fill }} />
                      <span className="fbt-name">{x.name}</span>
                      <b className="fbt-pct">{x.pct}</b>
                    </div>))}
                </div>
              </div>
            );
          })() : <Empty>No flagged transactions yet.</Empty>}
        </Panel>

        <Panel title="Risk Distribution">
          {dist.some((x) => x.count) ? (() => {
            const total = dist.reduce((s, x) => s + x.count, 0);
            const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
            const rows = order.map((k) => {
              const hit = dist.find((x) => x.name === k) || { name: k, count: 0 };
              const pct = total ? (hit.count / total) * 100 : 0;
              return { name: k, pct,
                       pctStr: pct.toFixed(1) + "%",
                       fill: RISK_COLOR[k] };
            });
            return (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={rows} margin={{ top: 24, right: 8, left: 0, bottom: 4 }}>
                  <XAxis dataKey="name" stroke="#64748b" tick={{ fontSize: 11 }}
                         interval={0}
                         tickFormatter={(v) => RANGE_LABEL[v]} />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "#0f172a",
                                           border: "1px solid #1e293b",
                                           borderRadius: 8 }}
                           formatter={(v, n, item) =>
                             [item.payload.pctStr + "  (" + item.payload.count + " txns)",
                              RANGE_LABEL[item.payload.name][0]]} />
                  <Bar dataKey="pct" radius={[6, 6, 0, 0]} maxBarSize={64}>
                    <LabelList dataKey="pctStr" position="top"
                               style={{ fill: "#e2e8f0", fontSize: 12, fontWeight: 700 }} />
                    {rows.map((x) => <Cell key={x.name} fill={x.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            );
          })() : <Empty>No predictions yet.</Empty>}
        </Panel>
      </div>

      <div className="grid-3">
        <Panel title="Geographic Transaction Map">
          {geoPts.length ? (
            <div className="geo-grid">
              <GeoMap points={geoPts} />
              <div className="geo-legend">
                {[...geoPts].sort((a, b) => b.count - a.count).slice(0, 8).map((g) => (
                  <div key={g.name} className="geo-legend-row">
                    <span className="geo-dot" style={{ background: g.color }} />
                    <span>{g.name}</span>
                    <b className="geo-count">{g.count}</b>
                  </div>
                ))}
              </div>
            </div>
          ) : <Empty>No geo flags yet — flagged transactions will appear here.</Empty>}
        </Panel>

        <Panel title="Top Risk Customers">
          {(an.data?.top_risk_customers || []).length ? (
            <table className="tbl">
              <thead><tr><th>Customer ID</th><th>Risk Score</th><th>Severity</th></tr></thead>
              <tbody>
                {an.data.top_risk_customers.map((c) => (
                  <tr key={c.customer_id}>
                    <td>{cust(c.customer_id)}</td>
                    <td className="risk-num">{c.risk_score}</td>
                    <td><RiskBadge level={c.risk_level} score={c.risk_score} /></td>
                  </tr>))}
              </tbody>
            </table>
          ) : <Empty>No customer risk data yet.</Empty>}
        </Panel>

        <Panel title="Recent Alerts">
          {alerts.length ? (
            <table className="tbl">
              <thead><tr><th>Time</th><th>Customer ID</th><th>Amount</th><th>Severity</th></tr></thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={String(a.alert_id)}>
                    <td>{hhmm(a.created_at)}</td>
                    <td>{cust(a.customer_id)}</td>
                    <td>{money(a.amount)}</td>
                    <td><RiskBadge level={a.severity} /></td>
                  </tr>))}
              </tbody>
            </table>
          ) : <Empty>No open alerts.</Empty>}
        </Panel>
      </div>

      <div className="grid-3">
        <Panel title="Transaction Types">
          {(an.data?.channel_mix || []).length ? (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart
                data={an.data.channel_mix.map((x) => ({
                  ...x,
                  label: CHANNEL_LABEL[x.name] || x.name,
                  fill: ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#22d3ee"][
                    an.data.channel_mix.findIndex((c) => c.name === x.name) % 5],
                }))}
                margin={{ top: 22, right: 8, left: 0, bottom: 4 }}>
                <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 11 }}
                       interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }}
                       tickFormatter={(v) => Intl.NumberFormat(undefined,
                         { notation: "compact" }).format(v)} />
                <Tooltip contentStyle={{ background: "#0f172a",
                                         border: "1px solid #1e293b",
                                         borderRadius: 8 }}
                         formatter={(v) => [Intl.NumberFormat().format(v) + " txns",
                                            "Volume"]} />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} maxBarSize={46}>
                  <LabelList dataKey="count" position="top"
                             formatter={(v) => Intl.NumberFormat(undefined,
                               { notation: "compact", maximumFractionDigits: 1 }).format(v)}
                             style={{ fill: "#e2e8f0", fontSize: 12, fontWeight: 700 }} />
                  {an.data.channel_mix.map((x) => (
                    <Cell key={x.name} fill={
                      ["#3b82f6", "#22c55e", "#a855f7", "#f97316", "#22d3ee"][
                        an.data.channel_mix.findIndex((c) => c.name === x.name) % 5]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No transactions yet.</Empty>}
        </Panel>

        <Panel title="Model Performance" extra={ev.data ? <span className="muted">v{String(ev.data.version).slice(0, 24)}</span> : null}>
          {gauges.length ? (
            <div className="gauge-ring-row">
              {gauges.map((g) => (
                <GaugeRing key={g.name} value={g.v} label={g.name} color={g.fill} />
              ))}
            </div>
          ) : <Empty>Run training to populate.</Empty>}
          {ev.data && (
            <div className="muted" style={{ textAlign: "center", marginTop: 8 }}>
              Last updated: {new Date().toLocaleString()} · live ensemble, test set
            </div>
          )}
        </Panel>

        <Panel title="Recent Transactions" extra={<span className="muted">live</span>}>
          {txns.length ? (
            <table className="tbl">
              <thead><tr><th>Time</th><th>Customer ID</th><th>Merchant</th><th>Amount</th><th>Risk</th></tr></thead>
              <tbody>
                {txns.slice(0, 6).map((t) => (
                  <tr key={String(t.transaction_id)}>
                    <td>{hhmm(t.transaction_time)}</td>
                    <td>{cust(t.customer_id)}</td>
                    <td>{t.merchant_name}</td>
                    <td>{money(t.amount)}</td>
                    <td><RiskBadge level={riskMap[String(t.transaction_id)] || "-"} /></td>
                  </tr>))}
              </tbody>
            </table>
          ) : <Empty>Waiting for the stream…</Empty>}
        </Panel>
      </div>
    </>
  );
}