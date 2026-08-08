/**
 * Senditto analytics.
 *
 * One place that turns messages and their recorded events into the numbers
 * both interfaces show, so the studio and the product can never disagree.
 *
 * Two things it is careful about:
 *   • Opens and clicks come from recorded events, not from a message's status.
 *     A delivered message that was opened still has status "delivered" — a
 *     status string cannot tell you about engagement.
 *   • "Delivered" means a receiving server accepted it. Queued mail is not
 *     delivered, and counting it as such flatters every rate on the page.
 */

const DAY = 86400000;

const dayKey = (iso) => new Date(iso).toISOString().slice(0, 10);

/** Domain of a recipient. Addresses are stored masked, the domain is not. */
function domainOf(row) {
  const at = String(row.to_hint || "").split("@")[1];
  return at ? at.toLowerCase() : "unknown";
}

const pct = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

/**
 * @param db          the database
 * @param workspaceIds null for everything (staff), or the ids the caller owns
 * @param rangeDays    how far back to look
 * @param stream       "all" or one stream name
 */
export function computeAnalytics(db, { workspaceIds = null, rangeDays = 30, stream = "all" } = {}) {
  const days = Math.max(1, Math.min(365, Number(rangeDays) || 30));
  const from = Date.now() - days * DAY;
  const inScope = (row) =>
    !workspaceIds || !row.workspace_id || workspaceIds.has(row.workspace_id);

  const messages = (db.messages || []).filter(
    (m) =>
      inScope(m) &&
      new Date(m.created_at).getTime() >= from &&
      (stream === "all" || m.stream === stream)
  );
  const ids = new Set(messages.map((m) => m.id));
  const events = (db.message_events || []).filter((e) => ids.has(e.message_id));

  const is = (m, re) => re.test(String(m.status || ""));
  const delivered = messages.filter((m) => is(m, /^delivered$/i));
  const bounced = messages.filter((m) => is(m, /^bounced$/i));
  const failed = messages.filter((m) => is(m, /^failed$/i));
  const queued = messages.filter((m) => is(m, /^(queued|sending)$/i));

  // Engagement is only knowable from events.
  const openEvents = events.filter((e) => e.type === "opened");
  const clickEvents = events.filter((e) => e.type === "clicked");
  const uniqueOpens = new Set(openEvents.map((e) => e.message_id)).size;
  const uniqueClicks = new Set(clickEvents.map((e) => e.message_id)).size;

  /* ------------------------------ per day ------------------------------ */

  const series = [];
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const key = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    const bucket = { date: key, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, failed: 0 };
    byDay.set(key, bucket);
    series.push(bucket);
  }
  for (const m of messages) {
    const bucket = byDay.get(dayKey(m.created_at));
    if (!bucket) continue;
    bucket.sent++;
    if (is(m, /^delivered$/i)) bucket.delivered++;
    if (is(m, /^bounced$/i)) bucket.bounced++;
    if (is(m, /^failed$/i)) bucket.failed++;
  }
  for (const e of events) {
    const bucket = byDay.get(dayKey(e.created_at));
    if (!bucket) continue;
    if (e.type === "opened") bucket.opened++;
    if (e.type === "clicked") bucket.clicked++;
  }

  /* --------------------------- breakdowns --------------------------- */

  const group = (rows, keyOf) => {
    const map = new Map();
    for (const row of rows) {
      const key = keyOf(row);
      const entry = map.get(key) || { key, sent: 0, delivered: 0, bounced: 0 };
      entry.sent++;
      if (is(row, /^delivered$/i)) entry.delivered++;
      if (is(row, /^bounced$/i)) entry.bounced++;
      map.set(key, entry);
    }
    return [...map.values()];
  };

  const openedIds = new Set(openEvents.map((e) => e.message_id));
  const clickedIds = new Set(clickEvents.map((e) => e.message_id));
  const engagementFor = (rows) => ({
    opens: rows.filter((m) => openedIds.has(m.id)).length,
    clicks: rows.filter((m) => clickedIds.has(m.id)).length,
  });

  const byStream = group(messages, (m) => m.stream || "transactional")
    .map((g) => {
      const rows = messages.filter((m) => (m.stream || "transactional") === g.key);
      const eng = engagementFor(rows);
      return {
        stream: g.key,
        sent: g.sent,
        delivered: g.delivered,
        ...eng,
        deliveryRate: pct(g.delivered, g.sent),
        openRate: pct(eng.opens, g.delivered),
      };
    })
    .sort((a, b) => b.sent - a.sent);

  const topDomains = group(messages, domainOf)
    .map((g) => ({
      domain: g.key,
      sent: g.sent,
      delivered: g.delivered,
      bounced: g.bounced,
      deliveryRate: pct(g.delivered, g.sent),
    }))
    .sort((a, b) => b.sent - a.sent)
    .slice(0, 10);

  // Why mail failed, most common first — the actionable part of a bad rate.
  const reasons = new Map();
  for (const e of events) {
    if (e.type !== "bounced" && e.type !== "failed" && e.type !== "retry_scheduled") continue;
    const reason = String(e.detail || "unknown").slice(0, 120);
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  const failures = [...reasons.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  /* ---------------------------- campaigns ---------------------------- */

  const campaigns = (db.campaigns || [])
    .filter(inScope)
    .map((c) => {
      const rows = messages.filter((m) => m.meta && m.meta.campaignId === c.id);
      const eng = engagementFor(rows);
      const sent = rows.length;
      const del = rows.filter((m) => is(m, /^delivered$/i)).length;
      return {
        id: c.id,
        name: c.name,
        status: c.status || "Draft",
        sent,
        delivered: del,
        opens: eng.opens,
        clicks: eng.clicks,
        deliveryRate: pct(del, sent),
        openRate: pct(eng.opens, del),
        clickRate: pct(eng.clicks, del),
        createdAt: c.created_at,
      };
    })
    .sort((a, b) => b.sent - a.sent || new Date(b.createdAt) - new Date(a.createdAt));

  const deliveredCount = delivered.length;
  return {
    at: new Date().toISOString(),
    range: { days, from: new Date(from).toISOString(), to: new Date().toISOString() },
    stream,
    totals: {
      sent: messages.length,
      delivered: deliveredCount,
      bounced: bounced.length,
      failed: failed.length,
      queued: queued.length,
      opens: openEvents.length,
      clicks: clickEvents.length,
      uniqueOpens,
      uniqueClicks,
      suppressed: (db.suppressions || []).filter(inScope).length,
    },
    rates: {
      // Rates are against what was actually delivered — the honest denominator
      // for engagement, and the one every provider reports against.
      delivery: pct(deliveredCount, messages.length),
      open: pct(uniqueOpens, deliveredCount),
      click: pct(uniqueClicks, deliveredCount),
      bounce: pct(bounced.length, messages.length),
      failure: pct(failed.length, messages.length),
    },
    series,
    byStream,
    topDomains,
    failures,
    campaigns,
  };
}
