const TOKEN_KEY = "fs_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const logout = () => { localStorage.removeItem(TOKEN_KEY); location.reload(); };

export async function login(username, password) {
  const r = await fetch("/api/v1/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Login failed");
  const data = await r.json();
  localStorage.setItem(TOKEN_KEY, data.access_token);
  return data;
}

async function handle(r) {
  if (r.status === 401) logout();
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const apiGet = (path, params = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== "" && v != null)).toString();
  return fetch(`/api/v1${path}${qs ? `?${qs}` : ""}`,
    { headers: { Authorization: `Bearer ${getToken()}` } }).then(handle);
};

export const apiPatch = (path, body) =>
  fetch(`/api/v1${path}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json",
               Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  }).then(handle);