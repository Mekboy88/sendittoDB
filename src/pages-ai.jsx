import { useCallback, useEffect, useRef, useState } from "react";
import { Brain, Send, ShieldAlert, Sparkles } from "lucide-react";
import { api, fmtTime, redact } from "./api.js";
import { Banner, Pill } from "./ui.jsx";

/**
 * AI Brain — for the people who run Senditto.
 *
 * It answers from the platform's real figures, which the server assembles and
 * sends with each question. Customers cannot reach this page or its endpoint:
 * the server refuses anyone who is not an owner or admin.
 */
export function AIBrainPage({ token, session }) {
  const [status, setStatus] = useState(null);
  const [question, setQuestion] = useState("");
  const [thread, setThread] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api("/api/ai/status", { token }));
    } catch (e) {
      setErr(redact(e.message));
    }
  }, [token]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread, busy]);

  const staff = ["owner", "admin"].includes(session?.user?.role);

  async function ask(text) {
    const q = (text ?? question).trim();
    if (!q || busy) return;
    setQuestion("");
    setErr("");
    setThread((t) => [...t, { role: "you", text: q, at: new Date().toISOString() }]);
    setBusy(true);
    try {
      const res = await api("/api/ai/brain", { method: "POST", token, body: { question: q } });
      setThread((t) => [
        ...t,
        { role: "brain", text: res.answer, at: new Date().toISOString(), usage: res.usage },
      ]);
    } catch (e) {
      setErr(redact(e.message));
      setThread((t) => [...t, { role: "error", text: redact(e.message), at: new Date().toISOString() }]);
    } finally {
      setBusy(false);
    }
  }

  const SUGGESTIONS = [
    "How is deliverability looking, and what should I fix first?",
    "Write me an advertising email for a developer audience, with three subject lines to test.",
    "Which numbers here are a warning sign I should act on this week?",
    "What should I do to get more of my domains verified?",
  ];

  if (!staff) {
    return (
      <section className="page">
        <header className="page-head">
          <h2><Brain size={18} /> AI Brain</h2>
        </header>
        <Banner tone="bad">The AI Brain is available to the owner and admins only.</Banner>
      </section>
    );
  }

  return (
    <section className="page ai-page">
      <header className="page-head">
        <div>
          <h2><Brain size={18} /> AI Brain</h2>
          <p>
            Private to the owner and admins. It reads the platform's own figures — no message
            bodies and no recipient addresses — and answers questions about growth,
            deliverability and advertising.
          </p>
        </div>
        <Pill
          ok={status ? status.configured : null}
          label={status ? (status.configured ? `Ready · ${status.model}` : "Not configured") : "…"}
        />
      </header>

      {status && !status.configured ? (
        <Banner tone="warn">
          The AI is not switched on yet. Set <code>ANTHROPIC_API_KEY</code> on the server and
          restart the API — until then this page will tell you it is unavailable rather than
          inventing an answer.
        </Banner>
      ) : null}

      {err ? <Banner tone="bad">{err}</Banner> : null}

      <div className="ai-thread">
        {thread.length === 0 ? (
          <div className="ai-empty">
            <Sparkles size={22} />
            <p>Ask about the platform. A few things worth starting with:</p>
            <div className="ai-suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn" type="button" onClick={() => ask(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          thread.map((m, i) => (
            <article key={i} className={`ai-msg ai-${m.role}`}>
              <div className="ai-msg-head">
                <b>{m.role === "you" ? "You" : m.role === "brain" ? "AI Brain" : "Error"}</b>
                <span>{fmtTime(m.at)}</span>
              </div>
              <div className="ai-msg-body">{m.text}</div>
              {m.usage ? (
                <div className="ai-msg-foot">
                  {m.usage.input_tokens} in · {m.usage.output_tokens} out
                </div>
              ) : null}
            </article>
          ))
        )}
        {busy ? <div className="ai-msg ai-brain ai-pending">Thinking…</div> : null}
        <div ref={endRef} />
      </div>

      <form
        className="ai-composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask about deliverability, growth, campaigns, or anything in the data…"
          disabled={busy || !status?.configured}
        />
        <button className="btn primary" type="submit" disabled={busy || !question.trim() || !status?.configured}>
          <Send size={15} /> Ask
        </button>
      </form>
    </section>
  );
}

/**
 * Abuse review — run the fraud model against an account or a message on
 * demand, and read back the verdict an operator can act on.
 */
export function FraudReviewPanel({ token, subject, onDone }) {
  const [verdict, setVerdict] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run() {
    setBusy(true);
    setErr("");
    try {
      const res = await api("/api/ai/fraud-check", { method: "POST", token, body: { subject } });
      setVerdict(res);
      onDone?.(res);
    } catch (e) {
      setErr(redact(e.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fraud-panel">
      <button className="btn" type="button" onClick={run} disabled={busy}>
        <ShieldAlert size={15} /> {busy ? "Checking…" : "Check for abuse"}
      </button>
      {err ? <Banner tone="bad">{err}</Banner> : null}
      {verdict ? (
        <div className={`fraud-verdict fraud-${verdict.risk}`}>
          <b>
            {verdict.risk} risk · {verdict.score}/100 · {verdict.recommendation}
          </b>
          <p>{verdict.reason}</p>
          {verdict.signals?.length ? (
            <ul>
              {verdict.signals.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
