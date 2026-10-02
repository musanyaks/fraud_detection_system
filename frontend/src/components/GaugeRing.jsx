export default function GaugeRing({ value, label, color, size = 108 }) {
  const v = Math.max(0, Math.min(1, Number(value) || 0));
  const r = 45, c = 2 * Math.PI * r;
  return (
    <div className="gauge-ring">
      <svg width={size} height={size} viewBox="0 0 110 110">
        <circle cx="55" cy="55" r={r} fill="none" stroke="#16213a" strokeWidth="9" />
        <circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="9"
                strokeLinecap="round" strokeDasharray={c}
                strokeDashoffset={c * (1 - v)}
                transform="rotate(-90 55 55)"
                style={{ transition: "stroke-dashoffset .6s ease" }} />
        <text x="55" y="55" textAnchor="middle" dominantBaseline="central"
              className="gauge-ring-num">{(v * 100).toFixed(1)}%</text>
      </svg>
      <div className="gauge-ring-label">{label}</div>
    </div>
  );
}
