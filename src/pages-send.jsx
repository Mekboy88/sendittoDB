import { useCallback, useEffect, useState } from "react";
import { Mail, Send } from "lucide-react";
import { api, redact } from "./api.js";
import { Banner, Panel } from "./ui.jsx";
import { useEntity } from "./pages.jsx";

const STREAMS = [
  ["transactional", "Transactional — receipts, resets, confirmations"],
  ["notification", "Notification — alerts and updates"],
  ["marketing", "Marketing — campaigns and announcements"],
  ["otp", "One-time passcode — sign-in codes"],
];

/**
 * Send email — the operator's own composer. It goes through the same sending
 * engine the product uses, so what happens here is exactly what happens for a
 * customer: the same validation, suppression list, domain check and events.
 */
export function SendPage({ token }) {
  const { rows: workspaces } = useEntity(token, "/api/workspaces");
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({
    workspaceId: "",
    stream: "transactional",
    from: "",
    to: "",
    replyTo: "",
    subject: "",
    text: "",
    html: "",
    sendAt: "",
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api("/api/send/status", { token }));
    } catch (e) {
      setErr(redact(e.message));
    }
  }, [token]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!form.workspaceId && workspaces.length) {
      setForm((f) => ({ ...f, workspaceId: workspaces[0].id }));
    }
  }, [workspaces, form.workspaceId]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setResult(null);
    try {
      const recipients = form.to
        .split(/[,\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const sent = [];
      for (const to of recipients) {
        const res = await api("/api/send", {
          method: "POST",
          token,
          body: {
            workspaceId: form.workspaceId || null,
            stream: form.stream,
            from: form.from || undefined,
            replyTo: form.replyTo || undefined,
            to,
            subject: form.subject,
            text: form.text || undefined,
            html: form.html || undefined,
            sendAt: form.sendAt ? new Date(form.sendAt).toISOString() : undefined,
          },
        });
        sent.push({ to, id: res.message?.id, status: res.message?.status });
      }
      setResult(sent);
      setForm((f) => ({ ...f, to: "", subject: "", text: "", html: "", sendAt: "" }));
    } catch (e2) {
      setErr(redact(e2.message));
    } finally {
      setBusy(false);
    }
  }

  const ready = status?.mailer?.configured;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2><Mail size={18} /> Send email</h2>
          <p>
            Sends through the same engine the product uses — the same address checks, suppression
            list, sending-domain rules, signing and delivery events.
          </p>
        </div>
      </header>

      {err ? <Banner tone="bad">{err}</Banner> : null}
      {status && !ready ? (
        <Banner tone="warn">
          Email delivery is not configured. Set <code>SMTP_HOST</code> and <code>SMTP_FROM</code> on
          the server — until then every send is refused rather than silently dropped.
        </Banner>
      ) : null}
      {result ? (
        <Banner tone="ok">
          {result.map((r) => `${r.to} → ${r.status} (${r.id})`).join(" · ")}
        </Banner>
      ) : null}

      <Panel title="Compose" copy={ready ? `Signing as ${status.mailer.dkim}` : "Delivery is not configured yet"}>
        <form onSubmit={submit} className="form">
          <label>
            <span className="lbl">Workspace</span>
            <select value={form.workspaceId} onChange={set("workspaceId")}>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="lbl">Stream</span>
            <select value={form.stream} onChange={set("stream")}>
              {STREAMS.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="lbl">From (blank uses the platform address)</span>
            <input value={form.from} onChange={set("from")} placeholder={status?.mailer?.from || "hello@senditto.dev"} />
          </label>
          <label>
            <span className="lbl">Reply-to (optional)</span>
            <input value={form.replyTo} onChange={set("replyTo")} />
          </label>
          <label className="full">
            <span className="lbl">To — separate several with commas</span>
            <input value={form.to} onChange={set("to")} required placeholder="someone@example.com" />
          </label>
          <label className="full">
            <span className="lbl">Subject</span>
            <input value={form.subject} onChange={set("subject")} required />
          </label>
          <label className="full">
            <span className="lbl">Plain text</span>
            <textarea rows={5} value={form.text} onChange={set("text")} />
          </label>
          <label className="full">
            <span className="lbl">HTML (optional)</span>
            <textarea rows={5} value={form.html} onChange={set("html")} />
          </label>
          <label>
            <span className="lbl">Send later (optional)</span>
            <input type="datetime-local" value={form.sendAt} onChange={set("sendAt")} />
          </label>
          <div className="full">
            <button className="btn primary" type="submit" disabled={busy || !ready}>
              <Send size={15} /> {busy ? "Sending…" : form.sendAt ? "Schedule" : "Send now"}
            </button>
          </div>
        </form>
      </Panel>
    </section>
  );
}
