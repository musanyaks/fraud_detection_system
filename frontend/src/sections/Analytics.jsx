import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie,
         PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Kpi from "../components/Kpi.jsx";
import { Panel, Empty } from "../components/bits.jsx";
import GeoMap from "../components/GeoMap.jsx";
import { money, compact, pct } from "../lib/format.js";
import { useLive } from "../lib/useLive.js";

const RISK_COLORS = { LOW: "#22c55e", MEDIUM: "#eab308", HIGH: "#f97316", CRITICAL: "#ef4444" };
const CH_NAMES = { pos: "Card Payment", online: "Online Purchase",
  mobile: "Mobile Money", bank: "Bank Transfer", atm: "ATM Withdrawal" };
const CH_COLORS = { "Card Payment": "#3b82f6", "Online Purchase": "#a855f7",
  "Mobile Money": "#10b981", "Bank Transfer": "#f59e0b", "ATM Withdrawal": "#ec4899",
  "Other": "#94a3b8" };
const SEV = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308" };

const TT = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 };

export default function Analytics() {
  const an = useLive("/metrics/analytics", {}, 10000);
  const ov = useLive("/metrics/overview", {}, 8000);
  const cs = useLive("/customers/summary", {}, 30000);

  const [spendTab, setSpendTab] = useState("category");
  const [geoMode, setGeoMode] = useState("volume");
  const [report, setReport] = useState(false);

  const d = ov.data, a = an.data;
  const pctDelta = (cur, prev) => (prev ? ((cur - prev) / prev) * 100 : null);

  const daily = a?.daily || [];
  const hourly = useMemo(() => {
    const map = {};
    (a?.hourly || []).forEach((h) => { map[Number(h.hour)] = h; });
    return Array.from({ length: 24 }, (_, h) => ({
      label: String(h).padStart(2, "0") + ":00",
      volume: map[h]?.volume || 0 }));
  }, [a]);

  const distRows = useMemo(() => {
    const total = (a?.channel_mix || []).reduce((s, x) => s + x.count, 0) || 1;
    return (a?.channel_mix || []).map((x) => ({
      name: x.name, label: CH_NAMES[x.name] || "Other", count: x.count,
      pctStr: (100 * x.count / total).toFixed(1) + "%",
      fill: CH_COLORS[CH_NAMES[x.name]] || "#94a3b8" }));
  }, [a]);

  const segRows = useMemo(() => {
    const dd = cs.data?.distribution || {};
    const total = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].reduce((s, k) => s + (dd[k] || 0), 0);
    return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((k) => ({
      name: k, count: dd[k] || 0,
      pctStr: total ? (100 * (dd[k] || 0) / total).toFixed(1) + "%" : "0%",
      fill: RISK_COLORS[k] }));
  }, [cs.data]);

  const geoPts = useMemo(() => (a?.geo_points || []).map((g) => ({
    ...g, name: g.name || g.location,
    color: g.max_score >= 80 ? SEV.CRITICAL : g.max_score >= 55 ? SEV.HIGH : SEV.MEDIUM,
  })), [a]);

  const insights = useMemo(() => {
    const out = [];
    if (d && d.yesterday_total) {
      const dv = pctDelta(d.total_transactions, d.yesterday_total);
      if (dv != null) out.push({ icon: dv >= 0 ? "+" : "-", color: dv >= 0 ? "#22c55e" : "#f43f5e",
        title: "Transaction volume " + (dv >= 0 ? "increased" : "decreased") +
               " by " + Math.abs(dv).toFixed(1) + "%", sub: "Compared to yesterday." });
    }
    if (d && d.yesterday_fraud_rate != null) {
      const dr = pctDelta(d.fraud_rate, d.yesterday_fraud_rate);
      if (dr != null) out.push({ icon: "%", color: "#a855f7",
        title: "Fraud rate " + (dr >= 0 ? "increased" : "decreased") + " to " + pct(d.fraud_rate),
        sub: "Yesterday: " + pct(d.yesterday_fraud_rate) + "." });
    }
    if (d?.high_risk_customers) out.push({ icon: "!", color: "#f97316",
      title: d.high_risk_customers + " high-risk customers today",
      sub: "Customers with flagged transactions." });
    const cats = cs.data?.top_categories || [];
    if (cats.length) out.push({ icon: "#", color: "#3b82f6",
      title: cats[0].name + " leads spending",
      sub: cats[0].share + "% of today's transaction value." });
    return out.slice(0, 4);
  }, [d, cs.data]);

  const exportReport = () => {
    const blob = new Blob([JSON.stringify({ overview: d, analytics: a }, null, 2)],
      { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "analytics-report.json";
    link.click();
  };

  const spendRows = spendTab === "category"
    ? (cs.data?.top_categories || []).map((x) => ({ name: x.name, share: x.share }))
    : spendTab === "location"
    ? (a?.fraud_by_location || []).slice(0, 6).map((x) => ({ name: x.name, share: 0, count: x.count }))
    : (a?.channel_mix || []).map((x) => ({ name: x.name,
        label: x.name, share: 0, count: x.count }));
  const spendTotal = spendRows.reduce((s, x) => s + (x.share || x.count || 0), 0) || 1;

  return (
    <div>
      <div className="page-actions">
        <button className="btn-primary export-btn" onClick={exportReport}>
          ⤓ Export Report
        </button>
      </div>
      <div className="kpi-row fd-kpis">
        <Kpi tone="blue" icon="coins" label="Total Transaction Value"
             value={"$" + compact(Math.round(d?.total_amount || 0))}
             note="today · sampled" />
        <Kpi tone="green" icon="people" label="Total Customers"
             value={compact((cs.data?.rows || []).length)} note="registered" />
        <Kpi tone="purple" icon="txn" label="Total Transactions"
             value={compact(d?.total_transactions ?? 0)}
             delta={d ? pctDelta(d.total_transactions, d.yesterday_total) : null} />
        <Kpi tone="orange" icon="shield" label="Fraudulent Transactions"
             value={compact(d?.fraud_detected ?? 0)}
             delta={d ? pctDelta(d.fraud_detected, d.yesterday_fraud_detected) : null} />
        <Kpi tone="red" icon="rate" label="Fraud Rate"
             value={pct(d?.fraud_rate ?? 0)}
             delta={d ? pctDelta(d.fraud_rate, d.yesterday_fraud_rate) : null} />
      </div>

      <div className="fd-row1">
        <Panel title="Transaction Trends" extra={
          <div className="legend-dots">
            <span className="lg-item"><span className="lg-dot" style={{ background: "#3b82f6" }} />Volume</span>
            <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Flagged</span>
          </div>}>
          {daily.length ? (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => compact(v)} />
                <Tooltip contentStyle={TT} />
                <Line dataKey="volume" name="Transactions" stroke="#3b82f6" strokeWidth={2}
                      dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }} />
                <Line dataKey="flagged" name="Flagged" stroke="#f43f5e" strokeWidth={2}
                      dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty>No daily data yet.</Empty>}
        </Panel>

        <Panel title="Transaction Distribution">
          {distRows.length ? (
            <div className="fbt-wrap">
              <div className="fbt-donut">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={distRows} dataKey="count" nameKey="label"
                         innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                      {distRows.map((x) => <Cell key={x.name} fill={x.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={TT} formatter={(v, n) => [v + " txns", n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="fbt-center">
                  <div className="fbt-total">{compact(d?.total_transactions ?? 0)}</div>
                  <div className="fbt-sub">Total Transactions</div>
                </div>
              </div>
              <div className="fbt-legend">
                {distRows.map((x) => (
                  <div key={x.name} className="fbt-row">
                    <span className="lg-dot" style={{ background: x.fill }} />
                    <span className="fbt-name">{x.label}</span>
                    <b className="fbt-pct">{x.pctStr}</b>
                  </div>))}
              </div>
            </div>
          ) : <Empty>No data yet.</Empty>}
        </Panel>

        <Panel title="Customer Segmentation">
          {segRows.some((x) => x.count) ? (
            <div className="fbt-wrap">
              <div className="fbt-donut">
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={segRows} dataKey="count" nameKey="name"
                         innerRadius={50} outerRadius={80} paddingAngle={3} stroke="none">
                      {segRows.map((x) => <Cell key={x.name} fill={x.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={TT} formatter={(v, n) => [v + " customers", n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="fbt-center">
                  <div className="fbt-total">
                    {compact(segRows.reduce((s, x) => s + x.count, 0))}
                  </div>
                  <div className="fbt-sub">Customers</div>
                </div>
              </div>
              <div className="fbt-legend">
                {segRows.map((x) => (
                  <div key={x.name} className="fbt-row">
                    <span className="lg-dot" style={{ background: x.fill }} />
                    <span className="fbt-name">{x.name} Risk</span>
                    <b className="fbt-pct">{x.pctStr}</b>
                  </div>))}
              </div>
            </div>
          ) : <Empty>No customers yet.</Empty>}
        </Panel>
      </div>

      <div className="fd-row1">
        <Panel title="Transaction Volume by Hour">
          {hourly.length ? (
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={hourly} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="hourGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#60a5fa" />
                    <stop offset="100%" stopColor="#1d4ed8" />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 10 }}
                       interval={2} tickMargin={6} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => compact(v)} />
                <Tooltip contentStyle={TT} />
                <Bar dataKey="volume" fill="url(#hourGrad)" radius={[3, 3, 0, 0]}
                     maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No hourly data yet.</Empty>}
        </Panel>

        <Panel title="Top Merchants by Transaction Value">
          {(a?.top_merchants || []).length ? (
            <div className="hbars">
              {(() => {
                const colors = ["#3b82f6", "#a855f7", "#10b981", "#f59e0b", "#f43f5e", "#22d3ee"];
                const max = Math.max(...a.top_merchants.map((x) => x.value));
                return a.top_merchants.map((x, i) => (
                  <div key={x.name} className="hbar-row">
                    <span className="hbar-name">{x.name}</span>
                    <div className="hbar-track">
                      <div className="hbar-fill"
                           style={{ width: Math.max(3, 100 * x.value / max) + "%",
                                    background: colors[i % colors.length] }} />
                    </div>
                    <b className="hbar-pct">{money(x.value)}</b>
                  </div>));
              })()}
            </div>
          ) : <Empty>No merchant data yet.</Empty>}
        </Panel>

        <Panel title="Geographic Analysis" extra={
          <div className="legend-dots">
            {Object.entries(SEV).map(([k, c]) => (
              <span key={k} className="lg-item">
                <span className="lg-dot" style={{ background: c }} />{k}</span>))}
          </div>}>
          {geoPts.length ? (
            <div className="td-geo">
              <GeoMap points={geoPts} compact />
              <div className="fd-geo-legend">
                {geoPts.slice(0, 5).map((g) => (
                  <div key={g.name} className="fbt-row">
                    <span className="lg-dot" style={{ background: g.color }} />
                    <span className="fbt-name">{g.name}</span>
                    <b className="fbt-pct">{g.count}</b>
                  </div>))}
              </div>
            </div>
          ) : <Empty>No geo flags yet.</Empty>}
        </Panel>
      </div>

      <div className="fd-row3">
        <Panel title="Spending Pattern Analysis">
          <div className="vol-tabs" style={{ marginBottom: 10 }}>
            {[["category", "By Category"], ["location", "By Location"],
              ["channel", "By Channel"]].map(([k, v]) => (
              <button key={k} className={"vol-tab" + (spendTab === k ? " active" : "")}
                      onClick={() => setSpendTab(k)}>{v}</button>
            ))}
          </div>
          {spendRows.length ? (
            <div className="hbars">
              {spendRows.map((x, i) => {
                const val = x.share || (100 * (x.count || 0) / spendTotal);
                const colors = ["#3b82f6", "#a855f7", "#10b981", "#f59e0b", "#f43f5e", "#94a3b8"];
                return (
                  <div key={x.name} className="hbar-row">
                    <span className="hbar-name">{x.name}</span>
                    <div className="hbar-track">
                      <div className="hbar-fill"
                           style={{ width: Math.max(3, val) + "%",
                                    background: colors[i % colors.length] }} />
                    </div>
                    <b className="hbar-pct">
                      {x.share != null && x.share > 0 ? x.share + "%"
                        : (100 * (x.count || 0) / spendTotal).toFixed(1) + "%"}
                    </b>
                  </div>);
              })}
            </div>
          ) : <Empty>No spend data yet.</Empty>}
        </Panel>

        <Panel title="Key Insights">
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
                </div>))}
            </div>
          ) : <Empty>Collecting insights...</Empty>}
        </Panel>

        <Panel title="Time Series Analysis" extra={
          <div className="legend-dots">
            {["Card Payment", "Online Purchase", "Mobile Money", "Bank Transfer"]
              .map((k) => (
                <span key={k} className="lg-item">
                  <span className="lg-dot" style={{ background: CH_COLORS[k] }} />{k.split(" ")[0]}
                </span>))}
          </div>}>
          {(a?.channel_daily || []).length ? (
            <ResponsiveContainer width="100%" height={210}>
              <LineChart data={a.channel_daily}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => compact(v)} />
                <Tooltip contentStyle={TT} />
                {["Card Payment", "Online Purchase", "Mobile Money", "Bank Transfer"]
                  .map((k) => (
                    <Line key={k} dataKey={k} name={k} stroke={CH_COLORS[k]}
                          strokeWidth={2} dot={false} />))}
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty>No channel series yet.</Empty>}
        </Panel>
      </div>

      {report && <div />}
    </div>
  );
}
