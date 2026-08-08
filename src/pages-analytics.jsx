import { useCallback, useEffect, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { api, onDataChange, redact } from "./api.js";
import { Banner, Panel } from "./ui.jsx";

const RANGES = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "12 months", days: 365 },
];

/**
 * Analytics — the same figures the product shows its customers, computed once
 * by the database so the two can never disagree. Staff see the platform as a
 * whole; the numbers are scoped server-side.
 */
export function AnalyticsPage({ token }) {
  const [days, setDays] = useState(30);
  const [stream, setStream] = useState("all");
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api(`/api/analytics?days=${days}&stream=${stream}`, { token }));
      setErr("");
    } catch (e) {
      setErr(redact(e.message));
    } finally {
      setLoading(false);
    }
  }, [token, days, stream]);

  useEffect(() => {
    load();
  }, [load]);

  // Recompute whenever a message or its events move.
  useEffect(() => {
    let timer = null;
    return onDataChange((collection) => {
      if (collection && !/messages|message-events|campaigns|suppressions/.test(collection)) return;
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    });
  }, [load]);

  const t = data?.totals;
  const r = data?.rates;
  const peak = Math.max(1, ...(data?.series || []).map((p) => p.sent));

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2><BarChart3 size={18} /> Analytics</h2>
          <p>
            Delivery and engagement across the platform. Opens and clicks come from recorded
            tracking events, so they reflect what recipients actually did.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn" type="button" onClick={load} disabled={loading}>
            <RefreshCw size={15} /> {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </header>

      {err ? <Banner tone="bad">{err}</Banner> : null}

      <div className="act-toolbar">
        <div className="act-filters">
          {RANGES.map((x) => (
            <button
              key={x.days}
              type="button"
              className={`btn${days === x.days ? " primary" : ""}`}
              onClick={() => setDays(x.days)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="act-filters">
          {["all", "transactional", "marketing", "otp", "notification"].map((s) => (
            <button
              key={s}
              type="button"
              className={`btn${stream === s ? " primary" : ""}`}
              onClick={() => setStream(s)}
            >
              {s === "all" ? "All streams" : s}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-row">
        {[
          ["Sent", t?.sent ?? 0],
          ["Delivered", `${t?.delivered ?? 0} · ${r?.delivery ?? 0}%`],
          ["Unique opens", `${t?.uniqueOpens ?? 0} · ${r?.open ?? 0}%`],
          ["Unique clicks", `${t?.uniqueClicks ?? 0} · ${r?.click ?? 0}%`],
          ["Bounced", `${t?.bounced ?? 0} · ${r?.bounce ?? 0}%`],
          ["Queued", t?.queued ?? 0],
        ].map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
            <b>{value}</b>
          </div>
        ))}
      </div>

      <Panel title="Per day" copy={`Sent, delivered and opened over the last ${days} days`}>
        {!data?.series?.length ? (
          <p className="muted">No activity in this period.</p>
        ) : (
          <div className="an-bars">
            {data.series.map((p) => (
              <div className="an-bar" key={p.date} title={`${p.date}: ${p.sent} sent, ${p.delivered} delivered, ${p.opened} opened`}>
                <i style={{ height: `${(p.sent / peak) * 100}%` }} />
                <em style={{ height: `${(p.delivered / peak) * 100}%` }} />
              </div>
            ))}
          </div>
        )}
        <p className="muted an-legend"><i className="an-key sent" /> sent <i className="an-key delivered" /> delivered</p>
      </Panel>

      <Panel title="By stream" copy="Which kind of mail this workspace sends, and how it lands">
        {!data?.byStream?.length ? (
          <p className="muted">Nothing sent yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr><th>Stream</th><th>Sent</th><th>Delivered</th><th>Delivery</th><th>Opens</th><th>Open rate</th></tr>
            </thead>
            <tbody>
              {data.byStream.map((s) => (
                <tr key={s.stream}>
                  <td>{s.stream}</td><td>{s.sent}</td><td>{s.delivered}</td>
                  <td>{s.deliveryRate}%</td><td>{s.opens}</td><td>{s.openRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Recipient domains" copy="Where mail is going, and whether it arrives">
        {!data?.topDomains?.length ? (
          <p className="muted">No recipients yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Domain</th><th>Sent</th><th>Delivered</th><th>Bounced</th><th>Delivery</th></tr></thead>
            <tbody>
              {data.topDomains.map((d) => (
                <tr key={d.domain}>
                  <td>{d.domain}</td><td>{d.sent}</td><td>{d.delivered}</td><td>{d.bounced}</td><td>{d.deliveryRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Why mail failed" copy="The reasons behind bounces and failures, most common first">
        {!data?.failures?.length ? (
          <p className="muted">Nothing has failed in this period.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Reason</th><th>Count</th></tr></thead>
            <tbody>
              {data.failures.map((f) => (
                <tr key={f.reason}><td><code>{f.reason}</code></td><td>{f.count}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel title="Campaigns" copy="Real performance per campaign">
        {!data?.campaigns?.length ? (
          <p className="muted">No campaigns yet.</p>
        ) : (
          <table className="tbl">
            <thead><tr><th>Campaign</th><th>Status</th><th>Sent</th><th>Delivered</th><th>Opens</th><th>Clicks</th><th>Open rate</th></tr></thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td>{c.status}</td><td>{c.sent}</td>
                  <td>{c.delivered}</td><td>{c.opens}</td><td>{c.clicks}</td><td>{c.openRate}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </section>
  );
}
