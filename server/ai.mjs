/**
 * Senditto AI.
 *
 * Three separate jobs, deliberately kept apart:
 *
 *   1. Brain      — operator-only. Reads the platform's own numbers and
 *                   answers questions about growth, deliverability and
 *                   advertising. Never exposed to customers.
 *   2. Fraud      — scores signups and sending behaviour so abuse is caught
 *                   before mail goes out. Returns a structured verdict.
 *   3. Assistant  — the customer-facing helper. Sees only that customer's own
 *                   workspace summary, never another account's data.
 *
 * Nothing here invents an answer when it is not configured: without
 * ANTHROPIC_API_KEY every entry point reports that it is unavailable rather
 * than returning made-up analysis.
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.SENDITTO_AI_MODEL || "claude-opus-5";

let client = null;

function api() {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client = new Anthropic();
  return client;
}

export function aiReady() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function aiStatus() {
  return {
    configured: aiReady(),
    model: aiReady() ? MODEL : null,
    capabilities: ["brain", "fraud", "assistant"],
  };
}

class NotConfigured extends Error {
  constructor() {
    super("AI is not configured. Set ANTHROPIC_API_KEY on the server to enable it.");
    this.code = 503;
  }
}

/** Pull the text out of a response, guarding against a refusal. */
function textOf(response) {
  if (response.stop_reason === "refusal") {
    return "I can't help with that particular request.";
  }
  return response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/* -------------------------------- Brain -------------------------------- */

const BRAIN_SYSTEM = `You are the Senditto operations analyst. Senditto is an email
platform: transactional mail, one-time passcodes, and marketing campaigns.

You are talking to the platform's owner and admins — not to customers. You see
real platform figures and answer questions about growth, deliverability, sending
reputation, and advertising.

How to answer:
- Lead with the answer, then the reasoning. Keep it to what changes a decision.
- Ground every claim in the figures you were given. If the data does not support
  a conclusion, say what is missing rather than guessing.
- Deliverability advice must respect the law: no buying lists, no sending to
  people who did not opt in, always honour unsubscribes.
- When you suggest advertising or campaign copy, give something usable, not a
  description of what could be written.`;

/**
 * Answer an operator's question about the platform.
 * `snapshot` is the real figures; `question` is what the operator asked.
 */
export async function brainAsk({ question, snapshot }) {
  const anthropic = api();
  if (!anthropic) throw new NotConfigured();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: BRAIN_SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    messages: [
      {
        role: "user",
        content: `Here are the current platform figures:

${JSON.stringify(snapshot, null, 2)}

${question}`,
      },
    ],
  });

  return { answer: textOf(response), model: response.model, usage: response.usage };
}

/* -------------------------------- Fraud -------------------------------- */

const FRAUD_SCHEMA = {
  type: "object",
  properties: {
    risk: {
      type: "string",
      enum: ["low", "medium", "high"],
      description: "Overall risk that this account or send is abusive",
    },
    score: {
      type: "integer",
      description: "Risk score from 0 (clearly legitimate) to 100 (clearly abusive)",
    },
    signals: {
      type: "array",
      description: "The specific things that drove the score",
      items: { type: "string" },
    },
    recommendation: {
      type: "string",
      enum: ["allow", "review", "block"],
      description: "What the platform should do",
    },
    reason: {
      type: "string",
      description: "One or two sentences an operator can read",
    },
  },
  required: ["risk", "score", "signals", "recommendation", "reason"],
  additionalProperties: false,
};

const FRAUD_SYSTEM = `You screen signups and outgoing mail for a sending platform.

You are looking for the patterns that precede abuse: disposable or nonsense
addresses, a brand-new account immediately sending bulk mail, recipient lists
that look scraped, content that reads like phishing or a scam, and sudden
volume spikes that do not match an account's history.

Be proportionate. Ordinary businesses send marketing mail, use unfamiliar
domains, and occasionally send in bursts — none of that is abuse on its own.
Recommend "block" only for behaviour you can point at, "review" when it is
genuinely ambiguous, and "allow" otherwise. A false block costs a real customer
their business.`;

/** Score a signup or a send. Returns the structured verdict. */
export async function fraudScore(subject) {
  const anthropic = api();
  if (!anthropic) throw new NotConfigured();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: FRAUD_SYSTEM,
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: FRAUD_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Assess this for abuse risk:\n\n${JSON.stringify(subject, null, 2)}`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    return { risk: "medium", score: 50, signals: ["assessment unavailable"], recommendation: "review", reason: "The request could not be assessed automatically." };
  }
  const text = textOf(response);
  try {
    return JSON.parse(text);
  } catch {
    return { risk: "medium", score: 50, signals: ["unparseable assessment"], recommendation: "review", reason: text.slice(0, 200) };
  }
}

/* ------------------------------ Assistant ------------------------------ */

const ASSISTANT_SYSTEM = `You are the Senditto assistant, helping a customer inside
their own workspace on the Senditto email platform.

You can see a summary of their workspace only — their domains, contacts,
templates, campaigns and recent sending. You never see other customers' data,
and you must not speculate about the platform's other users.

Help them do the job: write campaign and transactional copy, improve subject
lines, explain why mail is landing in spam, walk them through verifying a
sending domain (SPF, DKIM, DMARC), and interpret their own numbers.

Two things you always hold to, because they are the law and because they are
what keeps their mail delivered: only send to people who asked for it, and
honour every unsubscribe immediately. If someone asks for help buying a list or
mailing people who did not opt in, say plainly that you can't help with that and
offer the legitimate alternative.

Keep answers short and usable. When you write copy, write the copy.`;

/** Answer a customer's question about their own workspace. */
export async function assistantAsk({ question, workspace }) {
  const anthropic = api();
  if (!anthropic) throw new NotConfigured();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    system: ASSISTANT_SYSTEM,
    thinking: { type: "adaptive" },
    output_config: { effort: "medium" },
    messages: [
      {
        role: "user",
        content: `My workspace right now:

${JSON.stringify(workspace, null, 2)}

${question}`,
      },
    ],
  });

  return { answer: textOf(response), model: response.model, usage: response.usage };
}
