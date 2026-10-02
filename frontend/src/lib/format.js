export const money = (n) =>
  "$" + Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export const compact = (n) =>
  Intl.NumberFormat(undefined, { notation: "compact" }).format(Number(n ?? 0));

export const pct = (n, d = 2) => (Number(n ?? 0) * 100).toFixed(d) + "%";

export const hhmm = (iso) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

export const short = (s, n = 8) => (s ? String(s).slice(0, n) + "…" : "—");
// deterministic CUST-XXXX label from a UUID (stable forever)
export const cust = (id) => {
  if (!id) return "—";
  const hex = String(id).replace(/-/g, "");
  const n = parseInt(hex.slice(0, 8), 16) % 10000;
  return "CUST-" + String(n).padStart(4, "0");
};

// channel -> display label (mock's "Transaction Types" wording)
export const CHANNEL_LABEL = {
  pos: "Card Payment",
  online: "Online Purchase",
  atm: "ATM Withdrawal",
  bank: "Bank Transfer",
  mobile: "Mobile Payment",
};

// deterministic TXN-####### label from a UUID (stable forever)
export const txn = (id) => {
  if (!id) return "—";
  const hex = String(id).replace(/-/g, "");
  return "TXN-" + String(parseInt(hex.slice(0, 12), 16) % 10000000).padStart(7, "0");
};

// "Sep 28, 2026 14:32:17"
export const dt = (iso) => iso ? new Date(iso).toLocaleString("en-US",
  { month: "short", day: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }) : "—";
