function NavIcon({ id }) {
  const s = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none",
              stroke: "currentColor", strokeWidth: 2,
              strokeLinecap: "round", strokeLinejoin: "round" };
  switch (id) {
    case "overview":
      return (<svg {...s}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 10v11h14V10" /></svg>);
    case "transactions":
      return (<svg {...s}><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></svg>);
    case "fraud":
      return (<svg {...s}><path d="M12 2l8 3.5V12c0 5-3.4 8.7-8 10-4.6-1.3-8-5-8-10V5.5L12 2z" /></svg>);
    case "alerts":
      return (<svg {...s}><path d="M12 3c-3.3 0-5.5 2.5-5.5 6v3.8L5 16h14l-1.5-3.2V9c0-3.5-2.2-6-5.5-6z" /><circle cx="12" cy="19" r="2" /></svg>);
    case "customers":
      return (<svg {...s}><circle cx="9" cy="8" r="3.2" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5v1H3v-1z" /><circle cx="16.5" cy="9" r="2.6" /><path d="M16.5 13c2.8 0 5 1.8 5 4.4V19h-4.2" /></svg>);
    case "analytics":
      return (<svg {...s}><path d="M3 21h18" /><rect x="5" y="12" width="3" height="7" /><rect x="10.5" y="8" width="3" height="11" /><rect x="16" y="4" width="3" height="15" /></svg>);
    case "reports":
      return (<svg {...s}><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></svg>);
    case "model":
      return (<svg {...s}><path d="M3 3v18h18" /><path d="M7 14l4-4 3 3 5-6" /></svg>);
    default:
      return null;
  }
}

const NAV = [
  ["overview", "Overview"],
  ["transactions", "Transactions"],
  ["fraud", "Fraud Detection"],
  ["alerts", "Alerts"],
  ["customers", "Customers"],
  ["analytics", "Analytics"],
  ["reports", "Reports"],
  ["model", "Model Monitoring"],
];

export default function Sidebar({ page, setPage, alertCount }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        🛡️ FraudShield
        <span className="brand-sub">Financial Transaction Intelligence</span>
      </div>
      <nav>
        {NAV.map(([id, label]) => (
          <button key={id}
                  className={"nav-item" + (page === id ? " active" : "")}
                  onClick={() => setPage(id)}>
            <span className="nav-icon"><NavIcon id={id} /></span>
            {label}
            {id === "alerts" && alertCount > 0 && <span className="badge">{alertCount}</span>}
          </button>
        ))}
      </nav>
      <div className="sys-status">
        <span className="dot-ok" /> System Status · All Systems Operational
      </div>
    </aside>
  );
}
