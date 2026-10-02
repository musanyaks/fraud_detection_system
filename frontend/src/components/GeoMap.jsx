import { useEffect, useRef, useState } from "react";
import {
  ComposableMap, Geographies, Geography,
  Marker, ZoomableGroup,
} from "react-simple-maps";

const sevLabel = (s) => (s >= 80 ? "CRITICAL" : s >= 55 ? "HIGH" : "MEDIUM");

export default function GeoMap({ points, compact }) {
  const [geo, setGeo] = useState(null);
  const [err, setErr] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [tip, setTip] = useState(null);        // { p, x, y }
  const wrapRef = useRef(null);

  useEffect(() => {
    fetch("/world-110m.json")
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(setGeo)
      .catch(() => setErr(true));
  }, []);

  // wheel zoom (non-passive listener so the page doesn't scroll)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(1,
        +(z * (e.deltaY < 0 ? 1.25 : 1 / 1.25)).toFixed(2))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (err) return <div className="geo-status">World map asset missing — download world-110m.json.</div>;
  if (!geo) return <div className="geo-status">Loading map…</div>;

  const pts = [...points].sort((a, b) => a.count - b.count); // biggest drawn last = on top
  const track = (p) => (e) => {
    const rect = wrapRef.current.getBoundingClientRect();
    setTip({ p, x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width });
  };

  return (
    <div className="geo-wrap" ref={wrapRef}>
      {!compact && (
        <div className="geo-zoom">
          <button title="zoom in"  onClick={() => setZoom((z) => Math.min(8, +(z * 1.4).toFixed(2)))}>+</button>
          <button title="zoom out" onClick={() => setZoom((z) => Math.max(1, +(z / 1.4).toFixed(2)))}>−</button>
          <button title="reset"    onClick={() => setZoom(1)}>⌂</button>
          <span className="geo-zoom-val">{zoom.toFixed(1)}×</span>
        </div>)}

      <ComposableMap width={780} height={380}
                     style={{ width: "100%", height: "auto" }}
                     projectionConfig={{ scale: 150 }}>
        <ZoomableGroup zoom={zoom} maxZoom={8}>
          <Geographies geography={geo}>
            {({ geographies }) => geographies.map((g) => (
              <Geography key={g.rsmKey} geography={g}
                         fill="#223052" stroke="#4a6390" strokeWidth={0.5}
                         style={{ hover: { fill: "#2c3f6b" } }} />
            ))}
          </Geographies>

          {pts.map((p) => {
            const r = 4 + Math.min(9, p.count * 1.1);
            return (
              <Marker key={p.name} coordinates={[p.lon, p.lat]}
                      onMouseMove={track(p)} onMouseLeave={() => setTip(null)}
                      style={{ cursor: "pointer" }}>
                <circle r={r * 2.1} fill={p.color} fillOpacity={0.18} />
                <circle r={r} fill={p.color} fillOpacity={0.85}
                        stroke="#e2e8f0" strokeWidth={0.8 / zoom} />
                <text textAnchor="middle" y={-r - 6}
                      fontSize={Math.max(5, 10 / zoom)}
                      fontWeight={600} fill="#cbd5e1"
                      style={{ paintOrder: "stroke", stroke: "#0b1220", strokeWidth: 3 / zoom }}>
                  {p.name} ({p.count})
                </text>
              </Marker>
            );
          })}
        </ZoomableGroup>
      </ComposableMap>

      {tip && (
        <div className="geo-tip"
             style={{ left: Math.max(70, Math.min(tip.x, (tip.w || 300) - 70)),
                      top: tip.y }}>
          <div className="geo-tip-city">{tip.p.name}</div>
          <div className="geo-tip-row"><span>Flagged txns</span><b>{tip.p.count}</b></div>
          <div className="geo-tip-row"><span>Max risk score</span>
            <b style={{ color: tip.p.color }}>{tip.p.max_score}</b></div>
          <div className="geo-tip-row"><span>Severity</span><b>{sevLabel(tip.p.max_score)}</b></div>
          <div className="geo-tip-hint">scroll = zoom · drag = pan</div>
        </div>
      )}
    </div>
  );
}