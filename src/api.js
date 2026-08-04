const LS = "senditto_db_studio_session_v1";

export function getApiBase() {
  return (import.meta.env.VITE_DB_API_BASE || "").replace(/\/$/, "");
}

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(LS) || "null");
  } catch {
    return null;
  }
}

export function saveSession(session) {
  if (!session) localStorage.removeItem(LS);
  else localStorage.setItem(LS, JSON.stringify(session));
}

export function redact(text) {
  if (text == null) return "—";
  let s = String(text);
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "•••");
  s = s.replace(/https?:\/\/[^\s"'<>]+/gi, "[endpoint hidden]");
  return s;
}

export async function api(path, { method = "GET", body, token } = {}) {
  const base = getApiBase();
  const headers = {
    "Content-Type": "application/json",
    "X-Senditto-Client": "database-studio",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export function openRealtime(token, onEvent) {
  const base = getApiBase();
  if (!base || !token) return () => {};
  const ctrl = new AbortController();
  (async () => {
    try {
      const res = await fetch(`${base}/api/db/realtime`, {
        headers: { Authorization: `Bearer ${token}`, "X-Senditto-Client": "database-studio" },
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error("Realtime unavailable");
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (!line) continue;
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {
            /* ignore */
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") onEvent({ type: "error", error: e.message });
    }
  })();
  return () => ctrl.abort();
}

export function fmt(v) {
  if (v == null) return "—";
  if (typeof v === "object") return redact(JSON.stringify(v));
  return redact(String(v));
}

export function fmtTime(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return String(v);
  }
}

/** Full local date for logs (e.g. 20 Jul 2026). */
export function fmtDate(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      weekday: "short",
    });
  } catch {
    return String(v);
  }
}

/** Clock time with seconds for logs (e.g. 14:35:49). */
export function fmtClock(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return String(v);
  }
}

/** Absolute ISO for tooltips / audit export (always registered). */
export function fmtIso(v) {
  if (!v) return "—";
  try {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toISOString();
  } catch {
    return String(v);
  }
}

export function fmtNum(n) {
  if (n == null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString();
}
