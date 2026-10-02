import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
         ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Kpi from "../components/Kpi.jsx";
import { Panel, Empty, RiskBadge } from "../components/bits.jsx";
import GeoMap from "../components/GeoMap.jsx";
import { money, compact, cust, txn, dt, hhmm } from "../lib/format.js";
import { useLive } from "../lib/useLive.js";
import { apiPatch } from "../lib/api.js";

const SEV_COLORS = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308", LOW: "#22c55e" };
const STATUSES = ["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"];

const alt = (id) => {
  if (!id) return "-";
  const hex = String(id).replace(/-/g, "");
  return "ALT-" + String(parseInt(hex.slice(0, 12), 16) % 10000000).padStart(7, "0");
};

const alertType = (a) => {
  const txt = (a.reasons || []).join(" ").toLowerCase();
  if (txt.includes("velocity")) return "Velocity Check";
  if (txt.includes("impossible travel")) return "Impossible Travel";
  if (txt.includes("unseen") || txt.includes("never-seen")) return "Card Not Present";
  if (txt.includes("failed attempts")) return "Account Takeover";
  if (txt.includes("location")) return "Unusual Location";
  if (txt.includes("amount")) return "Large Transaction";
  if (txt.includes("merchant")) return "Merchant Risk";
  return "Other";
};

const statusPill = (s) => {
  const map = { OPEN: ["New", "st-flagged"], INVESTIGATING: ["Investigating", "st-review"],
    RESOLVED: ["Resolved", "st-approved"], FALSE_POSITIVE: ["Under Review", "st-review"] };
  const [label, cls] = map[s] || [s, ""];
  return <span className={"st " + cls}>{label}</span>;
};

function AlertModal({ a, onClose, onUpdated }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(a.status);
  const [assignee, setAssignee] = useState(a.assigned_to || "analyst");
  const [notes, setNotes] = useState("");

  const apply = async () => {
    setBusy(true);
    try {
      await apiPatch("/alerts/" + a.alert_id,
        { status, assigned_to: assignee, notes });
      onUpdated();
      onClose();
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title mono">{alt(a.alert_id)}</div>
            <div className="muted">{dt(a.created_at)}</div>
          </div>
          <button className="modal-x" onClick={onClose}>x</button>
        </div>
        <div className="modal-cols">
          <div>
            <h4 className="modal-h">Alert</h4>
            <div className="td-row"><span>Customer ID</span><b className="mono">{cust(a.customer_id)}</b></div>
            <div className="td-row"><span>Transaction ID</span><b className="mono">{txn(a.transaction_id)}</b></div>
            <div className="td-row"><span>Amount</span><b>{money(a.amount)}</b></div>
            <div className="td-row"><span>Type</span><b>{alertType(a)}</b></div>
            <div className="td-row"><span>Severity</span><RiskBadge level={a.severity} /></div>
            <div className="td-row"><span>Risk Score</span>
              <b className="risk-num">{Number(a.risk_score).toFixed(1)} / 100</b></div>
            <div className="td-row"><span>Fraud Probability</span><b>{a.fraud_probability}</b></div>
            <div className="td-row"><span>Assigned To</span><b>{a.assigned_to || "-"}</b></div>
          </div>
          <div>
            <h4 className="modal-h">Detection Reasons</h4>
            <ul className="reasons">
              {(a.reasons || ["None recorded"]).map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <h4 className="modal-h">Case Actions</h4>
            <div className="filters col" style={{ gap: 8 }}>
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <input value={assignee} onChange={(e) => setAssignee(e.target.value)}
                     placeholder="assign to" />
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                     placeholder="investigation notes" />
              <button className="btn-primary" disabled={busy} onClick={apply}>
                {busy ? "Saving..." : "Update Alert"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Alerts({ onNavigate }) {
  const open   = useLive("/alerts", { status: "OPEN" }, 6000);
  const inv    = useLive("/alerts", { status: "INVESTIGATING" }, 10000);
  const res    = useLive("/alerts", { status: "RESOLVED" }, 15000);
  const fp     = useLive("/alerts", { status: "FALSE_POSITIVE" }, 15000);
  const an     = useLive("/metrics/analytics", {}, 12000);
  const ov     = useLive("/metrics/overview", {}, 10000);
  const cs     = useLive("/customers/summary", {}, 30000);

  const [dType, setDType] = useState("");
  const [dSev, setDSev] = useState("");
  const [dStatus, setDStatus] = useState("");
  const [type, setType] = useState("");
  const [sev, setSev] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [checked, setChecked] = useState(() => new Set());
  const [sel, setSel] = useState(null);
  const [bulkMsg, setBulkMsg] = useState(null);

  const all = useMemo(() => [
    ...(open.data || []).map((x) => ({ ...x, status: "OPEN" })),
    ...(inv.data || []).map((x) => ({ ...x, status: "INVESTIGATING" })),
    ...(res.data || []).map((x) => ({ ...x, status: "RESOLVED" })),
    ...(fp.data || []).map((x) => ({ ...x, status: "FALSE_POSITIVE" })),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)), [open.data, inv.data, res.data, fp.data]);

  const rows = useMemo(() => {
    let r = all;
    if (type) r = r.filter((a) => alertType(a) === type);
    if (sev) r = r.filter((a) => a.severity === sev);
    if (status) r = r.filter((a) => a.status === status);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((a) =>
        `${alt(a.alert_id)} ${cust(a.customer_id)} ${txn(a.transaction_id)} ${alertType(a)}`
          .toLowerCase().includes(s));
    }
    return r;
  }, [all, type, sev, status, q]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * pageSize, cur * pageSize + pageSize);
  const pageIds = view.map((x) => String(x.alert_id));
  const allChecked = pageIds.length > 0 && pageIds.every((id) => checked.has(id));

  const toggleAll = () => setChecked(() => {
    const n = new Set(checked);
    pageIds.forEach((id) => (allChecked ? n.delete(id) : n.add(id)));
    return n;
  });
  const toggleOne = (id) => setChecked(() => {
    const n = new Set(checked);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const applyFilters = () => { setType(dType); setSev(dSev); setStatus(dStatus); setPage(0); };
  const resetFilters = () => {
    setQ(""); setDType(""); setDSev(""); setDStatus("");
    setType(""); setSev(""); setStatus(""); setPage(0);
  };

  const countBy = (sevName) => all.filter((a) => a.severity === sevName).length;

  const sevRows = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((k) => ({
    name: k, count: countBy(k),
    pctStr: all.length ? (100 * countBy(k) / all.length).toFixed(1) + "%" : "0%",
    fill: SEV_COLORS[k] }));

  const typeRows = useMemo(() => {
    const counts = {};
    all.forEach((a) => { const t = alertType(a); counts[t] = (counts[t] || 0) + 1; });
    return Object.entries(counts).sort((x, y) => y[1] - x[1]).slice(0, 6)
      .map(([name, count]) => ({ name, count,
        pct: (100 * count / (all.length || 1)).toFixed(1) + "%" }));
  }, [all]);

  const geoPts = useMemo(() => ((an.data?.geo_points) || []).map((g) => ({
    ...g, name: g.name || g.location,
    color: g.max_score >= 80 ? "#ef4444" : g.max_score >= 55 ? "#f97316" : "#eab308",
  })), [an.data]);

  const trend = (an.data?.daily || []).map((x) => ({
    day: x.day, total: x.volume, critical: x.flagged }));

  const topCust = useMemo(() => {
    const counts = {};
    all.forEach((a) => {
      const k = String(a.customer_id);
      counts[k] = counts[k] || { count: 0, score: 0, last: a.created_at };
      counts[k].count += 1;
      counts[k].score = Math.max(counts[k].score, Number(a.risk_score) || 0);
    });
    return Object.entries(counts).sort((x, y) => y[1].score - x[1].score).slice(0, 5)
      .map(([id, v]) => ({ customer_id: id, ...v }));
  }, [all]);

  const markAllRead = async () => {
    const targets = rows.filter((a) => a.status === "OPEN");
    if (!targets.length) { setBulkMsg("No OPEN alerts in the current view."); return; }
    if (!window.confirm("Move " + targets.length + " OPEN alert(s) to INVESTIGATING?")) return;
    let ok = 0, failed = 0;
    for (const a of targets) {
      try {
        await apiPatch("/alerts/" + a.alert_id, { status: "INVESTIGATING" });
        ok += 1;
      } catch {
        failed += 1;   // keep processing the rest; report at the end
      }
    }
    setBulkMsg(ok + " alert(s) moved to INVESTIGATING" +
      (failed ? ", " + failed + " failed" : "") + ".");
    setTimeout(() => setBulkMsg(null), 4000);
  };

  const quickAction = (id) => {
    if (id === "txns") return onNavigate && onNavigate("transactions");
    if (id === "reports") return onNavigate && onNavigate("reports");
  };

  return (
    <div>
      <div className="kpi-row fd-kpis">
        <Kpi tone="red" icon="bell" label="Total Alerts" value={compact(all.length)} note="all statuses" />
        <Kpi tone="orange" icon="bell" label="Critical Alerts" value={compact(countBy("CRITICAL"))} note="severity" />
        <Kpi tone="purple" icon="rate" label="High Severity" value={compact(countBy("HIGH"))} note="severity" />
        <Kpi tone="blue" icon="shield" label="Medium Severity" value={compact(countBy("MEDIUM"))} note="severity" />
        <Kpi tone="green" icon="info" label="Low Severity" value={compact(countBy("LOW"))} note="severity" />
      </div>

      <div className="filters2">
        <div className="f2-group">
          <span className="f2-label">Alert Type</span>
          <select value={dType} onChange={(e) => setDType(e.target.value)}>
            <option value="">All Types</option>
            {["Velocity Check", "Impossible Travel", "Account Takeover",
              "Card Not Present", "Unusual Location", "Large Transaction",
              "Merchant Risk", "Other"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="f2-group">
          <span className="f2-label">Severity</span>
          <select value={dSev} onChange={(e) => setDSev(e.target.value)}>
            <option value="">All Severities</option>
            {["CRITICAL", "HIGH", "MEDIUM", "LOW"].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="f2-group">
          <span className="f2-label">Status</span>
          <select value={dStatus} onChange={(e) => setDStatus(e.target.value)}>
            <option value="">All Statuses</option>
            {["OPEN", "INVESTIGATING", "RESOLVED", "FALSE_POSITIVE"].map((s) =>
              <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="f2-group">
          <span className="f2-label">Time Range</span>
          <select defaultValue="7d">
            <option value="7d">Last 7 days</option>
            <option value="today">Today</option>
          </select>
        </div>
        <div className="f2-group f2-grow">
          <span className="f2-label">Search</span>
          <input placeholder="Search by ID, customer, transaction..."
                 value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        <div className="f2-actions">
          <button className="btn-primary" onClick={applyFilters}>Apply</button>
          <button className="btn-ghost" onClick={resetFilters}>Reset</button>
        </div>
      </div>

      <div className="fd-row1" style={{ gridTemplateColumns: "1fr 340px" }}>
        <Panel title={"Recent Alerts (" + rows.length + ")"} extra={
          <button className="view-all view-all-btn" onClick={markAllRead}>
            Mark All as Read
          </button>}>
            {bulkMsg && <div className="td-reason" style={{ color: "#86efac",
              background: "rgba(34,197,94,.08)", marginBottom: 8 }}>{bulkMsg}</div>}
            {view.length === 0 ? <Empty>No alerts match.</Empty> : (
              <table className="tbl wide">
                <thead>
                  <tr>
                    <th className="chk">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    </th>
                    <th>Alert ID</th><th>Date &amp; Time</th><th>Customer ID</th>
                    <th>Transaction ID</th><th>Type</th><th>Severity</th>
                    <th>Risk Score</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((a) => (
                    <tr key={String(a.alert_id)}
                        className={a.severity === "CRITICAL" ? "flag-row" : ""}
                        onClick={() => setSel(a)}>
                      <td className="chk">
                        <input type="checkbox" checked={checked.has(String(a.alert_id))}
                               onClick={(e) => e.stopPropagation()}
                               onChange={() => toggleOne(String(a.alert_id))} />
                      </td>
                      <td className="mono">{alt(a.alert_id)}</td>
                      <td className="mono">{dt(a.created_at)}</td>
                      <td className="mono">{cust(a.customer_id)}</td>
                      <td className="mono">{txn(a.transaction_id)}</td>
                      <td>{alertType(a)}</td>
                      <td><RiskBadge level={a.severity} /></td>
                      <td className="risk-num">{Number(a.risk_score).toFixed(1)}</td>
                      <td>{statusPill(a.status)}</td>
                      <td>
                        <button className="eye" title="Open case"
                                onClick={(e) => { e.stopPropagation(); setSel(a); }}>
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                               stroke="#8ea0c0" strokeWidth="2">
                            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="pagi">
              <span className="muted">
                Showing {rows.length ? cur * pageSize + 1 : 0}-
                {Math.min(rows.length, (cur + 1) * pageSize)} of {rows.length.toLocaleString()} alerts
              </span>
              <div className="pagi-btns">
                <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>&lt;</button>
                <span className="pagi-cur">{cur + 1}</span>
                <span className="muted">/ {pages}</span>
                <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>&gt;</button>
                <select value={pageSize} onChange={(e) => { setPageSize(+e.target.value); setPage(0); }}>
                  {[10, 15, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
        </Panel>

        <div className="stack">
          <Panel title="Alert Summary">
            {all.length ? (
              <div className="fbt-wrap">
                <div className="fbt-donut">
                  <ResponsiveContainer width="100%" height={150}>
                    <PieChart>
                      <Pie data={sevRows} dataKey="count" nameKey="name"
                           innerRadius={42} outerRadius={66} paddingAngle={2} stroke="none">
                        {sevRows.map((x) => <Cell key={x.name} fill={x.fill} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: "#0f172a",
                        border: "1px solid #1e293b", borderRadius: 8 }} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="fbt-center">
                    <div className="fbt-total">{all.length.toLocaleString()}</div>
                    <div className="fbt-sub">Total Alerts</div>
                  </div>
                </div>
                <div className="fbt-legend">
                  {sevRows.map((x) => (
                    <div key={x.name} className="fbt-row">
                      <span className="lg-dot" style={{ background: x.fill }} />
                      <span className="fbt-name">{x.name}</span>
                      <b className="fbt-pct">{x.pct}</b>
                    </div>))}
                </div>
              </div>
            ) : <Empty>No alerts yet.</Empty>}
          </Panel>

          <Panel title="Alerts by Type">
            {typeRows.length ? (
              <div className="hbars">
                {typeRows.map((x, i) => (
                  <div key={x.name} className="hbar-row">
                    <span className="hbar-name">{x.name}</span>
                    <div className="hbar-track">
                      <div className="hbar-fill"
                           style={{ width: Math.max(4, 100 * x.count / typeRows[0].count) + "%",
                                    background: ["#f43f5e", "#f59e0b", "#3b82f6",
                                                 "#22c55e", "#a855f7", "#94a3b8"][i % 6] }} />
                    </div>
                    <b className="hbar-pct">{x.count} ({x.pct})</b>
                  </div>))}
              </div>
            ) : <Empty>No alerts yet.</Empty>}
          </Panel>

          <Panel title="High Risk Locations">
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
      </div>

      <div className="fd-row3">
        <Panel title="Alerts Trend (7d)" extra={
          <div className="legend-dots">
            <span className="lg-item"><span className="lg-dot" style={{ background: "#3b82f6" }} />Total Transactions</span>
            <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Flagged</span>
          </div>}>
          {trend.length ? (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => compact(v)} />
                <Tooltip contentStyle={{ background: "#0f172a",
                  border: "1px solid #1e293b", borderRadius: 8 }} />
                <Line dataKey="total" name="Total" stroke="#3b82f6" strokeWidth={2}
                      dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }} />
                <Line dataKey="critical" name="Flagged" stroke="#f43f5e" strokeWidth={2}
                      dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty>No trend data yet.</Empty>}
        </Panel>

        <Panel title="Top Risk Customers">
          {topCust.length ? (
            <table className="tbl wide">
              <thead>
                <tr><th>Customer ID</th><th>Total Alerts</th><th>Max Score</th><th>Last Alert</th></tr>
              </thead>
              <tbody>
                {topCust.map((c) => (
                  <tr key={c.customer_id}>
                    <td className="mono">{cust(c.customer_id)}</td>
                    <td>{c.count}</td>
                    <td className="risk-num">{c.score.toFixed(1)}</td>
                    <td className="mono">{c.last ? hhmm(c.last) : "-"}</td>
                  </tr>))}
              </tbody>
            </table>
          ) : <Empty>No alerts yet.</Empty>}
        </Panel>

        <Panel title="Quick Actions">
          <div className="insights">
            <div className="insight">
              <span className="insight-icon" style={{ background: "#3b82f626", color: "#60a5fa" }}>≡</span>
              <div>
                <div className="insight-title" style={{ cursor: "pointer" }}
                     onClick={() => quickAction("txns")}>View All Transactions</div>
                <div className="insight-sub">Full transaction table with filters.</div>
              </div>
            </div>
            <div className="insight">
              <span className="insight-icon" style={{ background: "#22c55e26", color: "#4ade80" }}>✓</span>
              <div>
                <div className="insight-title" style={{ cursor: "pointer" }}
                     onClick={markAllRead}>Bulk Investigate OPEN</div>
                <div className="insight-sub">Move all OPEN alerts in view to INVESTIGATING.</div>
              </div>
            </div>
            <div className="insight">
              <span className="insight-icon" style={{ background: "#a855f726", color: "#c084fc" }}>▤</span>
              <div>
                <div className="insight-title" style={{ cursor: "pointer" }}
                     onClick={() => quickAction("reports")}>Generate Fraud Report</div>
                <div className="insight-sub">Download a PDF report snapshot.</div>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      {sel && (
        <AlertModal a={sel} onClose={() => setSel(null)}
                    onUpdated={() => { setSel(null); }} />
      )}
    </div>
  );
}
