export const RISK_COLOR = { LOW: "#22c55e", MEDIUM: "#eab308", HIGH: "#f97316", CRITICAL: "#ef4444" };

export const levelOf = (s) => (s == null ? undefined :
  s >= 80 ? "CRITICAL" : s >= 55 ? "HIGH" : s >= 30 ? "MEDIUM" : "LOW");

export const RiskBadge = ({ level, score }) => {
  const lvl = level || levelOf(score);
  if (!lvl) return null;
  return (
    <span className="badge-lvl" style={{ background: RISK_COLOR[lvl] || "#64748b" }}>
      {lvl}
    </span>
  );
};

export const StatusBadge = ({ s }) => (
  <span className={`st st-${String(s).toLowerCase()}`}>{String(s).toUpperCase()}</span>
);

export const Panel = ({ title, children, extra }) => (
  <div className="panel">
    <div className="panel-head"><h3>{title}</h3>{extra}</div>
    <div className="panel-body">{children}</div>
  </div>
);

export const Empty = ({ children }) => <div className="empty">⏳ {children}</div>;