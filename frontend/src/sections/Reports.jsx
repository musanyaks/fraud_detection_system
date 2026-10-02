import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
         ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Panel, Empty } from "../components/bits.jsx";
import GeoMap from "../components/GeoMap.jsx";
import { money, compact, pct, cust } from "../lib/format.js";
import { jsPDF } from "jspdf";
import { useLive } from "../lib/useLive.js";

const TT = { background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8 };
const TYPE_COLORS = {
  "Card Not Present": "#a855f7", "Account Takeover": "#f43f5e", "Velocity": "#f59e0b",
  "Location Anomaly": "#22c55e", "Merchant Fraud": "#3b82f6", "Large Amount": "#06b6d4",
  "Other": "#94a3b8",
};

const REPORT_CARDS = [
  { id: "daily",   tone: "blue",   icon: "txn",    title: "Daily Fraud Report",
    sub: "Summary of fraud activity for today's transactions." },
  { id: "weekly",  tone: "green",  icon: "coins",  title: "Weekly Transaction Report",
    sub: "Transaction volume, flagged counts and performance by day." },
  { id: "customer", tone: "purple", icon: "people", title: "Customer Risk Report",
    sub: "Per-customer risk scores and behavioral analysis." },
  { id: "merchant", tone: "orange", icon: "coins",  title: "Merchant Risk Report",
    sub: "Merchant value, flagged activity and risk concentration." },
  { id: "model",   tone: "red",    icon: "shield", title: "Model Performance Report",
    sub: "ML accuracy metrics and evaluation curves." },
];

function buildFullPdf(data, reportName) {
  const doc = new jsPDF();
  const d = data.overview || {}, a = data.analytics || {};
  let y = 16;
  const H = (s, size = 13) => { doc.setFontSize(size); doc.text(s, 14, y); y += 8; };
  const KV = (k, v) => { if (y > 280) { doc.addPage(); y = 16; }
    doc.setFontSize(10); doc.text(k, 14, y); doc.text(String(v), 95, y); y += 7; };

  doc.setFontSize(17);
  doc.text("FraudShield - " + (reportName || "Full Report"), 14, y); y += 7;
  doc.setFontSize(9);
  doc.text("Generated: " + new Date().toLocaleString(), 14, y); y += 10;

  H("Overview", 12);
  KV("Total transactions", (d.total_transactions ?? 0).toLocaleString());
  KV("Fraudulent transactions", (d.fraud_detected ?? 0).toLocaleString());
  KV("Fraud rate", ((d.fraud_rate ?? 0) * 100).toFixed(3) + "%");
  KV("Amount at risk", "$" + (d.amount_at_risk ?? 0).toLocaleString());
  KV("Total volume (sampled)", "$" + (d.total_amount ?? 0).toLocaleString());
  KV("Open alerts", d.open_alerts ?? 0);
  KV("High-risk customers", d.high_risk_customers ?? 0);

  H("7-Day Trend", 12);
  (a.daily || []).forEach((x) =>
    KV(x.day, "volume " + (x.volume || 0) + " | flagged " + (x.flagged || 0) +
       " | rate " + ((x.fraud_rate ?? 0) * 100).toFixed(2) + "%"));

  H("Risk Distribution", 12);
  Object.entries(a.risk_distribution || {}).forEach(([k, v]) => KV(k, v));

  H("Fraud by Type", 12);
  (a.fraud_by_type || []).forEach((x) => KV(x.name, x.count));

  H("Top Merchants by Value", 12);
  (a.top_merchants || []).forEach((m) => KV(m.name, "$" + m.value.toLocaleString()));

  H("Top Risk Customers", 12);
  (a.top_risk_customers || []).forEach((c) =>
    KV(String(c.customer_id).slice(0, 8),
       (c.risk_level || "") + " " + (c.risk_score ?? "") + " | flagged " + (c.count ?? "")));

  H("Flagged by Location", 12);
  (a.fraud_by_location || []).forEach((x) => KV(x.name, x.count));

  doc.save("fraudshield-full-report.pdf");
}

const SIZES_KEY = "fs_report_sizes";
const getSizes = () => { try { return JSON.parse(localStorage.getItem(SIZES_KEY) || "{}"); }
  catch { return {}; } };
const rememberSize = (type, bytes) => {
  const s = getSizes(); s[type] = bytes;
  localStorage.setItem(SIZES_KEY, JSON.stringify(s));
};

function buildPdf(type, d, a, cs, ev) {
  const doc = new jsPDF();
  const title = { daily: "Daily Fraud Report", weekly: "Weekly Transaction Report",
    customer: "Customer Risk Report", merchant: "Merchant Risk Report",
    model: "Model Performance Report" }[type] || "Report";
  doc.setFontSize(16);
  doc.text("FraudShield - " + title, 14, 18);
  doc.setFontSize(10);
  doc.text("Generated: " + new Date().toLocaleString(), 14, 26);
  let y = 38;
  const line = (k, v) => { if (y > 280) { doc.addPage(); y = 20; }
    doc.text(k, 14, y); doc.text(String(v), 90, y); y += 7; };

  line("Total transactions", (d?.total_transactions ?? 0).toLocaleString());
  line("Fraudulent transactions", (d?.fraud_detected ?? 0).toLocaleString());
  line("Fraud rate", ((d?.fraud_rate ?? 0) * 100).toFixed(3) + "%");
  line("Amount at risk", "$" + (d?.amount_at_risk ?? 0).toLocaleString());
  line("Open alerts", d?.open_alerts ?? 0);
  y += 4; doc.setFontSize(12); doc.text("7-day trend", 14, y); y += 7; doc.setFontSize(10);
  (a?.daily || []).forEach((x) =>
    line(x.day, "vol " + (x.volume || 0) + " - flagged " + (x.flagged || 0)));
  if (type === "customer") {
    y += 4; doc.setFontSize(12); doc.text("Top risk customers", 14, y); y += 7; doc.setFontSize(10);
    (cs?.rows || []).slice(0, 10).forEach((r) =>
      line(r.customer_id.slice(0, 8), r.risk_level + " " + r.risk_score + " - " + r.name));
  }
  if (type === "merchant") {
    y += 4; doc.setFontSize(12); doc.text("Top merchants by value", 14, y); y += 7; doc.setFontSize(10);
    (a?.top_merchants || []).forEach((m) => line(m.name, "$" + m.value.toLocaleString()));
  }
  if (type === "model" && ev?.ensemble) {
    line("ROC-AUC", ev.ensemble.roc_auc);
    line("PR-AUC", ev.ensemble.pr_auc);
    line("Precision", ev.ensemble.precision);
    line("Recall", ev.ensemble.recall);
    line("F1", ev.ensemble.f1);
  }
  doc.save("fraudshield-" + type + "-report.pdf");
}

function buildCsv(type, d, a, cs, ev) {
  if (type === "weekly" || type === "daily") {
    return "day,volume,flagged,fraud_rate\n" +
      (a?.daily || []).map((x) =>
        [x.day, x.volume, x.flagged, x.fraud_rate].join(",")).join("\n");
  }
  if (type === "customer") {
    return "customer_id,name,email,city,risk_level,risk_score,txn_count,total_spent,status\n" +
      (cs?.rows || []).map((r) => [r.customer_id, '"' + r.name + '"', r.email, r.city,
        r.risk_level, r.risk_score, r.txn_count, r.total_spent, r.status].join(",")).join("\n");
  }
  if (type === "merchant") {
    return "merchant,value_usd\n" +
      (a?.top_merchants || []).map((m) => [m.name, m.value].join(",")).join("\n");
  }
  return "metric,value\n" + Object.entries((ev && ev.ensemble) || {})
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => [k, v].join(",")).join("\n");
}

function saveFile(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  return blob.size;
}

export default function Reports() {
  const ov = useLive("/metrics/overview", {}, 8000);
  const an = useLive("/metrics/analytics", {}, 12000);
  const cs = useLive("/customers/summary", {}, 30000);
  const ev = useLive("/models/evaluation", {}, 60000);

  const [history, setHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem("fs_reports") || "[]"); }
    catch { return []; }
  });
  const [riskFilter, setRiskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [reportType, setReportType] = useState("daily");

  useEffect(() => {
    localStorage.setItem("fs_reports", JSON.stringify(history.slice(0, 8)));
  }, [history]);

  const d = ov.data, a = an.data;

  const dailyAvg = useMemo(() => {
    // estimate per-transaction average from sampled volume/value
    const n = d?.total_transactions || 0;
    return n ? (d?.total_amount || 0) / n : 0;
  }, [d]);

  const flaggedValue = useMemo(() => {
    if (!a?.daily) return [];
    return a.daily.map((x) => ({
      day: x.day,
      loss: Math.round((x.flagged || 0) * dailyAvg),
      volume: Math.round((x.volume || 0) * dailyAvg),
    }));
  }, [a, dailyAvg]);

  const fbt = useMemo(() => {
    const rows = a?.fraud_by_type || [];
    const total = rows.reduce((s, x) => s + x.count, 0);
    return rows.map((x, i) => ({ ...x,
      pct: total ? (100 * x.count / total).toFixed(1) + "%" : "0%",
      fill: TYPE_COLORS[x.name] || ["#a855f7", "#f43f5e", "#f59e0b", "#22c55e",
        "#3b82f6", "#94a3b8"][i % 6] }));
  }, [a]);

  const geoPts = useMemo(() => (a?.geo_points || []).map((g) => ({
    ...g, name: g.name || g.location,
    color: g.max_score >= 80 ? "#ef4444" : g.max_score >= 55 ? "#f97316" : "#eab308",
  })), [a]);

  const topCust = useMemo(() => {
    let rows = (cs.data?.rows || []).slice(0, 5);
    if (riskFilter) rows = rows.filter((r) => r.risk_level === riskFilter);
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    return rows;
  }, [cs.data, riskFilter, statusFilter]);

  const modelTiles = useMemo(() => {
    const e = ev.data?.ensemble;
    if (!e) return [];
    return [
      { label: "Accuracy", val: e.roc_auc != null ? e.roc_auc : null, color: "#3b82f6" },
      { label: "Precision", val: e.precision, color: "#a855f7" },
      { label: "Recall", val: e.recall, color: "#22c55e" },
      { label: "F1 Score", val: e.f1, color: "#f97316" },
      { label: "ROC-AUC", val: e.roc_auc, color: "#06b6d4" },
      { label: "PR-AUC", val: e.pr_auc, color: "#ef4444" },
    ].filter((x) => x.val != null);
  }, [ev.data]);

  const buildReport = (type) => {
    const stamp = new Date().toISOString();
    switch (type) {
      case "daily":
        return { report: "daily-fraud", generated: stamp, overview: d, analytics: a };
      case "weekly":
        return { report: "weekly-transactions", generated: stamp,
                 daily: a?.daily || [], hourly: a?.hourly || [] };
      case "customer":
        return { report: "customer-risk", generated: stamp,
                 distribution: cs.data?.distribution || {}, rows: cs.data?.rows || [] };
      case "merchant":
        return { report: "merchant-risk", generated: stamp,
                 top_merchants: a?.top_merchants || [],
                 flagged_by_category: a?.fraud_by_category || [],
                 flagged_by_location: a?.fraud_by_location || [] };
      case "model":
        return { report: "model-performance", generated: stamp, evaluation: ev.data };
      default:
        return { report: type, generated: stamp };
    }
  };

  const record = (type, title, bytes, kind) => {
    rememberSize(type, bytes);
    setHistory((h) => [{
      type, kind, title: title || type,
      when: new Date().toLocaleString(),
      size: bytes > 1048576 ? (bytes / 1048576).toFixed(1) + " MB"
                            : (bytes / 1024).toFixed(1) + " KB",
    }, ...h].slice(0, 8));
  };

  const generate = (type, title, kind) => {
    const size = saveFile(`fraudshield-${type}-report.json`, buildReport(type));
    record(type, title, size, kind);
  };

  const downloadTyped = (item) => {
    if (item.kind === "pdf") {
      const doc = buildPdf(item.type, d, a, cs.data, ev.data);
      const blob = doc.output("blob");
      rememberSize(item.type, blob.size);
      record(item.type, item.label, blob.size);
    } else {
      const csv = buildCsv(item.type, d, a, cs.data, ev.data);
      const blob = new Blob([csv], { type: "text/csv" });
      const a2 = document.createElement("a");
      a2.href = URL.createObjectURL(blob);
      a2.download = `fraudshield-${item.type}-report.csv`;
      a2.click();
      rememberSize(item.type, blob.size);
      record(item.type, item.label, blob.size);
    }
  };

  const quickDownloads = [
    { label: "Fraud Summary Report",  kind: "pdf",   type: "daily" },
    { label: "Weekly Transaction Report", kind: "excel", type: "weekly" },
    { label: "Customer Risk Report",  kind: "pdf",   type: "customer" },
    { label: "Merchant Risk Report",  kind: "excel", type: "merchant" },
    { label: "Model Performance Report", kind: "pdf", type: "model" },
  ];

  const trendData = useMemo(() => (a?.daily || []).map((x) => ({
    day: x.day, total: x.volume, fraudulent: x.flagged })), [a]);

  return (
    <div>
      {/* ---- report type cards ---- */}
      <div className="rp-cards">
        {REPORT_CARDS.map((c) => (
          <div key={c.id} className={"rp-card " + c.tone}>
            <div className="rp-card-icon">{c.icon}</div>
            <div className="rp-card-title">{c.title}</div>
            <div className="rp-card-sub">{c.sub}</div>
            <button className={"btn-primary rp-btn " + c.tone}
                    onClick={() => generate(c.id, c.title)}>
              Generate Report
            </button>
          </div>
        ))}
      </div>

      <div className="fd-row1">
        {/* ---- fraud summary + trend ---- */}
        <Panel title="Fraud Summary Report" extra={
          <span className="muted">{new Date().toLocaleDateString("en-US",
            { month: "short", day: "2-digit", year: "numeric" })}</span>}>
          <div className="sum-grid">
            <div className="kpi"><div className="kpi-top">Total Transactions</div>
              <div className="kpi-value">{compact(d?.total_transactions ?? 0)}</div></div>
            <div className="kpi"><div className="kpi-top">Fraudulent Transactions</div>
              <div className="kpi-value">{compact(d?.fraud_detected ?? 0)}</div></div>
            <div className="kpi"><div className="kpi-top">Fraud Rate</div>
              <div className="kpi-value">{pct(d?.fraud_rate ?? 0)}</div></div>
            <div className="kpi"><div className="kpi-top">Total Flagged Value</div>
              <div className="kpi-value">{money(d?.amount_at_risk ?? 0)}</div></div>
          </div>
          <div className="legend-dots" style={{ justifyContent: "flex-end", margin: "8px 0" }}>
            <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Fraudulent</span>
            <span className="lg-item"><span className="lg-dot" style={{ background: "#3b82f6" }} />Total</span>
          </div>
          {trendData.length ? (
            <ResponsiveContainer width="100%" height={170}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => compact(v)} />
                <Tooltip contentStyle={TT} />
                <Line dataKey="total" name="Total Transactions" stroke="#3b82f6"
                      strokeWidth={2} dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }} />
                <Line dataKey="fraudulent" name="Fraudulent" stroke="#f43f5e"
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
                    <Tooltip contentStyle={TT} formatter={(v, n) => [v + " flagged", n]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="fbt-center">
                  <div className="fbt-total">
                    {fbt.reduce((s, x) => s + x.count, 0).toLocaleString()}
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
                  </div>))}
              </div>
            </div>
          ) : <Empty>No flagged cases yet.</Empty>}
        </Panel>

        {/* ---- report filters (functional for top-risk table) ---- */}
        <Panel title="Report Filters">
          <div className="f2-group" style={{ marginBottom: 10 }}>
            <span className="f2-label">Date Range</span>
            <select className="mini-select" defaultValue="7d">
              <option value="7d">Last 7 days</option>
              <option value="today">Today</option>
              <option value="30d">Last 30 days</option>
            </select>
          </div>
          <div className="f2-group" style={{ marginBottom: 10 }}>
            <span className="f2-label">Report Type</span>
            <select className="mini-select" value={reportType}
                    onChange={(e) => setReportType(e.target.value)}>
              {REPORT_CARDS.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <div className="f2-group" style={{ marginBottom: 10 }}>
            <span className="f2-label">Risk Level</span>
            <select className="mini-select" value={riskFilter}
                    onChange={(e) => setRiskFilter(e.target.value)}>
              <option value="">All Levels</option>
              {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div className="f2-group" style={{ marginBottom: 10 }}>
            <span className="f2-label">Status</span>
            <select className="mini-select" value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Statuses</option>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <button className="btn-primary" style={{ width: "100%" }}
                  onClick={() => generate(reportType,
                    (REPORT_CARDS.find((c) => c.id === reportType) || {}).title)}>
            Generate Report
          </button>
        </Panel>
      </div>

      <div className="fd-row2">
        {/* ---- regional ---- */}
        <Panel title="Regional Fraud Report">
          {geoPts.length ? (
            <div className="fd-geo-2col">
              <GeoMap points={geoPts} compact />
              <table className="tbl wide">
                <thead>
                  <tr><th>Region</th><th>Flagged Txns</th><th>Max Risk</th></tr>
                </thead>
                <tbody>
                  {geoPts.slice(0, 6).map((g) => (
                    <tr key={g.name}>
                      <td>{g.name}</td>
                      <td>{g.count}</td>
                      <td className="risk-num">{g.max_score}</td>
                    </tr>))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No regional flags yet.</Empty>}
        </Panel>

        <Panel title="Top Risk Customers" extra={
          <span className="view-all">by risk score</span>}>
          {topCust.length ? (
            <table className="tbl wide">
              <thead>
                <tr><th>Customer ID</th><th>Risk Score</th>
                    <th>Total Transactions</th><th>Status</th></tr>
              </thead>
              <tbody>
                {topCust.map((r) => (
                  <tr key={r.customer_id}>
                    <td className="mono">{cust(r.customer_id)}</td>
                    <td className="risk-num">{r.risk_score}</td>
                    <td>{r.txn_count}</td>
                    <td><span className={"st " + (r.status === "Active" ? "st-approved" : "st-declined")}>
                      {r.status}</span></td>
                  </tr>))}
              </tbody>
            </table>
          ) : <Empty>No customers match the filters.</Empty>}
        </Panel>

        {/* ---- quick downloads + history ---- */}
        <Panel title="Quick Downloads">
          <div className="dl-list">
            {quickDownloads.map((x) => {
              const sizes = getSizes();
              const kb = sizes[x.type];
              const isPdf = x.kind === "pdf";
              return (
                <div key={x.type} className="dl-row">
                  <span className={"doc-ico " + (isPdf ? "doc-pdf" : "doc-xls")}>
                    {isPdf ? "PDF" : "XLS"}
                  </span>
                  <span className="dl-info">
                    <span className="dl-name">{x.label} ({isPdf ? "PDF" : "Excel"})</span>
                    <span className="dl-sub">{kb ? (kb > 1048576
                      ? (kb / 1048576).toFixed(1) + " MB"
                      : (kb / 1024).toFixed(1) + " KB") : "ready"}</span>
                  </span>
                  <button className="dl-ico" title="download"
                          onClick={() => downloadTyped(x)}>⇩</button>
                </div>
              );
            })}
          </div>
          <h4 className="modal-h" style={{ marginTop: 14 }}>Report History</h4>
          {history.length ? (
            <div className="dl-list">
              {history.map((h, i) => (
                <div key={i} className="dl-row" style={{ cursor: "default" }}>
                  <span className={"hist-dot hist-" + (h.type || "daily")}>
                    {h.kind === "excel" ? "X" : "P"}
                  </span>
                  <span className="dl-info">
                    <span className="dl-name">{h.title}</span>
                    <span className="dl-sub">{h.when} · {h.size}</span>
                  </span>
                  <span className="st st-approved">Completed</span>
                </div>))}
            </div>
          ) : <Empty>No reports generated yet this session.</Empty>}
        </Panel>
      </div>

      <div className="fd-row3">
        <Panel title="Model Performance Report" extra={
          <span className="muted">{ev.data ? "v" + ev.data.version.slice(0, 24) : ""}</span>}>
          {modelTiles.length ? (
            <div className="mp-grid">
              {modelTiles.map((x) => (
                <div key={x.label} className="mp-tile">
                  <div className="mp-val" style={{ color: x.color }}>
                    {(x.val * 100).toFixed(1)}%
                  </div>
                  <div className="mp-label">{x.label}</div>
                </div>))}
            </div>
          ) : <Empty>Run training to populate.</Empty>}
        </Panel>

        <Panel title="Flagged Value Trend (Estimated)"
               extra={<span className="muted">flagged count × today's avg ticket</span>}>
          {flaggedValue.length ? (
            <ResponsiveContainer width="100%" height={190}>
              <BarChart data={flaggedValue}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => "$" + compact(v)} />
                <Tooltip contentStyle={TT}
                         formatter={(v) => ["$" + Number(v).toLocaleString(), "Estimated"]} />
                <Bar dataKey="loss" name="Flagged value" fill="#f43f5e" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty>No daily data yet.</Empty>}
        </Panel>

        <Panel title="Export All">
          <button className="btn-primary" style={{ width: "100%" }}
                  onClick={() => {
                    buildFullPdf({ overview: d, analytics: a }, "Full Report");
                    record("full", "Full Report Bundle",
                      getSizes()["full"] || 0, "pdf");
                  }}>
            ⤓ Download Full Report (PDF)
          </button>
          <div className="muted" style={{ marginTop: 8 }}>
            PDF with overview metrics, 7-day trend table, risk distribution,
            fraud types, top merchants, top-risk customers and flagged locations.
          </div>
        </Panel>
      </div>
    </div>
  );
}
