import { useEffect, useMemo, useState } from "react";
import { CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
         ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import Kpi from "../components/Kpi.jsx";
import { Panel, Empty } from "../components/bits.jsx";
import GeoMap from "../components/GeoMap.jsx";
import { money, compact, pct, cust, txn, dt, CHANNEL_LABEL } from "../lib/format.js";
import { useLive } from "../lib/useLive.js";
import { apiGet } from "../lib/api.js";

const SEV = { CRITICAL: "#ef4444", HIGH: "#f97316", MEDIUM: "#eab308" };

function paymentDetails(t) {
  const hex = String(t.transaction_id).replace(/-/g, "");
  const last4 = hex.slice(-4);
  const brand = ["Visa", "Mastercard", "Amex", "Discover"][
    parseInt(hex.slice(0, 4), 16) % 4];
  if (t.channel === "bank") return { display: "Transfer ****" + last4 };
  if (t.channel === "mobile") return { display: "Wallet ****" + last4 };
  return { display: brand + " ****" + last4 };
}

function StatusPill({ s, flagged }) {
  if (flagged) return <span className="st st-flagged">Flagged</span>;
  if (s === "approved") return <span className="st st-approved">Approved</span>;
  if (s === "declined") return <span className="st st-review">Under Review</span>;
  return <span className="st st-declined">Failed</span>;
}

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
         stroke="#8ea0c0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconCopy() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8ea0c0"
    strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>);
}

function IconPin() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8ea0c0"
    strokeWidth="2"><path d="M21 10c0 7-9 12-9 12S3 17 3 10a9 9 0 1118 0z"/><circle cx="12" cy="10" r="3"/></svg>);
}

function IconCard() {
  return (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1"
    strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>);
}

function DetailModal({ txn: tx, pred, onClose }) {
  if (!tx) return null;
  const pay = paymentDetails(tx);
  const flagged = pred ? pred.risk_level === "HIGH" || pred.risk_level === "CRITICAL" : false;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <div className="modal-title mono">{txn(tx.transaction_id)}</div>
            <div className="muted">{dt(tx.transaction_time)}</div>
          </div>
          <button className="modal-x" onClick={onClose}>x</button>
        </div>
        <div className="modal-cols">
          <div>
            <h4 className="modal-h">Transaction</h4>
            <div className="td-row"><span>Customer ID</span><b className="mono">{cust(tx.customer_id)}</b></div>
            <div className="td-row"><span>Merchant</span><b>{tx.merchant_name}</b></div>
            <div className="td-row"><span>Amount</span><b>{money(tx.amount)}</b></div>
            <div className="td-row"><span>Type</span><b>{CHANNEL_LABEL[tx.channel] || tx.channel}</b></div>
            <div className="td-row"><span>Status</span><StatusPill s={tx.status} flagged={flagged} /></div>
            <div className="td-row"><span>Location</span><b>{tx.location}, {tx.country}</b></div>
            <div className="td-row"><span>Coordinates</span>
              <b className="mono">{tx.latitude?.toFixed(4)}, {tx.longitude?.toFixed(4)}</b></div>
            <div className="td-row"><span>Device</span><b className="mono">{tx.device_id}</b></div>
            <div className="td-row"><span>IP</span><b className="mono">{tx.ip_address}</b></div>
            <h4 className="modal-h">Payment</h4>
            <div className="td-row"><span>Method</span>
              <b className="td-strong"><IconCard /> {pay.display}</b></div>
            <div className="td-row"><span>Channel</span><b>{tx.channel}</b></div>
            <div className="td-row"><span>Card Present</span>
              <b>{tx.card_present ? "Yes" : "No"}</b></div>
            <div className="td-row"><span>Currency</span><b>{tx.currency || "USD"}</b></div>
          </div>
          <div>
            <h4 className="modal-h">Fraud Assessment</h4>
            {pred ? (
              <div>
                <div className="td-row"><span>Risk Score</span>
                  <b className="risk-num">{pred.risk_score} / 100 ({pred.risk_level})</b></div>
                <div className="td-row"><span>Fraud Probability</span><b>{pred.fraud_probability}</b></div>
                <div className="td-row"><span>Supervised Score</span><b>{pred.supervised_score}</b></div>
                <div className="td-row"><span>Anomaly Score</span><b>{pred.anomaly_score}</b></div>
                <div className="td-row"><span>Model</span><b className="mono">{pred.model_version}</b></div>
                <h4 className="modal-h">Detection Reasons</h4>
                <ul className="reasons">
                  {(pred.reasons || ["None recorded"]).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            ) : <Empty>No prediction recorded for this transaction.</Empty>}
          </div>
        </div>
        <h4 className="modal-h">Raw record (JSON)</h4>
        <pre className="modal-json">{JSON.stringify({ transaction: tx, prediction: pred }, null, 2)}</pre>
      </div>
    </div>
  );
}

function RiskBreakdown6({ d }) {
  const ml = d.supervised_score ?? 0, an = d.anomaly_score ?? 0,
        prob = d.fraud_probability ?? 0;
  const tf = d.top_features || {};
  const raw = [
    { name: "ML Probability",     w: 0.7 * ml, share: "40%", color: "#8b5cf6" },
    { name: "Behavioral Anomaly", w: 0.3 * an, share: "20%", color: "#a78bfa" },
    { name: "Velocity Risk",      w: 0.15 * Math.min(1, (tf.txn_count_5m || 0) / 10), share: "15%", color: "#f43f5e" },
    { name: "Geographic Risk",    w: 0.1 * Math.min(1, (tf.distance_from_prev_km || 0) / 1000), share: "10%", color: "#10b981" },
    { name: "Merchant Risk",      w: 0.1 * (tf.merchant_risk_score || 0.1), share: "10%", color: "#06b6d4" },
    { name: "Device Risk",        w: 0.05 * (tf.new_device || 0), share: "5%", color: "#22d3ee" },
  ];
  const sum = raw.reduce((s, x) => s + x.w, 0) || 0.01;
  const rows = raw.map((x) => ({ ...x, val: ((x.w / sum) * (d.risk_score || 0)).toFixed(1) }));
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
          <div className="rb-num">{d.risk_score}</div>
          <div className="rb-sub">{d.risk_level} Risk</div>
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

export default function Transactions({ onNavigate }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [level, setLevel] = useState("");
  const [dType, setDType] = useState("");
  const [dStatus, setDStatus] = useState("");
  const [dLevel, setDLevel] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [selId, setSelId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [volTab, setVolTab] = useState("volume");
  const [checked, setChecked] = useState(() => new Set());
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  const tx = useLive("/transactions/recent", { limit: 1000 }, 5000);
  const pr = useLive("/predictions/recent", { limit: 1000 }, 6000);
  const an = useLive("/metrics/analytics", {}, 10000);

  const riskMap = useMemo(() => Object.fromEntries(
    (pr.data || []).map((p) => [String(p.transaction_id), p])), [pr.data]);
  const rowsAll = tx.data || [];

  const isFlagged = (t) => {
    const p = riskMap[String(t.transaction_id)];
    return p ? p.risk_level === "HIGH" || p.risk_level === "CRITICAL" : false;
  };

  const rows = useMemo(() => {
    let r = rowsAll;
    if (level) r = r.filter((t) => riskMap[String(t.transaction_id)]?.risk_level === level);
    if (status) r = r.filter((t) => (isFlagged(t) ? "flagged" : t.status) === status);
    if (type) r = r.filter((t) => t.channel === type);
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((t) =>
        `${t.merchant_name} ${t.location} ${cust(t.customer_id)} ${txn(t.transaction_id)}`
          .toLowerCase().includes(s));
    }
    return r;
  }, [rowsAll, riskMap, level, status, type, q]);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const val = (x) => sortKey === "amount" ? x.amount
      : sortKey === "risk" ? (riskMap[String(x.transaction_id)]?.risk_score ?? -1)
      : x.transaction_time;
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b);
      return (sortDir === "asc" ? 1 : -1) * (va < vb ? -1 : va > vb ? 1 : 0);
    });
  }, [rows, sortKey, sortDir, riskMap]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const view = sorted.slice(cur * pageSize, cur * pageSize + pageSize);
  const pageIds = view.map((x) => String(x.transaction_id));
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

  const applyFilters = () => { setType(dType); setStatus(dStatus); setLevel(dLevel); setPage(0); };
  const resetFilters = () => {
    setQ(""); setDType(""); setDStatus(""); setDLevel("");
    setType(""); setStatus(""); setLevel(""); setPage(0);
  };

  const sortBtn = (key, label) => (
    <th className="sortable" onClick={() => {
      if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      else { setSortKey(key); setSortDir("desc"); }
    }}>
      {label} <span className="caret">{sortKey === key ? (sortDir === "asc" ? "^" : "v") : "^"}</span>
    </th>
  );

  const pageBtns = [];
  if (pages <= 7) {
    for (let i = 1; i <= pages; i++) pageBtns.push(i);
  } else {
    pageBtns.push(1);
    if (cur > 3) pageBtns.push("...");
    for (let i = Math.max(2, cur); i <= Math.min(pages - 1, cur + 1); i++) pageBtns.push(i);
    if (cur < pages - 2) pageBtns.push("...");
    pageBtns.push(pages);
  }

  const open = async (t) => {
    setSelId(String(t.transaction_id));
    setDetail({ txn: t, pred: null });
    try {
      const pred = await apiGet(`/predictions/${t.transaction_id}`);
      setDetail({ txn: t, pred });
    } catch { setDetail({ txn: t, pred: null }); }
  };

  useEffect(() => {
    const h = (e) => { if (e.key === "Escape") setShowModal(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const flaggedCount = rowsAll.filter(isFlagged).length;
  const vol = rowsAll.reduce((s, t) => s + (t.amount || 0), 0);
  const hourly = (an.data?.hourly || []).map((h) => ({
    hour: h.hour, volume: h.volume, fraudulent: h.fraud }));

  const pay = detail ? paymentDetails(detail.txn) : null;
  const detailFlagged = detail?.pred
    ? detail.pred.risk_level === "HIGH" || detail.pred.risk_level === "CRITICAL"
    : false;

  return (
    <div>
      <div className="txn-kpis">
        <Kpi tone="blue" icon="txn" label="Total Transactions"
             value={compact(rowsAll.length)} note="latest batch" />
        <Kpi tone="green" icon="coins" label="Total Transaction Value"
             value={"$" + compact(Math.round(vol))} note="of latest batch" />
        <Kpi tone="red" icon="shield" label="Flagged Transactions"
             value={compact(flaggedCount)} note="HIGH + CRITICAL" />
        <Kpi tone="purple" icon="rate" label="Fraud Rate"
             value={rowsAll.length ? pct(flaggedCount / rowsAll.length) : "-"}
             note="of latest batch" />
      </div>

      <div className="filters2">
        <div className="f2-group">
          <span className="f2-label">Date Range</span>
          <select defaultValue="7d">
            <option>Last 7 days</option><option>Today</option><option>30 days</option>
          </select>
        </div>
        <div className="f2-group">
          <span className="f2-label">Transaction Type</span>
          <select value={dType} onChange={(e) => setDType(e.target.value)}>
            <option value="">All Types</option>
            {Object.entries(CHANNEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div className="f2-group">
          <span className="f2-label">Status</span>
          <select value={dStatus} onChange={(e) => setDStatus(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="approved">Approved</option>
            <option value="flagged">Flagged</option>
            <option value="declined">Under Review</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <div className="f2-group">
          <span className="f2-label">Risk Level</span>
          <select value={dLevel} onChange={(e) => setDLevel(e.target.value)}>
            <option value="">All Levels</option>
            {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="f2-group f2-grow">
          <span className="f2-label">Search</span>
          <input placeholder="Search by ID, customer, merchant..."
                 value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} />
        </div>
        <div className="f2-actions">
          <button className="btn-ghost" onClick={resetFilters}>Reset</button>
          <button className="btn-primary" onClick={applyFilters}>Apply</button>
        </div>
      </div>

      <div className="txn-grid">
        <div className="stack">
          <Panel title={`Transactions (${sorted.length.toLocaleString()})`}>
            {tx.error ? <Empty>API error: {tx.error}</Empty>
             : view.length === 0 ? <Empty>No transactions match.</Empty>
             : (
              <table className="tbl wide">
                <thead>
                  <tr>
                    <th className="chk">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                    </th>
                    <th>Transaction ID</th>
                    {sortBtn("time", "Date & Time")}
                    <th>Customer ID</th>
                    <th>Merchant</th>
                    {sortBtn("amount", "Amount")}
                    <th>Type</th>
                    <th>Status</th>
                    {sortBtn("risk", "Risk Score")}
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {view.map((t) => {
                    const p = riskMap[String(t.transaction_id)];
                    const fl = isFlagged(t);
                    const score = p ? p.risk_score.toFixed(1) : "-";
                    return (
                      <tr key={String(t.transaction_id)}
                          className={fl ? "flag-row"
                            : (selId === String(t.transaction_id) ? "sel" : "")}
                          onClick={() => open(t)}>
                        <td className="chk">
                          <input type="checkbox"
                                 checked={checked.has(String(t.transaction_id))}
                                 onClick={(e) => e.stopPropagation()}
                                 onChange={() => toggleOne(String(t.transaction_id))} />
                        </td>
                        <td className="mono">{txn(t.transaction_id)}</td>
                        <td className="mono">{dt(t.transaction_time)}</td>
                        <td className="mono">{cust(t.customer_id)}</td>
                        <td>{t.merchant_name}</td>
                        <td>{money(t.amount)}</td>
                        <td>{CHANNEL_LABEL[t.channel] || t.channel}</td>
                        <td><StatusPill s={t.status} flagged={fl} /></td>
                        <td className={fl ? "risk-num" : ""}>{score}</td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="eye" title="View details"
                                  onClick={() => open(t)}>
                            <EyeIcon />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="pagi">
              <span className="muted">
                Showing {sorted.length ? cur * pageSize + 1 : 0}-
                {Math.min(sorted.length, (cur + 1) * pageSize)} of {sorted.length.toLocaleString()} transactions
              </span>
              <div className="pagi-btns">
                <button disabled={cur === 0} onClick={() => setPage(cur - 1)}>&lt;</button>
                {pageBtns.map((n, i) => n === "..."
                  ? <span key={"e" + i} className="muted">...</span>
                  : <button key={n} className={n - 1 === cur ? "pg-active" : ""}
                            onClick={() => setPage(n - 1)}>{n}</button>)}
                <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>&gt;</button>
                <select value={pageSize}
                        onChange={(e) => { setPageSize(+e.target.value); setPage(0); }}>
                  {[10, 15, 25, 50].map((n) => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>
            </div>
          </Panel>

          <div className="grid-2">
            <Panel
              title={
                <div className="vol-tabs">
                  {[["volume", "Transaction Volume"], ["value", "Transaction Value"],
                    ["rate", "Fraud Rate"]].map(([k, label]) => (
                    <button key={k}
                            className={"vol-tab" + (volTab === k ? " active" : "")}
                            onClick={() => setVolTab(k)}>{label}</button>
                  ))}
                </div>
              }
              extra={
                <div className="legend-dots">
                  {volTab === "volume" ? (
                    <>
                      <span className="lg-item"><span className="lg-dot" style={{ background: "#3b82f6" }} />Transactions</span>
                      <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Fraudulent</span>
                    </>
                  ) : volTab === "value" ? (
                    <span className="lg-item"><span className="lg-dot" style={{ background: "#22c55e" }} />Value (today, hourly)</span>
                  ) : (
                    <span className="lg-item"><span className="lg-dot" style={{ background: "#f43f5e" }} />Flagged Rate (7 days)</span>
                  )}
                </div>
              }>
              {(volTab !== "value" ? (an.data?.daily || []) : (an.data?.hourly || [])).length ? (
                <ResponsiveContainer width="100%" height={190}>
                  {volTab === "value" ? (
                    <LineChart data={an.data.hourly}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="hour" stroke="#64748b" tick={{ fontSize: 10 }} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 10 }}
                             tickFormatter={(v) => "$" + compact(v)} />
                      <Tooltip contentStyle={{ background: "#0f172a",
                                               border: "1px solid #1e293b", borderRadius: 8 }}
                               formatter={(v) => ["$" + Number(v).toLocaleString(), "Value"]} />
                      <Line dataKey="value" name="Value" stroke="#22c55e"
                            strokeWidth={2} dot={{ r: 3, fill: "#22c55e", strokeWidth: 0 }} />
                    </LineChart>
                  ) : (
                    <LineChart data={an.data.daily}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 10 }} interval={0} />
                      <YAxis stroke="#64748b" tick={{ fontSize: 10 }}
                             yAxisId={volTab === "rate" ? "rate" : "vol"}
                             tickFormatter={volTab === "rate"
                               ? (v) => (v * 100).toFixed(1) + "%"
                               : (v) => compact(v)}
                             domain={volTab === "rate"
                               ? [0, (max) => Math.max(0.002, Math.ceil((max || 0.002) * 1.25 * 10000) / 10000)]
                               : undefined} />
                      <Tooltip contentStyle={{ background: "#0f172a",
                                               border: "1px solid #1e293b", borderRadius: 8 }}
                               formatter={(v, n) => volTab === "rate"
                                 ? [(v * 100).toFixed(2) + "%", "Flagged Rate"]
                                 : [Number(v).toLocaleString(), n]} />
                      {volTab === "volume" ? (
                        <>
                          <Line yAxisId="vol" dataKey="volume" name="Transactions"
                                stroke="#3b82f6" strokeWidth={2}
                                dot={{ r: 3, fill: "#3b82f6", strokeWidth: 0 }} />
                          <Line yAxisId="vol" dataKey="flagged" name="Fraudulent"
                                stroke="#f43f5e" strokeWidth={2}
                                dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }} />
                        </>
                      ) : (
                        <Line yAxisId="rate" dataKey="fraud_rate" name="Flagged Rate"
                              stroke="#f43f5e" strokeWidth={2}
                              dot={{ r: 3, fill: "#f43f5e", strokeWidth: 0 }} />
                      )}
                    </LineChart>
                  )}
                </ResponsiveContainer>
              ) : <Empty>No data yet.</Empty>}
            </Panel>

            <Panel title="Transaction Types">
              {(an.data?.channel_mix || []).length ? (
                <div className="hbars">
                  {(() => {
                    const TYPE_COLORS = {
                      pos: "#3b82f6", online: "#10b981", mobile: "#a855f7",
                      bank: "#f59e0b", atm: "#ec4899", other: "#94a3b8",
                    };
                    const order = ["pos", "online", "mobile", "bank", "other", "atm"];
                    const total = an.data.channel_mix.reduce((s, c) => s + c.count, 0) || 1;
                    const known = new Set(order.filter((o) => o !== "other"));
                    const otherCount = an.data.channel_mix
                      .filter((c) => !known.has(c.name))
                      .reduce((s, c) => s + c.count, 0);
                    const rows = order.map((k) => {
                      const hit = an.data.channel_mix.find((c) => c.name === k);
                      return { key: k, name: CHANNEL_LABEL[k] || k,
                               count: hit ? hit.count : (k === "other" ? otherCount : 0),
                               color: TYPE_COLORS[k] };
                    }).filter((r) => r.count > 0 || r.key === "pos");
                    return rows.map((x) => (
                      <div key={x.key} className="hbar-row">
                        <span className="hbar-name">{x.name}</span>
                        <div className="hbar-track">
                          <div className="hbar-fill"
                               style={{ width: Math.max(2, 100 * x.count / total) + "%",
                                        background: x.color }} />
                        </div>
                        <b className="hbar-pct">{(100 * x.count / total).toFixed(1)}%</b>
                      </div>
                    ));
                  })()}
                </div>
              ) : <Empty>No data yet.</Empty>}
            </Panel>
          </div>
        </div>

        <div className="txn-side">
          <Panel title="Transaction Details"
                 extra={detailFlagged ? <span className="st st-flagged">Flagged</span> : null}>
            {!detail ? <Empty>Click a row to inspect.</Empty> : (
              <div className="td-panel">
                <div className="td-txn mono">{txn(detail.txn.transaction_id)}</div>
                <div className="td-date muted">{dt(detail.txn.transaction_time)}</div>
                <div className="td-rows">
                  <div className="td-row">
                    <span>Customer ID</span>
                    <b className="mono td-strong">{cust(detail.txn.customer_id)}
                      <button className="td-copy" title="copy"
                              onClick={() => navigator.clipboard?.writeText(
                                String(detail.txn.customer_id))}><IconCopy /></button>
                    </b>
                  </div>
                  <div className="td-row"><span>Merchant</span><b>{detail.txn.merchant_name}</b></div>
                  <div className="td-row"><span>Amount</span><b>{money(detail.txn.amount)}</b></div>
                  <div className="td-row"><span>Type</span>
                    <b>{CHANNEL_LABEL[detail.txn.channel] || detail.txn.channel}</b></div>
                  <div className="td-row"><span>Status</span>
                    <StatusPill s={detail.txn.status} flagged={detailFlagged} /></div>
                  <div className="td-row"><span>Risk Score</span>
                    <b className="risk-num">
                      {detail.pred ? detail.pred.risk_score + " / 100" : "-"}
                    </b></div>
                  <div className="td-row"><span>Location</span>
                    <b className="td-strong"><IconPin /> {detail.txn.location}</b></div>
                  <div className="td-row"><span>Payment Method</span>
                    <b className="td-strong"><IconCard /> {pay ? pay.display : "-"}</b></div>
                </div>
                {detail.pred?.reasons?.length > 0 && (
                  <div className="td-reasons">
                    {detail.pred.reasons.slice(0, 2).map((r, i) => (
                      <div key={i} className="td-reason">{r}</div>
                    ))}
                  </div>
                )}
                <button className="td-cta" onClick={() => setShowModal(true)}>
                  View Full Details
                </button>
              </div>
            )}
          </Panel>

          <Panel title="Risk Score Breakdown">
            {detail?.pred ? <RiskBreakdown6 d={detail.pred} />
              : <Empty>Select a scored transaction.</Empty>}
          </Panel>

          <Panel title="Transaction Location">
            {detail ? (
              <div className="td-geo">
                <GeoMap points={[{
                  name: detail.txn.location,
                  lon: detail.txn.longitude, lat: detail.txn.latitude,
                  color: SEV[detail.pred?.risk_level] || "#3b82f6",
                  count: 1, max_score: detail.pred?.risk_score || 0,
                }]} />
                <div className="td-geo-row">
                  <span className="lg-dot" style={{
                    background: SEV[detail.pred?.risk_level] || "#3b82f6" }} />
                  <span>{detail.txn.location}</span>
                  <b className="td-geo-score">{detail.pred?.risk_score ?? "-"}</b>
                </div>
              </div>
            ) : <Empty>Select a transaction.</Empty>}
          </Panel>
        </div>
      </div>

      {showModal && detail && (
        <DetailModal txn={detail.txn} pred={detail.pred}
                     onClose={() => setShowModal(false)} />
      )}
    </div>
  );
}
