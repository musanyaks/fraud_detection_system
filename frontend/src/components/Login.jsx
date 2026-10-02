import { useState } from "react";
import { login } from "../lib/api.js";

export default function Login() {
  const [u, setU] = useState("admin");
  const [p, setP] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    try { await login(u, p); location.reload(); }
    catch (e2) { setErr(e2.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand-lg">🛡️ FraudShield</div>
        <div className="login-sub">Financial Transaction Intelligence</div>
        <label>Username</label>
        <input value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label>Password</label>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <div className="login-err">{err}</div>}
        <button disabled={busy} className="btn-primary">{busy ? "Signing in…" : "Sign in"}</button>
        <div className="login-hint">FastAPI · Cassandra · Live ensemble</div>
      </form>
    </div>
  );
}