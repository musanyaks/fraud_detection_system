function Glyph({ type }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "#fff" };
  switch (type) {
    case "txn": return (<svg {...p}><path d="M4 7h12l-3-3 1.5-1.5L20 8l-5.5 5.5L13 12l3-3H4V7zm16 10H8l3 3-1.5 1.5L4 16l5.5-5.5L11 12l-3 3h12v2z"/></svg>);
    case "coins": return (<svg {...p}><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 8.5v3c0 1.7 3.1 3 7 3s7-1.3 7-3v-3c-1.5 1.2-4.1 1.8-7 1.8S6.5 9.7 5 8.5z"/><path d="M5 13.5v3c0 1.7 3.1 3 7 3s7-1.3 7-3v-3c-1.5 1.2-4.1 1.8-7 1.8S6.5 14.7 5 13.5z"/></svg>);
    case "shield": return (<svg {...p}><path d="M12 2l8 3.5V12c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V5.5L12 2z"/></svg>);
    case "rate": return (<svg {...p}><path d="M7.5 5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm9 9a2.5 2.5 0 110 5 2.5 2.5 0 010-5zM18.3 4.3l1.4 1.4-14 14-1.4-1.4 14-14z"/></svg>);
    case "people": return (<svg {...p}><circle cx="9" cy="8" r="3.2"/><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5v1H3v-1z"/><circle cx="16.5" cy="9" r="2.6"/><path d="M16.5 13c2.8 0 5 1.8 5 4.4V19h-4.2c0-2.3-1-4.3-2.6-5.6.6-.3 1.2-.4 1.8-.4z"/></svg>);
    case "bell": return (<svg {...p}><path d="M12 3c-3.3 0-5.5 2.5-5.5 6v3.8L5 16h14l-1.5-3.2V9c0-3.5-2.2-6-5.5-6z"/><circle cx="12" cy="19" r="2"/></svg>);
    default: return null;
  }
}

export default function Kpi({ tone = "blue", icon, label, value, delta, note }) {
  const up = delta != null && delta >= 0;
  return (
    <div className={`kpi2 ${tone}`}>
      <div className="kpi2-icon"><Glyph type={icon} /></div>
      <div className="kpi2-body">
        <div className="kpi2-label">{label}</div>
        <div className="kpi2-value">{value}</div>
        {delta != null ? (
          <div className="kpi2-delta">
            <span className={up ? "delta-up" : "delta-down"}>
              {up ? "\u2191" : "\u2193"} {Math.abs(delta).toFixed(1)}%
            </span>
            <div className="kpi2-vs">vs yesterday</div>
          </div>
        ) : (
          <div className="kpi2-vs">{note || ""}</div>
        )}
      </div>
    </div>
  );
}
