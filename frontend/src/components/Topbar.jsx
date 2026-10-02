import { useEffect, useState } from "react";
import { logout } from "../lib/api.js";

export default function Topbar({ title }) {
  const [now, setNow] = useState(new Date());
  const [live, setLive] = useState("ok");
  const [range, setRange] = useState("7d");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const r = await fetch("/api/v1/health");
        if (alive) setLive(r.ok ? "ok" : "down");
      } catch {
        if (alive) setLive("down");
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const fmt = (d) => d.toLocaleDateString("en-US",
    { month: "short", day: "2-digit", year: "numeric" });
  const start = new Date(now.getTime() - 6 * 86400000);
  const label = range === "today"
    ? fmt(now)
    : fmt(start) + " - " + fmt(now);

  const options = [["today", "Today"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]];

  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <div className="topbar-sub">Real-time financial transaction monitoring and fraud detection</div>
      </div>
      <div className="topbar-right">
        <div className="range-chip" onClick={() => setOpen(!open)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="#8ea0c0" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          <span>{label}</span>
          <span className="caret">v</span>
          {open && (
            <div className="range-menu" onClick={(e) => e.stopPropagation()}>
              {options.map(([k, v]) => (
                <button key={k}
                        className={range === k ? "range-opt active" : "range-opt"}
                        onClick={() => { setRange(k); setOpen(false); }}>
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className={"live-pill" + (live === "ok" ? "" : " live-down")}>
          <span className="dot-ok" /> {live === "ok" ? "Live" : "Offline"}
        </span>
        <button className="btn-ghost" onClick={logout}>Sign out</button>
      </div>
    </header>
  );
}
