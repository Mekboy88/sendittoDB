import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, RefreshCw, Search } from "lucide-react";
import { api, fmtTime, redact } from "./api.js";
import { Banner, Panel, Pill } from "./ui.jsx";
import { useEntity } from "./pages.jsx";

const LABEL = {
  queued: "Queued",
  sending: "Sending",
  delivered: "Delivered",
  opened: "Opened",
  clicked: "Clicked",
  bounced: "Bounced",
  failed: "Failed",
  retry_scheduled: "Retry scheduled",
};

const tone = (t) =>
  /delivered|opened|clicked/.test(t) ? "ok" : /queued|sending|retry/.test(t) ? "wait" : "bad";

/**
 * Email activity — every message the platform has handled, and the real
 * sequence of steps each one went through. The steps are what the sending
 * engine recorded, not a guess from the current status.
 */
export function ActivityPage({ token }) {
  const { rows: messages, err, loading, load } = useEntity(token, "/api/messages");
  const [selected, setSelected] = useState(null);
  const [events, setEvents] = useState([]);
  const [detailErr, setDetailErr] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("all");

  const openMessage = useCallback(
    async (row) => {
      setSelected(row);
      setEvents([]);
      setDetailErr("");
      try {
        const data = await api(`/api/messages/${row.id}/events`, { token });
        setEvents(data.events || []);
      } catch (e) {
        setDetailErr(redact(e.message));
      }
    },
    [token]
  );

  // Keep an open message's history current while the page is live.
  useEffect(() => {
    if (!selected) return;
    const fresh = messages.find((m) => m.id === selected.id);
    if (fresh) openMessage(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return messages.filter((m) => {
      const status = String(m.status || "").toLowerCase();
      if (filter === "delivered" && !/delivered|opened|clicked/.test(status)) return false;
      if (filter === "failed" && !/bounce|fail/.test(status)) return false;
      if (filter === "queued" && !/queued|sending/.test(status)) return false;
      if (!needle) return true;
      return `${m.subject || ""} ${m.to_email || ""} ${m.from_email || ""} ${m.stream || ""} ${m.id}`
        .toLowerCase()
        .includes(needle);
    });
  }, [messages, q, filter]);

  const counts = useMemo(
    () => ({
      total: messages.length,
      delivered: messages.filter((m) => /delivered|opened|clicked/i.test(m.status || "")).length,
      opened: messages.reduce((n, m) => n + (m.opens || 0), 0),
      clicked: messages.reduce((n, m) => n + (m.clicks || 0), 0),
      failed: messages.filter((m) => /bounce|fail/i.test(m.status || "")).length,
    }),
    [messages]
  );

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2><Activity size={18} /> Email activity</h2>
          <p>
            Every message the platform handled, with the exact steps it went through — queued,
            each send attempt, what the receiving server answered, and any opens or clicks.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" type="button" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {err ? <Banner tone="bad">{err}</Banner> : null}

      <div className="stat-row">
        {[
          ["Messages", counts.total],
          ["Delivered", counts.delivered],
          ["Opens", counts.opened],
          ["Clicks", counts.clicked],
          ["Bounced / failed", counts.failed],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>

      <Panel title="Messages" copy={`${filtered.length} of ${messages.length} · updates live`}>
        <div className="act-toolbar">
          <label className="act-search">
            <Search size={15} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search subject, recipient, stream, id…"
            />
          </label>
          <div className="act-filters">
            {["all", "delivered", "queued", "failed"].map((f) => (
              <button
                key={f}
                type="button"
                className={`btn${filter === f ? " primary" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f[0].toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <p className="muted">
            {messages.length ? "No messages match that filter." : "No messages have been sent yet."}
          </p>
        ) : (
          <div className="act-list">
            {filtered.slice(0, 200).map((m) => (
              <button
                key={m.id}
                type="button"
                className={`act-item${selected?.id === m.id ? " is-open" : ""}`}
                onClick={() => openMessage(m)}
              >
                <span className="act-item-main">
                  <b>{m.subject || "—"}</b>
                  <small>{m.to_email || "—"}</small>
                </span>
                <span className="act-item-stream">{m.stream || "—"}</span>
                <Pill ok={/delivered|opened|clicked/i.test(m.status || "") ? true : /bounce|fail/i.test(m.status || "") ? false : null} label={m.status || "—"} />
                <time>{fmtTime(m.created_at)}</time>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {selected ? (
        <Panel
          title={`History · ${selected.subject || selected.id}`}
          copy={`${selected.to_email || "—"} · ${selected.stream || "—"} · ${selected.attempts || 1} attempt(s)`}
          actions={
            <button className="btn" type="button" onClick={() => setSelected(null)}>
              Close
            </button>
          }
        >
          {detailErr ? <Banner tone="bad">{detailErr}</Banner> : null}
          {events.length === 0 && !detailErr ? (
            <p className="muted">No delivery events recorded for this message yet.</p>
          ) : (
            <ol className="act-timeline">
              {events.map((e) => (
                <li key={e.id} className={tone(e.type)}>
                  <i />
                  <b>{LABEL[e.type] || e.type}</b>
                  <time>{fmtTime(e.created_at)}</time>
                  {e.attempt > 1 ? <span className="act-try">attempt {e.attempt}</span> : null}
                  {e.provider_response || e.detail ? (
                    <code>{String(e.provider_response || e.detail).slice(0, 200)}</code>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </Panel>
      ) : null}
    </section>
  );
}
