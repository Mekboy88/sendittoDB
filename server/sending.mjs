/**
 * Senditto sending engine.
 *
 * Queues a message, delivers it over SMTP, retries transient failures with
 * backoff, and records exactly what the receiving server said. A message is
 * only "delivered" once a relay accepted it; anything else is "failed" or
 * "bounced" with the reason kept for support.
 *
 * Every send passes the same gates, whatever kind of mail it is:
 *   1. the recipient is a valid address,
 *   2. the recipient is not on the workspace suppression list,
 *   3. marketing mail carries List-Unsubscribe headers (law, not taste),
 *   4. the body and recipient are encrypted at rest.
 */
import { encryptIfPossible, decrypt } from "./crypto.mjs";
import { addressOnly, isValidEmail, mailerReady, sendMail } from "./mailer.mjs";

/** How long to wait before each retry. */
const BACKOFF_MS = [0, 30_000, 5 * 60_000, 30 * 60_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;

/** Kinds of mail the platform sends. */
export const STREAMS = {
  otp: { label: "One-time passcode", marketing: false, ttlMinutes: 10 },
  transactional: { label: "Transactional", marketing: false },
  marketing: { label: "Marketing", marketing: true },
  notification: { label: "Notification", marketing: false },
};

export function createSender(ctx) {
  const { db, saveDb, broadcast, logAudit, uid, nowIso } = ctx;
  let timer = null;

  /**
   * Every step a message takes is recorded, so the activity view shows what
   * actually happened and when — not a timeline guessed from the current
   * status. Kept newest-first and capped, because this is the busiest table.
   */
  function record(row, type, detail = {}) {
    if (!Array.isArray(db.message_events)) db.message_events = [];
    const event = {
      id: uid("mev"),
      message_id: row.id,
      workspace_id: row.workspace_id,
      stream: row.stream,
      type,
      attempt: row.attempts || 0,
      detail: detail.text || null,
      provider_response: detail.provider || null,
      created_at: nowIso(),
    };
    db.message_events.unshift(event);
    if (db.message_events.length > 5000) db.message_events.length = 5000;
    broadcast({ type: "change", collection: "message-events", event: "created", id: event.id, row: event });
    return event;
  }

  const suppressed = (workspaceId, email) =>
    db.suppressions.some(
      (s) =>
        addressOnly(decrypt(s.email)) === addressOnly(email) &&
        (!s.workspace_id || !workspaceId || s.workspace_id === workspaceId)
    );

  /** Put a message on the queue. Returns the stored row. */
  function enqueue({
    workspaceId = null,
    stream = "transactional",
    from,
    to,
    subject,
    text,
    html,
    replyTo,
    meta = {},
  }) {
    if (!isValidEmail(to)) return { error: "Recipient address is invalid", code: 422 };
    if (!STREAMS[stream]) return { error: `Unknown stream "${stream}"`, code: 422 };
    if (!subject || !String(subject).trim()) return { error: "Subject is required", code: 422 };
    if (!text && !html) return { error: "The message has no content", code: 422 };
    if (suppressed(workspaceId, to)) {
      return { error: "This address is on the suppression list", code: 409 };
    }

    const ws = db.workspaces.find((w) => w.id === workspaceId) || null;
    const row = {
      id: uid("msg"),
      workspace_id: workspaceId,
      workspace_name: ws?.name || null,
      stream,
      from_email: from || process.env.SMTP_FROM || "",
      to_email: encryptIfPossible(addressOnly(to)),
      to_hint: hint(addressOnly(to)),
      subject: encryptIfPossible(String(subject)),
      body_text: encryptIfPossible(text || ""),
      body_html: encryptIfPossible(html || ""),
      reply_to: replyTo || "",
      status: "queued",
      attempts: 0,
      next_attempt_at: nowIso(),
      last_error: null,
      provider_response: null,
      dkim_signed: false,
      opens: 0,
      clicks: 0,
      meta,
      created_at: nowIso(),
      updated_at: nowIso(),
      sent_at: null,
    };
    db.messages.unshift(row);
    record(row, "queued");
    logAudit("info", "message.queued", `Queued ${STREAMS[stream].label} to ${row.to_hint}`, "messages", {
      workspace_id: workspaceId,
    });
    broadcast({ type: "change", collection: "messages", event: "created", id: row.id, row: publicMessage(row) });
    saveDb();
    kick();
    return { row };
  }

  /** Deliver one queued message. */
  async function deliver(row) {
    row.status = "sending";
    row.attempts += 1;
    row.updated_at = nowIso();
    record(row, "sending");

    const stream = STREAMS[row.stream] || STREAMS.transactional;
    const to = decrypt(row.to_email);
    const headers = { "X-Senditto-Stream": row.stream };
    if (stream.marketing) {
      // Required for bulk mail in the EU and US, and by every major inbox.
      const unsubscribe = `${process.env.PUBLIC_BASE_URL || "https://senditto.dev"}/unsubscribe?m=${row.id}`;
      // Take the domain from the address itself: "Name <a@b.com>" must not
      // leave the closing bracket in the mailto link.
      const domain = addressOnly(row.from_email).split("@")[1] || "senditto.dev";
      headers["List-Unsubscribe"] = `<${unsubscribe}>, <mailto:unsubscribe@${domain}?subject=unsubscribe>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }

    try {
      const result = await sendMail({
        from: row.from_email,
        to,
        subject: decrypt(row.subject),
        text: decrypt(row.body_text) || undefined,
        html: withTracking(decrypt(row.body_html), row, stream) || undefined,
        replyTo: row.reply_to || undefined,
        headers,
      });
      row.status = "delivered";
      row.sent_at = nowIso();
      row.provider_response = result.response || "accepted";
      row.dkim_signed = result.signed;
      row.last_error = null;
      record(row, "delivered", { provider: result.response || "accepted" });
      logAudit("success", "message.delivered", `Delivered to ${row.to_hint}`, "messages", {
        workspace_id: row.workspace_id,
      });
      fireWebhooks(row, "message.delivered");
    } catch (err) {
      const message = String(err.message || err);
      row.last_error = message;
      // 5xx from the relay is permanent; anything else is worth retrying.
      const permanent = /SMTP 5\d\d/.test(message) || /invalid/i.test(message);
      if (permanent || row.attempts >= MAX_ATTEMPTS) {
        row.status = permanent ? "bounced" : "failed";
        record(row, row.status, { text: message });
        if (row.status === "bounced") addSuppression(row, message);
        logAudit("error", "message.failed", `${row.status} to ${row.to_hint}: ${message}`, "messages", {
          workspace_id: row.workspace_id,
        });
        fireWebhooks(row, `message.${row.status}`);
      } else {
        row.status = "queued";
        row.next_attempt_at = new Date(Date.now() + BACKOFF_MS[row.attempts]).toISOString();
        record(row, "retry_scheduled", { text: message });
        logAudit("warn", "message.retry", `Retry ${row.attempts} for ${row.to_hint}: ${message}`, "messages", {
          workspace_id: row.workspace_id,
        });
      }
    }

    row.updated_at = nowIso();
    broadcast({ type: "change", collection: "messages", event: "updated", id: row.id, row: publicMessage(row) });
    saveDb();
  }

  /**
   * Add open and click tracking to marketing mail.
   *
   * Only marketing: a one-time passcode or a password reset is not something
   * to put a tracking pixel in, and doing so would be indefensible. Needs
   * PUBLIC_BASE_URL, since the links have to be reachable from an inbox.
   */
  function withTracking(html, row, stream) {
    const base = process.env.PUBLIC_BASE_URL;
    if (!html || !base || !stream.marketing || process.env.SENDITTO_TRACKING === "0") return html;
    const root = base.replace(/\/$/, "");

    // Rewrite links so a click is recorded and then passed straight on.
    let out = html.replace(/href\s*=\s*"(https?:\/\/[^"]+)"/gi, (m, url) => {
      if (url.startsWith(`${root}/t/`)) return m; // already ours
      return `href="${root}/t/c/${row.id}?u=${encodeURIComponent(url)}"`;
    });

    const pixel = `<img src="${root}/t/o/${row.id}.gif" width="1" height="1" alt="" style="display:none">`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${pixel}</body>`) : out + pixel;
    return out;
  }

  /** A hard bounce must never be mailed again. */
  function addSuppression(row, reason) {
    const email = decrypt(row.to_email);
    if (suppressed(row.workspace_id, email)) return;
    const entry = {
      id: uid("sup"),
      workspace_id: row.workspace_id,
      workspace_name: row.workspace_name,
      email: encryptIfPossible(email),
      email_hint: row.to_hint,
      reason: "hard_bounce",
      detail: String(reason).slice(0, 300),
      created_at: nowIso(),
    };
    db.suppressions.unshift(entry);
    broadcast({ type: "change", collection: "suppressions", event: "created", id: entry.id, row: entry });
  }

  /** Notify the workspace's webhooks. Real HTTP, with the result recorded. */
  function fireWebhooks(row, event) {
    const hooks = db.webhooks.filter(
      (w) => w.status !== "disabled" && (!w.workspace_id || w.workspace_id === row.workspace_id)
    );
    for (const hook of hooks) {
      const events = Array.isArray(hook.events) ? hook.events : [];
      if (events.length && !events.includes(event)) continue;
      const payload = {
        event,
        message_id: row.id,
        workspace_id: row.workspace_id,
        stream: row.stream,
        to: row.to_hint,
        status: row.status,
        at: nowIso(),
      };
      fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Senditto-Event": event },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      })
        .then((res) => {
          hook[res.ok ? "success" : "failures"] = (hook[res.ok ? "success" : "failures"] || 0) + 1;
          hook.last_status = res.status;
          hook.last_delivery_at = nowIso();
          saveDb();
        })
        .catch((e) => {
          hook.failures = (hook.failures || 0) + 1;
          hook.last_error = String(e.message || e).slice(0, 200);
          hook.last_delivery_at = nowIso();
          saveDb();
        });
    }
  }

  /** Work the queue. */
  async function tick() {
    if (!mailerReady()) return;
    const now = Date.now();
    const due = db.messages
      .filter((m) => m.status === "queued" && new Date(m.next_attempt_at || 0).getTime() <= now)
      .slice(0, 20);
    for (const row of due) await deliver(row);
  }

  function kick() {
    if (!mailerReady()) return;
    setTimeout(() => tick().catch(() => {}), 50);
  }

  function start() {
    clearInterval(timer);
    timer = setInterval(() => tick().catch(() => {}), 15000);
    timer.unref?.();
  }

  return { enqueue, deliver, tick, start, suppressed, publicMessage, fireWebhooks, record };
}

/** Mask an address for display: never show a full recipient in a list. */
export function hint(email) {
  const [user = "", domain = ""] = String(email).split("@");
  const shown = user.slice(0, 2);
  return `${shown}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

/** The shape safe to send to a client: no bodies, no full recipient. */
export function publicMessage(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_name: row.workspace_name,
    stream: row.stream,
    from_email: row.from_email,
    to_email: row.to_hint || hint(decrypt(row.to_email)),
    subject: decrypt(row.subject),
    status: row.status,
    attempts: row.attempts,
    last_error: row.last_error,
    provider_response: row.provider_response,
    dkim_signed: row.dkim_signed,
    opens: row.opens,
    clicks: row.clicks,
    created_at: row.created_at,
    sent_at: row.sent_at,
  };
}
