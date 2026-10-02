import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Kpi from "../components/Kpi.jsx";
import { Panel, Empty, RiskBadge } from "../components/bits.jsx";
import { money, compact, pct, cust, dt, hhmm, CHANNEL_LABEL } from "../lib/format.js";
import { useLive } from "../lib/useLive.js";

const RISK_COLORS = { LOW: "#22c55e", MEDIUM: "#eab308", HIGH: "#f97316", CRITICAL: "#ef4444" };

const phone = (id) => {
  const h = String(id).replace(/-/g, "");
  const a = parseInt(h.slice(0, 4), 16) % 900 + 100;
  const b = parseInt(h.slice(4, 8), 16) % 9000 + 1000;
  return "+1 (555) " + a + "-" + b;
};

function IconMail() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8ea0c0" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/></svg>);
}
function IconPhone() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8ea0c0" strokeWidth="2"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1 1 .4 2 .7 2.9a2 2 0 01-.5 2.1L8 10a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.5c.9.3 1.9.6 2.9.7a2 2 0 011.7 2z"/></svg>);
}
function IconPin() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8ea0c0" strokeWidth="2"><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>);
}

function CustomerBreakdown6({ p, level }) {
  const risk = Number(p?.current_risk_score || 0);
  const txn = Number(p?.txn_count_30d || 0);
  const raw = [
    { name: "ML Probability",   w: risk / 100, share: "34.2%", color: "#a855f7" },
    { name: "Behavioural Risk", w: Math.min(1, (p?.fraud_count || 0) / Math.max(1, txn)), share: "22.7%", color: "#f43f5e" },
    { name: "Velocity Risk",    w: Math.min(1, txn / 60), share: "16.3%", color: "#f59e0b" },
    { name: "Geographic Risk",  w: Math.min(1, (p?.known_locations || []).length / 6), share: "12.5%", color: "#10b981" },
    { name: "Merchant Risk",    w: Math.min(1, txn / 200), share: "8.9%", color: "#06b6d4" },
    { name: "Device Risk",      w: Math.min(1, (p?.known_devices || []).length / 5), share: "5.4%", color: "#22d3ee" },
  ];
  const sum = raw.reduce((s, x) => s + x.w, 0) || 0.01;
  const rows = raw.map((x) => ({ ...x, val: ((x.w / sum) * risk).toFixed(1) }));
  return (
    <div className="rb6-wrap">
      <div className="rb6-donut">
        <ResponsiveContainer width="100%" height={140}>
          <PieChart>
            <Pie data={rows} dataKey="val" innerRadius={38} outerRadius={60}
                 stroke="none" paddingAngle={1}>
              {rows.map((x) => <Cell key={x.name} fill={x.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="rb-center">
          <div className="rb-num">{risk.toFixed(1)}</div>
          <div className="rb-sub">{level} Risk</div>
        </div>
      </div>
      <div className="rb6-legend">
        {rows.map((x) => (
          <div key={x.name} className="rb6-row">
            <span className="lg-dot" style={{ background: x.color }} />
            <span className="rb6-name">{x.name}</span>
            <span className="rb6-share">{x.share}</span>
            <b className="rb6-val">{x.val}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityTrend() {
  const an = useLive("/metrics/analytics", {}, 15000);
  const daily = an.data?.daily || [];
  if (!daily.length) return <Empty>No activity yet.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={170}>
      <LineChart data={daily}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
        <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
        <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={(v) => compact(v)} />
        <Tooltip contentStyle={{ background: "#0f172a",
          border: "1px solid #1e293b", borderRadius: 8 }} />
        <Line dataKey="volume" name="Volume" stroke="#3b82f6" strokeWidth={2}
              dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }} />
        <Line dataKey="flagged" name="Flagged" stroke="#f43f5e" strokeWidth={2}
              dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export default function Customers({ onNavigate }) {
  const sum = useLive("/customers/summary", {}, 30000);
  const ov = useLive("/metrics/overview", {}, 8000);

  const [tab, setTab] = useState("all");
  const [q, setQ] = useState("");
  const [riskSel, setRiskSel] = useState("");
  const [statusSel, setStatusSel] = useState("");
  const [stagedRisk, setStagedRisk] = useState("");
  const [stagedStatus, setStagedStatus] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selId, setSelId] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [menuFor, setMenuFor] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  // close kebab menu on outside click
  useEffect(() => {
    if (!menuFor) return;
    const h = () => setMenuFor(null);
    window.addEventListener("click", h);
    return () => window.removeEventListener("click", h);
  }, [menuFor]);

  const rowsAll = useMemo(() => sum.data?.rows || [], [sum.data]);
  const selRow = rowsAll.find((r) => r.customer_id === selId) || null;

  const prof = useLive(selId ? `/customers/${selId}/profile` : null, {}, 30000);
  const ctx = useLive(selId ? `/customers/${selId}/transactions` : null,
                      { limit: 100 }, 10000);

  const rows = useMemo(() => {
    let r = rowsAll;
    if (tab === "high") r = r.filter((x) => x.risk_level === "HIGH" || x.risk_level === "CRITICAL");
    if (tab === "recent") r = r.filter((x) => x.status === "Active");
    if (riskSel) r = r.filter((x) => x.risk_level === riskSel);
    if (statusSel) r = r.filter((x) => x.status === statusSel);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((x) => `${x.name} ${x.email} ${cust(x.customer_id)} ${x.city}`
        .toLowerCase().includes(s));
    }
    return r;
  }, [rowsAll, tab, riskSel, statusSel, q]);

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const view = rows.slice(cur * pageSize, cur * pageSize + pageSize);
  const pageIds = view.map((x) => x.customer_id);
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

  const applyFilters = () => { setRiskSel(stagedRisk); setStatusSel(stagedStatus); setPage(0); };

  const dist = useMemo(() => {
    const dd = sum.data?.distribution || {};
    const total = ["LOW", "MEDIUM", "HIGH", "CRITICAL"].reduce((s, k) => s + (dd[k] || 0), 0);
    return ["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((k) => ({
      name: k, count: dd[k] || 0,
      pctStr: total ? (100 * (dd[k] || 0) / total).toFixed(1) + "%" : "0%",
      fill: RISK_COLORS[k] }));
  }, [sum.data]);

  const active = rowsAll.filter((x) => x.status === "Active").length;
  const highRisk = rowsAll.filter((x) => x.risk_level === "HIGH" || x.risk_level === "CRITICAL").length;

  const p = prof.data?.profile;
  const selTxns = useMemo(() => (Array.isArray(ctx.data) ? ctx.data.slice(0, 6) : []),
    [ctx.data]);
  const preferred = useMemo(() => {
    const counts = {};
    (Array.isArray(ctx.data) ? ctx.data : []).forEach((x) => {
      counts[x.channel] = (counts[x.channel] || 0) + 1;
    });
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return top ? (CHANNEL_LABEL[top[0]] || top[0]) : "-";
  }, [ctx.data]);

  const exportCsv = () => {
    const head = "customer_id,name,email,city,risk_level,risk_score,txn_count,total_spent,status";
    const lines = rowsAll.map((r) => [r.customer_id, '"' + r.name + '"', r.email, r.city,
      r.risk_level, r.risk_score, r.txn_count, r.total_spent, r.status].join(","));
    const blob = new Blob([head + "\n" + lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "customers.csv";
    a.click();
  };

  const initials = (name) => name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const events = useMemo(() => {
    const out = [];
    const seen = new Set();
    for (const x of selTxns) {
      const when = hhmm(x.transaction_time) || "";
      if (x.is_fraud) {
        out.push({ c: "#ef4444", g: "!", t: "High Risk Alert",
                   s: "Flagged " + money(x.amount) + " - " + when });
      } else if (!seen.has(x.device_id)) {
        seen.add(x.device_id);
        out.push({ c: "#f59e0b", g: "#", t: "Device Activity",
                   s: String(x.device_id || "").slice(0, 10) + " - " + when });
      } else {
        out.push({ c: "#22c55e", g: ">", t: "Transaction - " + money(x.amount),
                   s: (x.merchant_name || "") + " - " + when });
      }
    }
    return out.slice(0, 6);
  }, [selTxns]);

  return (
    <div>
      <div className="txn-kpis">
        <Kpi tone="blue" icon="people" label="Total Customers" value={compact(rowsAll.length)} note="registered" />
        <Kpi tone="green" icon="people" label="Active Customers" value={compact(active)} note="active last 48h" />
        <Kpi tone="red" icon="shield" label="High-Risk Customers" value={compact(highRisk)} note="HIGH + CRITICAL" />
        <Kpi tone="purple" icon="rate" label="Fraud Rate" value={pct(ov.data?.fraud_rate ?? 0)} note="platform-wide" />
      </div>

      <div className="cust-grid">
        <div className="stack">
          <div className="grid-3">
            <Panel title="Customer Risk Distribution">
              {rowsAll.length ? (
                <div className="fbt-wrap">
                  <div className="fbt-donut">
                    <ResponsiveContainer width="100%" height={170}>
                      <PieChart>
                        <Pie data={dist} dataKey="count" nameKey="name"
                             innerRadius={48} outerRadius={78} paddingAngle={3} stroke="none">
                          {dist.map((x) => <Cell key={x.name} fill={x.fill} />)}
                        </Pie>
                        <Tooltip contentStyle={{ background: "#0f172a",
                          border: "1px solid #1e293b", borderRadius: 8 }}
                          formatter={(v, n) => [v + " customers", n]} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="fbt-center">
                      <div className="fbt-total">{rowsAll.length.toLocaleString()}</div>
                      <div className="fbt-sub">Total Customers</div>
                    </div>
                  </div>
                  <div className="fbt-legend">
                    {dist.map((x) => (
                      <div key={x.name} className="fbt-row">
                        <span className="lg-dot" style={{ background: x.fill }} />
                        <span className="fbt-name">{x.name.replace(" Risk", "")} Risk</span>
                        <b className="fbt-pct">{x.pct}</b>
                      </div>
                    ))}
                  </div>
                </div>
              ) : <Empty>Loading...</Empty>}
            </Panel>

            <Panel title="Customer Activity Trend" extra={
              <div className="legend-dots">
                <span className="lg-item"><span className="lg-dot" style={{ background: "#3b82f6" }} />Volume</span>
                <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Flagged</span>
              </div>}>
              <ActivityTrend />
            </Panel>

            <Panel title="Top Spending Categories">
              {(sum.data?.top_categories || []).length ? (
                <div className="hbars">
                  {sum.data.top_categories.map((x, i) => (
                    <div key={x.name} className="hbar-row">
                      <span className="hbar-name">{x.name}</span>
                      <div className="hbar-track">
                        <div className="hbar-fill" style={{
                          width: Math.max(3, x.share) + "%",
                          background: ["#3b82f6", "#a855f7", "#10b981", "#f59e0b", "#f43f5e"][i % 5] }} />
                      </div>
                      <b className="hbar-pct">{x.share}%</b>
                    </div>
                  ))}
                </div>
              ) : <Empty>No spend data yet.</Empty>}
            </Panel>
          </div>

          <Panel title="Customers" extra={
            <button className="btn-primary" style={{ padding: "7px 16px" }}
                    onClick={exportCsv}>Export</button>}>
            <div className="cust-toolbar">
              <div className="cust-tabs">
                {[["all", "All Customers"], ["high", "High Risk"], ["recent", "Recent Activity"]]
                  .map(([k, v]) => (
                    <button key={k} className={"vol-tab" + (tab === k ? " active" : "")}
                            onClick={() => { setTab(k); setPage(0); }}>{v}</button>
                  ))}
              </div>
              <input className="cust-search" placeholder="Search customer ID, name, email, phone..."
                     value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
              <select className="mini-select" value={stagedRisk}
                      onChange={(e) => setStagedRisk(e.target.value)}>
                <option value="">Risk Level: All</option>
                {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((l) =>
                  <option key={l} value={l}>Risk Level: {l}</option>)}
              </select>
              <select className="mini-select" value={stagedStatus}
                      onChange={(e) => setStagedStatus(e.target.value)}>
                <option value="">Status: All</option>
                <option value="Active">Status: Active</option>
                <option value="Inactive">Status: Inactive</option>
              </select>
              <button className="filter-btn" onClick={applyFilters}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2">
                  <path d="M22 3H2l8 9.5V19l4 2v-8.5L22 3z" />
                </svg>
                Filter
              </button>
            </div>

            {view.length === 0 ? <Empty>No customers match.</Empty> : (
              <table className="tbl wide">
                <thead>
                  <tr>
                    <th className="chk">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    </th>
                    <th>Customer ID</th><th>Name</th><th>Email</th><th>Phone</th>
                    <th>Risk Level</th><th>Total Transactions</th><th>Total Spent</th>
                    <th>Last Activity</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((r) => (
                    <tr key={r.customer_id}
                        className={selId === r.customer_id ? "sel" : ""}
                        onClick={() => setSelId(r.customer_id)}>
                      <td className="chk">
                        <input type="checkbox" checked={checked.has(r.customer_id)}
                               onClick={(e) => e.stopPropagation()}
                               onChange={() => toggleOne(r.customer_id)} />
                      </td>
                      <td className="mono">{cust(r.customer_id)}</td>
                      <td>{r.name}</td>
                      <td className="muted">{r.email}</td>
                      <td className="mono">{phone(r.customer_id)}</td>
                      <td><RiskBadge level={r.risk_level} /></td>
                      <td>{r.txn_count}</td>
                      <td>{money(r.total_spent)}</td>
                      <td className="mono">{r.last_activity ? dt(r.last_activity) : "-"}</td>
                      <td>
                        <span className={"st " + (r.status === "Active" ? "st-approved" : "st-declined")}>
                          {r.status}
                        </span>
                      </td>
                      <td className="kebab-cell" onClick={(e) => e.stopPropagation()}>
                        <button className="kebab" title="actions"
                                onClick={() => setMenuFor(menuFor === r.customer_id ? null : r.customer_id)}>
                          &#8942;
                        </button>
                        {menuFor === r.customer_id && (
                          <div className="kebab-menu">
                            <button onClick={() => { setSelId(r.customer_id); setMenuFor(null); }}>
                              View profile
                            </button>
                            <button onClick={() => {
                              navigator.clipboard?.writeText(r.email)
                                .then(() => {
                                  setCopiedId(r.customer_id + ":mail");
                                  setTimeout(() => setCopiedId(null), 1500);
                                })
                                .catch(() => {});
                              setMenuFor(null);
                            }}>
                              {copiedId === r.customer_id + ":mail" ? "Copied!" : "Copy email"}
                            </button>
                            <button onClick={() => {
                              navigator.clipboard?.writeText(r.customer_id);
                              setMenuFor(null);
                            }}>
                              Copy customer ID
                            </button>
                            <a className="kebab-link"
                               href={"mailto:" + r.email + "?subject=" +
                                     encodeURIComponent("Fraud review - " + cust(r.customer_id))}
                               onClick={() => setMenuFor(null)}>
                              Open in mail app...
                            </a>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="pagi">
              <span className="muted">
                Showing {rows.length ? cur * pageSize + 1 : 0}-{Math.min(rows.length, (cur + 1) * pageSize)} of {rows.length.toLocaleString()} customers
              </span>
              <div className="pagi-btns">
                <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>&lt;</button>
                <span className="pagi-cur">{cur + 1}</span>
                <span className="muted">/ {pages}</span>
                <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>&gt;</button>
                <select value={pageSize} onChange={(e) => { setPageSize(+e.target.value); setPage(0); }}>
                  {[10, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
          </Panel>
        </div>

        <div className="txn-side">
          <Panel title="Customer Profile"
                 extra={selRow && (selRow.risk_level === "HIGH" || selRow.risk_level === "CRITICAL")
                       ? <span className="st st-flagged">High Risk</span> : null}>
            {!selRow ? <Empty>Select a customer.</Empty> : (
              <div className="cust-head">
                <div className="cust-avatar">{initials(selRow.name)}</div>
                <div className="cust-head-info">
                  <div className="cust-name-row">
                    <span className="cust-name">{selRow.name}</span>
                    <span className={"st " + (selRow.status === "Active" ? "st-approved" : "st-declined")}>
                      {selRow.status}
                    </span>
                  </div>
                  <div className="mono cust-id-row">{cust(selRow.customer_id)}</div>
                  <div className="cust-contact"><IconMail /> {selRow.email || "-"}</div>
                  <div className="cust-contact"><IconPhone /> {phone(selRow.customer_id)}</div>
                  <div className="cust-contact"><IconPin /> {selRow.city}, {selRow.country}</div>
                </div>
              </div>
            )}
          </Panel>

          <Panel title="Risk Score">
            {p && Number(p.current_risk_score || 0) > 0
              ? <CustomerBreakdown6 p={p} level={selRow?.risk_level || "Unknown"} />
              : <Empty>No scored activity yet.</Empty>}
          </Panel>

          <Panel title="Customer Summary">
            {p ? (
              <div className="sum-rows">
                <div className="sum-row">
                  <span className="sum-ico" style={{ background: "#3b82f626", color: "#60a5fa" }}>=</span>
                  <span>Total Transactions</span><b>{p.txn_count_30d ?? 0}</b>
                </div>
                <div className="sum-row">
                  <span className="sum-ico" style={{ background: "#22c55e26", color: "#4ade80" }}>O</span>
                  <span>Total Spent</span>
                  <b>{money((p.avg_amount || 0) * (p.txn_count_30d || 0))}</b>
                </div>
                <div className="sum-row">
                  <span className="sum-ico" style={{ background: "#a855f726", color: "#c084fc" }}>#</span>
                  <span>Avg. Transaction</span><b>{money(p.avg_amount)}</b>
                </div>
                <div className="sum-row">
                  <span className="sum-ico" style={{ background: "#f59e0b26", color: "#fbbf24" }}>%</span>
                  <span>Preferred Payment</span><b>{preferred}</b>
                </div>
              </div>
            ) : <Empty>Select a customer.</Empty>}
          </Panel>

          <Panel title="Recent Activity" extra={
            <button className="view-all view-all-btn"
                    onClick={() => onNavigate && onNavigate("transactions")}>View All →</button>}>
            {events.length ? (
              <div className="insights">
                {events.map((e, i) => (
                  <div key={i} className="insight">
                    <span className="insight-icon"
                          style={{ background: e.c + "26", color: e.c,
                                   border: "1px solid " + e.c + "55" }}>{e.g}</span>
                    <div>
                      <div className="insight-title">{e.t}</div>
                      <div className="insight-sub">{e.s}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <Empty>No recent activity.</Empty>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
