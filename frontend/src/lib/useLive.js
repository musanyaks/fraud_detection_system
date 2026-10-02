import { useEffect, useState } from "react";
import { apiGet } from "./api";

export function useLive(path, params = {}, intervalMs = 5000) {
  const [state, setState] = useState({ path: null, data: null, error: null });
  const key = JSON.stringify(params);

  useEffect(() => {
    if (!path) return;              // null path = no polling, data stays null
    let alive = true;
    const tick = () =>
      apiGet(path, JSON.parse(key))
        .then((d) => { if (alive) setState({ path, data: d, error: null }); })
        .catch((e) => {
          if (!alive) return;
          setState((s) => s.path === path
            ? { ...s, error: e.message }          // keep last good data
            : { path, data: null, error: e.message });
        });
    tick();
    const id = setInterval(tick, intervalMs);
    return () => { alive = false; clearInterval(id); };
  }, [path, key, intervalMs]);

  // only expose data/error that belongs to the CURRENT path
  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : null,
  };
}
