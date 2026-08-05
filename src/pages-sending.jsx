import { useCallback, useEffect, useState } from "react";
import { Check, Copy, KeyRound, RefreshCw, Send } from "lucide-react";
import { api, fmtTime, redact } from "./api.js";
import { Banner, Panel, Pill, useAppConfirm } from "./ui.jsx";

/** Copy a value to the clipboard and confirm it visually. */
function CopyValue({ value }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`btn copy-btn${done ? " is-copied" : ""}`}
      type="button"
      title="Copy"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? "Copied" : "Copy"}
    </button>
  );
}

/**
 * Sending setup — the DNS records a domain needs before it can send, checked
 * against live public DNS, plus signing-key rotation.
 */
export function SendingSetupPage({ token, session }) {
  const confirm = useAppConfirm();
  const [data, setData] = useState(null);
  const [domain, setDomain] = useState("");
  const [spf, setSpf] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(
    async (d) => {
      setBusy(true);
      setErr("");
      try {
        const q = d || domain;
        const res = await api(`/api/sending/setup${q ? `?domain=${encodeURIComponent(q)}` : ""}`, { token });
        setData(res);
        setDomain(res.domain || "");
        setSpf(res.spfInclude || "");
      } catch (e) {
        setErr(redact(e.message));
      } finally {
        setBusy(false);
      }
    },
    [token, domain]
  );

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const canEdit = ["owner", "admin"].includes(session?.user?.role);

  async function saveSpf() {
    setBusy(true);
    setErr("");
    try {
      await api("/api/sending/spf", { method: "POST", token, body: { include: spf } });
      setMsg("SPF include saved.");
      await load();
    } catch (e) {
      setErr(redact(e.message));
    } finally {
      setBusy(false);
    }
  }

  async function rotate() {
    const ok = await confirm({
      title: "Rotate the signing key?",
      message:
        "A new key is generated and used to sign mail immediately. Publish the new DNS record straight after — until you do, receivers cannot verify new mail. The old record can be removed once the new one is live.",
      confirmLabel: "Rotate key",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api("/api/sending/dkim/rotate", { method: "POST", token, body: { domain } });
      setMsg(`New key active as ${res.host}. Publish the DKIM record below, then press Check.`);
      await load();
    } catch (e) {
      setErr(redact(e.message));
    } finally {
      setBusy(false);
    }
  }

  const records = data?.records || [];
  const ready = data?.verified;

  return (
    <section className="page">
      <header className="page-head">
        <div>
          <h2><Send size={18} /> Sending setup</h2>
          <p>
            The records a domain needs before it can send, checked against live public DNS.
            Publish these at your DNS provider, then press Check.
          </p>
        </div>
        <div className="head-actions">
          <Pill ok={ready === undefined ? null : ready} label={ready ? "Domain verified" : "Not verified"} />
          <button className="btn" type="button" onClick={() => load()} disabled={busy}>
            <RefreshCw size={15} /> {busy ? "Checking…" : "Check DNS"}
          </button>
        </div>
      </header>

      {err ? <Banner tone="bad">{err}</Banner> : null}
      {msg ? <Banner tone="ok">{msg}</Banner> : null}

      {data && !data.domain ? (
        <Banner tone="warn">Add a sending domain first, on the Domains page.</Banner>
      ) : null}

      <Panel
        title="DNS records to publish"
        copy={`For ${data?.domain || "your domain"} · checked ${data?.checkedAt ? fmtTime(data.checkedAt) : "—"}`}
      >
        <div className="dns-records">
          {records.map((r) => (
            <article key={r.id} className={`dns-record${r.published ? " is-live" : ""}`}>
              <div className="dns-head">
                <div>
                  <b>{r.type} · {r.name}</b>
                  <small>{r.purpose}</small>
                </div>
                <Pill ok={r.published} label={r.published ? "Live in DNS" : "Not published"} />
              </div>
              {r.needsInput ? (
                <Banner tone="warn">
                  Set your provider's SPF include below so this record is complete.
                </Banner>
              ) : null}
              <div className="dns-value">
                <code>{r.value || "—"}</code>
                {r.value ? <CopyValue value={r.value} /> : null}
              </div>
              {r.detail ? <div className="dns-detail">{r.detail}</div> : null}
            </article>
          ))}
          {records.length === 0 ? <p className="muted">Nothing to publish yet.</p> : null}
        </div>
      </Panel>

      <Panel
        title="SPF include"
        copy="Your sending provider publishes an SPF include. Paste it here and the record above completes itself."
      >
        <div className="form-row">
          <input
            value={spf}
            onChange={(e) => setSpf(e.target.value)}
            placeholder="e.g. _spf.google.com, sendgrid.net, spf.mailgun.org"
            disabled={!canEdit || busy}
          />
          <button className="btn" type="button" onClick={saveSpf} disabled={!canEdit || busy}>
            Save
          </button>
        </div>
      </Panel>

      <Panel
        title="Signing key"
        copy="Mail is signed with this key so receivers can prove it came from you. The private half never leaves the server."
      >
        <dl className="kv">
          <div>
            <dt>Signing as</dt>
            <dd>{data?.dkim?.host || "not configured"}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{data?.dkim?.active ? "Active" : "No key"}</dd>
          </div>
          <div>
            <dt>Last rotated</dt>
            <dd>{data?.dkim?.rotatedAt ? fmtTime(data.dkim.rotatedAt) : "never"}</dd>
          </div>
        </dl>
        <div className="panel-actions">
          <button className="btn warn" type="button" onClick={rotate} disabled={!canEdit || busy || !data?.domain}>
            <KeyRound size={15} /> Rotate signing key
          </button>
          {!canEdit ? <span className="muted">Only an owner or admin can rotate the key.</span> : null}
        </div>
      </Panel>
    </section>
  );
}
