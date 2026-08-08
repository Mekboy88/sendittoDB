/**
 * Senditto local development API — DEV ONLY.
 *
 * Zero-dependency Node server implementing the Senditto control-plane
 * contract the Database Studio (and later the Platform) talk to:
 * auth, stats, realtime SSE, and CRUD for every entity. State persists to
 * server/data/db.json (gitignored) and is seeded deterministically on first
 * boot so the studio is fully explorable.
 *
 *   node server/index.mjs           →  http://localhost:5181
 *   DEV login: owner@senditto.dev / senditto-owner
 *
 * This is the executable specification for the future production backend
 * (Node + PostgreSQL). Do NOT expose it to the internet.
 */
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  decrypt,
  encryptIfPossible,
  encryptionReady,
  hashPassword,
  hashSecret,
  isHashed,
  verifyPassword,
  verifySecret,
} from "./crypto.mjs";
import {
  configureDkim,
  dkimInfo,
  dkimPublicRecord,
  generateDkimKeypair,
  mailerReady,
  mailerStatus,
} from "./mailer.mjs";
import { verifyDomain } from "./dnscheck.mjs";
import { STREAMS, createSender, hint, publicMessage } from "./sending.mjs";
import { aiStatus, assistantAsk, brainAsk, fraudScore } from "./ai.mjs";

const PORT = Number(process.env.PORT || 5181);
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");
const DB_FILE = join(DATA_DIR, "db.json");
const OWNER_EMAIL = process.env.OWNER_EMAIL || process.env.DEV_OWNER_EMAIL || "owner@senditto.dev";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || process.env.DEV_OWNER_PASSWORD || "senditto-owner";
// SEED_DEMO=0 seeds only the owner account (production); default seeds full demo data (dev).
const SEED_DEMO = process.env.SEED_DEMO !== "0";
/**
 * How long a session stays valid without being used. It is a *rolling* window:
 * every authenticated request pushes the expiry back, so an account in regular
 * use is never signed out, and only a genuinely idle one lapses.
 */
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS || 720) * 3600 * 1000;
const START_TS = Date.now();

/* ============================ tiny utils ============================ */

let counter = 0;
const uid = (p) => `${p}_${Date.now().toString(36)}${(++counter).toString(36)}${randomBytes(3).toString("hex")}`;
const nowIso = () => new Date().toISOString();
const isoAgo = (ms) => new Date(Date.now() - ms).toISOString();

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];
function weighted(rand, pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[0][0];
}

/* ============================ persistence ============================ */

let db = null;

function saveDb() {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(DB_FILE, JSON.stringify(db, null, 1));
}

function loadDb() {
  try {
    db = JSON.parse(readFileSync(DB_FILE, "utf8"));
    if (!db || !Array.isArray(db.users)) throw new Error("corrupt");
  } catch {
    db = seed();
  }
  if (!Array.isArray(db.message_events)) db.message_events = [];
  if (!Array.isArray(db.otp_codes)) db.otp_codes = [];
  migratePasswords();
  saveDb();
}

/**
 * Older databases kept passwords as readable text. Replace any that remain
 * with a scrypt hash on boot, so a copy of the file reveals nothing.
 */
function migratePasswords() {
  let changed = 0;
  for (const user of db.users) {
    if (user.password && !isHashed(user.password)) {
      user.password = hashPassword(user.password);
      changed++;
    }
  }
  if (changed) console.log(`Secured ${changed} stored password${changed === 1 ? "" : "s"} (scrypt).`);
}

/* ============================ seed data ============================ */

function seed() {
  const rand = mulberry32(20260721);
  const d = {
    meta: { seededAt: nowIso(), roleMatrix: null, workspaceMatrix: null, matrixUpdatedAt: null },
    users: [],
    workspaces: [],
    domains: [],
    api_keys: [],
    messages: [],
    suppressions: [],
    audit: [],
    rights: [],
    sessions: [],
    internal_messages: [],
    contacts: [],
    templates: [],
    campaigns: [],
    webhooks: [],
    message_events: [],
  };

  const mkUser = (email, display_name, role, extra = {}) => {
    const u = {
      id: uid("usr"),
      email,
      display_name,
      role,
      status: "active",
      phone: "",
      company: extra.company || "",
      country: extra.country || "",
      two_factor_enabled: role === "owner",
      password: hashPassword(extra.password || "senditto-dev"),
      created_at: isoAgo(90 * 864e5 * rand() + 864e5),
      last_seen: isoAgo(rand() * 3 * 864e5),
    };
    d.users.push(u);
    return u;
  };

  const owner = mkUser(OWNER_EMAIL, "Platform Owner", "owner", { password: OWNER_PASSWORD, company: "Senditto" });
  if (!SEED_DEMO) {
    owner.created_at = nowIso();
    owner.last_seen = null;
    return d;
  }
  mkUser("admin@senditto.dev", "Andi Admin", "admin", { company: "Senditto" });
  mkUser("ops@senditto.dev", "Olga Operator", "operator", { company: "Senditto" });
  mkUser("support@senditto.dev", "Sami Support", "support", { company: "Senditto" });
  const cust1 = mkUser("founder@acme.dev", "Ava Founder", "developer", { company: "Acme Dev" });
  const cust2 = mkUser("cto@northwind.io", "Noah CTO", "developer", { company: "Northwind" });
  const cust3 = mkUser("growth@lumina.app", "Mia Growth", "developer", { company: "Lumina" });

  const mkWs = (name, type, ownerUser, status = "Active") => {
    const w = {
      id: uid("ws"),
      name,
      type,
      region: pick(rand, ["eu-west", "us-east"]),
      timezone: pick(rand, ["Europe/Berlin", "Europe/London", "America/New_York"]),
      status,
      owner_user_id: ownerUser.id,
      owner_email: ownerUser.email,
      owner_display_name: ownerUser.display_name,
      created_at: isoAgo(60 * 864e5 * rand() + 5 * 864e5),
      updated_at: nowIso(),
    };
    d.workspaces.push(w);
    return w;
  };

  const wsAcme = mkWs("Acme Production", "Developer", cust1);
  const wsNorth = mkWs("Northwind App", "Business", cust2);
  const wsLumina = mkWs("Lumina Marketing", "Marketing", cust3);
  mkWs("Acme Staging", "Developer", cust1, "Paused");

  const mkDomain = (domain, ws, verified) => {
    d.domains.push({
      id: uid("dom"),
      domain,
      status: verified ? "verified" : "pending",
      workspace_id: ws.id,
      workspace_name: ws.name,
      spf: verified,
      dkim: verified,
      dmarc: verified && rand() > 0.3,
      created_at: isoAgo(40 * 864e5 * rand() + 864e5),
      updated_at: nowIso(),
    });
  };
  mkDomain("acme.dev", wsAcme, true);
  mkDomain("updates.acme.dev", wsAcme, false);
  mkDomain("northwind.io", wsNorth, true);
  mkDomain("mail.lumina.app", wsLumina, true);
  mkDomain("promo.lumina.app", wsLumina, false);

  const mkKey = (name, ws, env, status = "active") => {
    d.api_keys.push({
      id: uid("key"),
      name,
      key_prefix: env === "live" ? "sk_live_" : "sk_test_",
      environment: env,
      scopes: env === "live" ? ["email:send", "email:read", "suppressions:read"] : ["email:send"],
      status,
      workspace_id: ws.id,
      workspace_name: ws.name,
      created_at: isoAgo(30 * 864e5 * rand() + 864e5),
      last_used: status === "active" ? isoAgo(rand() * 864e5) : isoAgo(20 * 864e5),
    });
  };
  mkKey("Production backend", wsAcme, "live");
  mkKey("Staging", wsAcme, "test");
  mkKey("Northwind API", wsNorth, "live");
  mkKey("Lumina campaigns", wsLumina, "live");
  mkKey("Old CLI key", wsNorth, "live", "revoked");

  // contacts
  const FIRST = ["Ava", "Liam", "Mia", "Noah", "Zoe", "Eli", "Ivy", "Max", "Lea", "Kai", "Nora", "Ben", "Ana", "Leo", "Emma", "Jon"];
  const LAST = ["Berg", "Chen", "Diaz", "Evans", "Fox", "Gray", "Hoxha", "Ito", "Jones", "Krasniqi", "Lund", "Mori", "Novak", "Ortiz"];
  const wsList = [wsAcme, wsNorth, wsLumina];
  for (let i = 0; i < 64; i++) {
    const fn = pick(rand, FIRST);
    const ln = pick(rand, LAST);
    const ws = pick(rand, wsList);
    d.contacts.push({
      id: uid("ct"),
      name: `${fn} ${ln}`,
      email: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@${pick(rand, ["gmail.com", "outlook.com", "proton.me", "company.com"])}`,
      status: weighted(rand, [["Subscribed", 72], ["Pending", 12], ["Unsubscribed", 16]]),
      tags: weighted(rand, [[["customer"], 40], [["trial"], 25], [["newsletter"], 20], [["vip", "customer"], 15]]),
      workspace_id: ws.id,
      workspace_name: ws.name,
      created_at: isoAgo(50 * 864e5 * rand()),
      updated_at: nowIso(),
    });
  }

  // templates & campaigns
  const tpl = (name, category, subject, status, usage, ws) => {
    d.templates.push({
      id: uid("tpl"),
      name,
      category,
      subject,
      html: `<h1>${subject}</h1><p>Hello {{name}},</p>`,
      status,
      usage,
      workspace_id: ws?.id || null,
      workspace_name: ws?.name || null,
      created_at: isoAgo(30 * 864e5 * rand() + 864e5),
      updated_at: nowIso(),
    });
  };
  tpl("Welcome email", "Onboarding", "Welcome to Acme 👋", "Published", 182, wsAcme);
  tpl("OTP code", "Security", "Your verification code", "Published", 951, wsAcme);
  tpl("Password reset", "Security", "Reset your password", "Published", 77, wsNorth);
  tpl("Invoice ready", "Billing", "Your invoice is ready", "Published", 214, wsNorth);
  tpl("July newsletter", "Newsletter", "What's new in July", "Draft", 0, wsLumina);

  const camp = (name, subject, audience, status, sent, opened, clicked, ws) => {
    d.campaigns.push({
      id: uid("cmp"),
      name,
      subject,
      audience,
      status,
      sent,
      opened,
      clicked,
      workspace_id: ws.id,
      workspace_name: ws.name,
      created_at: isoAgo(20 * 864e5 * rand() + 864e5),
      updated_at: nowIso(),
    });
  };
  camp("Summer launch", "The summer release is here", "Newsletter audience", "Sent", 1204, 611, 148, wsLumina);
  camp("Win-back July", "We miss you — 20% off", "Win-back", "Scheduled", 0, 0, 0, wsLumina);
  camp("Feature digest", "3 new things in your app", "Active customers", "Draft", 0, 0, 0, wsAcme);

  // webhooks
  d.webhooks.push(
    {
      id: uid("wh"),
      name: "Delivery events",
      url: "https://api.acme.dev/hooks/senditto",
      events: ["email.delivered", "email.bounced", "email.complained"],
      status: "Active",
      success: 998,
      failed: 2,
      workspace_id: wsAcme.id,
      workspace_name: wsAcme.name,
      created_at: isoAgo(25 * 864e5),
      updated_at: nowIso(),
    },
    {
      id: uid("wh"),
      name: "Marketing events",
      url: "https://crm.lumina.app/senditto",
      events: ["email.opened", "email.clicked", "contact.unsubscribed"],
      status: "Active",
      success: 412,
      failed: 0,
      workspace_id: wsLumina.id,
      workspace_name: wsLumina.name,
      created_at: isoAgo(12 * 864e5),
      updated_at: nowIso(),
    }
  );

  // messages over 14 days
  const SUBJECTS = [
    ["Your verification code", "OTP"],
    ["Welcome to Acme 👋", "Transactional"],
    ["Password reset requested", "Transactional"],
    ["Your invoice is ready", "Transactional"],
    ["The summer release is here", "Marketing"],
    ["What's new in July", "Marketing"],
    ["Day 3: getting the most out", "Automations"],
  ];
  for (let i = 0; i < 640; i++) {
    const [subject, stream] = weighted(rand, [
      [SUBJECTS[0], 26], [SUBJECTS[1], 12], [SUBJECTS[2], 9], [SUBJECTS[3], 11],
      [SUBJECTS[4], 18], [SUBJECTS[5], 10], [SUBJECTS[6], 14],
    ]);
    const ws = pick(rand, wsList);
    const contact = pick(rand, d.contacts);
    d.messages.push({
      id: uid("msg"),
      to_email: contact.email,
      from_email: stream === "Marketing" ? `news@${ws.name.split(" ")[0].toLowerCase()}.dev` : `no-reply@${ws.name.split(" ")[0].toLowerCase()}.dev`,
      subject,
      body: `${subject} — automated ${stream.toLowerCase()} message.`,
      stream,
      status: weighted(rand, [["delivered", 55], ["sent", 8], ["queued", 3], ["bounced", 5], ["failed", 4], ["cancelled", 1], ["delivered", 24]]),
      workspace_id: ws.id,
      workspace_name: ws.name,
      meta: {},
      created_at: isoAgo(rand() * 14 * 864e5),
      updated_at: nowIso(),
    });
  }
  d.messages.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // suppressions
  const sup = (email, reason, source, note, ws) => {
    d.suppressions.push({
      id: uid("sup"),
      email,
      reason,
      source,
      user_note: note,
      workspace_id: ws.id,
      workspace_name: ws.name,
      owner_email: ws.owner_email,
      event_at: isoAgo(rand() * 20 * 864e5),
      created_at: isoAgo(rand() * 20 * 864e5),
      updated_at: nowIso(),
    });
  };
  sup("bounce.test@oldcorp.com", "bounce", "bounce_processor", "", wsAcme);
  sup("angry.user@gmail.com", "complaint", "complaint_fbl", "", wsLumina);
  sup("ex.customer@outlook.com", "unsubscribe", "one_click_unsubscribe", "Too many emails.", wsLumina);
  sup("privacy.first@proton.me", "unsubscribe", "user_unsubscribe", "Please remove me from all lists.", wsNorth);

  // audit
  const audits = [
    ["success", "auth.login", "Owner signed in to the studio", "security"],
    ["info", "keys.create", "API key “Production backend” created", "keys"],
    ["info", "domains.verify", "Domain acme.dev verified (SPF, DKIM)", "domains"],
    ["warn", "messages.bounce", "Hard bounce recorded for bounce.test@oldcorp.com", "delivery"],
    ["info", "workspace.create", "Workspace “Lumina Marketing” created", "workspaces"],
    ["error", "webhook.fail", "Webhook post failed twice — retrying with backoff", "webhooks"],
    ["info", "rights.request", "Erasure request recorded", "compliance"],
    ["success", "campaign.sent", "Campaign “Summer launch” finished sending", "campaigns"],
  ];
  for (let i = 0; i < 48; i++) {
    const [level, event, message, category] = pick(rand, audits);
    const ws = pick(rand, wsList);
    d.audit.push({
      id: uid("aud"),
      level,
      event,
      message,
      category,
      workspace_id: ws.id,
      owner_email: ws.owner_email,
      meta: {},
      created_at: isoAgo(rand() * 7 * 864e5),
    });
  }
  d.audit.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // rights requests
  d.rights.push(
    {
      id: uid("rr"),
      type: "erasure",
      requester_email: "privacy.first@proton.me",
      requester_name: "Privacy First",
      subject_email: "privacy.first@proton.me",
      status: "in_progress",
      workspace_id: wsNorth.id,
      description: "Delete all personal data associated with my address.",
      note: "",
      due_at: new Date(Date.now() + 20 * 864e5).toISOString(),
      source: "email",
      channel: "support_email",
      status_history: [
        { status: "recorded", at: isoAgo(6 * 864e5) },
        { status: "in_progress", at: isoAgo(2 * 864e5) },
      ],
      created_at: isoAgo(6 * 864e5),
      updated_at: nowIso(),
    },
    {
      id: uid("rr"),
      type: "access",
      requester_email: "ava.berg1@gmail.com",
      requester_name: "Ava Berg",
      subject_email: "ava.berg1@gmail.com",
      status: "recorded",
      workspace_id: wsLumina.id,
      description: "Copy of all data you hold about me.",
      note: "",
      due_at: new Date(Date.now() + 27 * 864e5).toISOString(),
      source: "form",
      channel: "webform",
      status_history: [{ status: "recorded", at: isoAgo(1 * 864e5) }],
      created_at: isoAgo(1 * 864e5),
      updated_at: nowIso(),
    }
  );

  // internal messages
  d.internal_messages.push({
    id: uid("im"),
    channel: "both",
    workspace_id: wsAcme.id,
    workspace_name: wsAcme.name,
    to: cust1.email,
    to_user_id: cust1.id,
    subject: "Your domain updates.acme.dev is still pending",
    body: "Hello Ava — the DKIM records for updates.acme.dev are not visible yet. Add the two CNAMEs from the Domains page and verification will complete automatically.",
    from: owner.email,
    created_at: isoAgo(2 * 864e5),
  });

  return d;
}

/* ============================ realtime ============================ */

const sseClients = new Set();

function broadcast(event) {
  const payload = `data: ${JSON.stringify({ ...event, at: event.at || nowIso() })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      sseClients.delete(res);
    }
  }
}

setInterval(() => {
  broadcast({ type: "overview", data: statsPayload() });
}, 5000).unref?.();

/* ============================ auth ============================ */

function tokenFrom(req) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

function sessionFor(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const s = db.sessions.find((x) => x.token === token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    db.sessions = db.sessions.filter((x) => x !== s);
    saveDb();
    return null;
  }
  s.last_seen_at = nowIso();
  // Roll the window forward. Throttled, so a busy client does not rewrite the
  // database on every single request.
  const expiresAt = new Date(s.expires_at).getTime();
  const target = Date.now() + SESSION_TTL_MS;
  if (target - expiresAt > 10 * 60 * 1000) {
    s.expires_at = new Date(target).toISOString();
    saveDb();
  }
  return s;
}

function userOf(session) {
  return db.users.find((u) => u.id === session.user_id) || null;
}

/**
 * Shape any stored row for a client: encrypted fields are shown as their
 * readable value where the viewer is entitled to it, and never as ciphertext.
 */
function publicRow(row) {
  if (!row || typeof row !== "object") return row;
  let out = row;
  for (const field of ["email", "body", "body_text", "body_html", "subject"]) {
    if (typeof row[field] === "string" && row[field].startsWith("enc:v1:")) {
      if (out === row) out = { ...row };
      out[field] = decrypt(row[field]);
    }
  }
  return out;
}

function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return { ...rest, displayName: u.display_name };
}

/* ============================ stats ============================ */

function human(bytes) {
  if (bytes > 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function tableMeta() {
  const defs = [
    ["users", db.users, 128],
    ["workspaces", db.workspaces, 96],
    ["domains", db.domains, 112],
    ["api_keys", db.api_keys, 104],
    ["messages", db.messages, 420],
    ["suppressions", db.suppressions, 96],
    ["audit_log", db.audit, 180],
    ["rights_requests", db.rights, 220],
    ["sessions", db.sessions, 140],
    ["internal_messages", db.internal_messages, 260],
    ["message_events", db.message_events, 150],
    ["contacts", db.contacts, 150],
    ["templates", db.templates, 340],
    ["campaigns", db.campaigns, 160],
    ["webhooks", db.webhooks, 130],
  ];
  return defs.map(([name, rows, rowBytes]) => ({
    name,
    approx_rows: rows.length,
    bytes: 16384 + rows.length * rowBytes,
    size: human(16384 + rows.length * rowBytes),
  }));
}

function statsPayload() {
  const msgs = db.messages;
  const delivered = msgs.filter((m) => /delivered/i.test(m.status)).length;
  const attempted = msgs.filter((m) => !/queued|cancelled/i.test(m.status)).length;
  const verifiedDomains = db.domains.filter((m) => /verified/i.test(m.status)).length;
  const activeKeys = db.api_keys.filter((k) => /active/i.test(k.status)).length;

  const days = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
    days.push({
      day,
      messages: msgs.filter((m) => (m.created_at || "").slice(0, 10) === day).length,
      audits: db.audit.filter((a) => (a.created_at || "").slice(0, 10) === day).length,
    });
  }

  const byKey = (rows, key) => {
    const map = new Map();
    for (const r of rows) {
      const k = String(r[key] || "unknown").toLowerCase();
      map.set(k, (map.get(k) || 0) + 1);
    }
    return map;
  };

  const tables = tableMeta();
  const dbBytes = tables.reduce((s, t) => s + t.bytes, 0);

  return {
    ok: true,
    checkedAt: nowIso(),
    counts: {
      users: db.users.length,
      active: db.users.filter((u) => u.status === "active").length,
      users_active: db.users.filter((u) => u.status === "active").length,
      workspaces: db.workspaces.length,
      domains: db.domains.length,
      domains_verified: verifiedDomains,
      domains_pending: db.domains.length - verifiedDomains,
      api_keys: db.api_keys.length,
      api_keys_active: activeKeys,
      api_keys_revoked: db.api_keys.filter((k) => /revoked/i.test(k.status)).length,
      api: db.api_keys.length,
      messages: msgs.length,
      messages_queued: msgs.filter((m) => /queued/i.test(m.status)).length,
      messages_delivered: delivered,
      suppressions: db.suppressions.length,
      audit_events: db.audit.length,
      rights_open: db.rights.filter((r) => !/completed|rejected|cancelled/i.test(r.status)).length,
      sessions: db.sessions.length,
      active_sessions: db.sessions.length,
      contacts: db.contacts.length,
      templates: db.templates.length,
      campaigns: db.campaigns.length,
      webhooks: db.webhooks.length,
    },
    rates: {
      deliveryRate: attempted ? Number(((delivered / attempted) * 100).toFixed(1)) : 0,
      domainVerifiedPct: db.domains.length ? Math.round((verifiedDomains / db.domains.length) * 100) : 0,
      keysActivePct: db.api_keys.length ? Math.round((activeKeys / db.api_keys.length) * 100) : 0,
    },
    charts: {
      activity7d: days,
      messagesByStatus: [...byKey(msgs, "status")].map(([status, n]) => ({ status, n })),
      messagesByStream: [...byKey(msgs, "stream")].map(([stream, n]) => ({ stream, n })),
      usersByRole: [...byKey(db.users, "role")].map(([role, n]) => ({ role, n })),
      tableSizes: tables.map((t) => ({ name: t.name, bytes: t.bytes, size: t.size })),
    },
    postgres: {
      version: "PostgreSQL 16.3 (Senditto dev simulator)",
      shortVersion: "16.3",
      databaseSize: human(dbBytes),
      databaseBytes: dbBytes,
      activeConnections: 3 + (db.sessions.length % 5),
      idleConnections: 2,
      maxConnections: 100,
      activeQueries: 1,
      waitingQueries: 0,
      cacheHitRatio: 0.993,
      uptimeSeconds: Math.floor((Date.now() - START_TS) / 1000),
      startedAt: new Date(START_TS).toISOString(),
      timezone: "UTC",
    },
    server: { name: "Senditto product (dev)", database: "senditto", user: "senditto_app" },
    health: { status: "healthy", checkedAt: nowIso() },
    tables,
  };
}

/* ============================ audit helper ============================ */

function logAudit(level, event, message, category, extra = {}) {
  const row = {
    id: uid("aud"),
    level,
    event,
    message,
    category,
    workspace_id: extra.workspace_id || null,
    owner_email: extra.owner_email || null,
    meta: extra.meta || {},
    created_at: nowIso(),
  };
  db.audit.unshift(row);
  db.audit = db.audit.slice(0, 2000);
  broadcast({ type: "audit", event, level, message });
  return row;
}

function wsName(id) {
  return db.workspaces.find((w) => String(w.id) === String(id))?.name || null;
}

/* ============================ http plumbing ============================ */

function send(res, code, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

async function readBody(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/* Generic collection CRUD wiring: [urlName, dbKey, idPrefix, label] */
const COLLECTIONS = {
  users: ["users", "usr"],
  workspaces: ["workspaces", "ws"],
  domains: ["domains", "dom"],
  keys: ["api_keys", "key"],
  messages: ["messages", "msg"],
  suppressions: ["suppressions", "sup"],
  rights: ["rights", "rr"],
  contacts: ["contacts", "ct"],
  templates: ["templates", "tpl"],
  campaigns: ["campaigns", "cmp"],
  webhooks: ["webhooks", "wh"],
  "internal-messages": ["internal_messages", "im"],
  "message-events": ["message_events", "mev"],
};

/** Roles that operate Senditto itself, as opposed to product customers. */
const STAFF_ROLES = ["owner", "admin", "operator", "support"];

/**
 * What the AI Brain is allowed to reason about: platform-wide figures, no
 * message bodies and no recipient addresses.
 */
function platformSnapshot() {
  const byStatus = (rows, field = "status") =>
    rows.reduce((acc, r) => {
      const k = String(r[field] || "unknown").toLowerCase();
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
  const dayAgo = Date.now() - 86400000;
  const weekAgo = Date.now() - 7 * 86400000;
  return {
    at: nowIso(),
    accounts: {
      total: db.users.length,
      byRole: byStatus(db.users, "role"),
      newThisWeek: db.users.filter((u) => new Date(u.created_at).getTime() > weekAgo).length,
    },
    workspaces: { total: db.workspaces.length, byStatus: byStatus(db.workspaces) },
    domains: {
      total: db.domains.length,
      verified: db.domains.filter((d) => d.status === "verified").length,
      spfOk: db.domains.filter((d) => d.spf).length,
      dkimOk: db.domains.filter((d) => d.dkim).length,
      dmarcOk: db.domains.filter((d) => d.dmarc).length,
    },
    sending: {
      total: db.messages.length,
      last24h: db.messages.filter((m) => new Date(m.created_at).getTime() > dayAgo).length,
      byStatus: byStatus(db.messages),
      byStream: byStatus(db.messages, "stream"),
      deliveredRate: rate(db.messages, (m) => m.status === "delivered"),
      bounceRate: rate(db.messages, (m) => m.status === "bounced"),
    },
    audience: { contacts: db.contacts.length, byStatus: byStatus(db.contacts) },
    campaigns: { total: db.campaigns.length, byStatus: byStatus(db.campaigns) },
    suppressions: { total: db.suppressions.length, byReason: byStatus(db.suppressions, "reason") },
    delivery: { mailerConfigured: mailerReady(), encryptionAtRest: encryptionReady() },
  };
}

const rate = (rows, test) =>
  rows.length ? Math.round((rows.filter(test).length / rows.length) * 1000) / 10 : 0;

/**
 * Assess a new account for abuse. A high-risk verdict flags the account for a
 * human to look at — it never disables anyone automatically, because a wrong
 * automatic block costs a real customer their business.
 */
async function screenSignup(user, workspace) {
  if (!aiStatus().configured) return;
  const verdict = await fraudScore({
    kind: "signup",
    email: user.email,
    displayName: user.display_name,
    company: user.company,
    workspaceName: workspace?.name,
    createdAt: user.created_at,
    accountsFromSameDomain: db.users.filter(
      (u) => u.email.split("@")[1] === user.email.split("@")[1]
    ).length,
  });
  user.risk = { ...verdict, checkedAt: nowIso() };
  const level = verdict.recommendation === "allow" ? "info" : "warn";
  logAudit(level, "fraud.signup", `${user.email} screened: ${verdict.risk} risk (${verdict.recommendation}) — ${verdict.reason}`, "security");
  broadcast({ type: "change", collection: "users", event: "updated", id: user.id, row: publicUser(user) });
  saveDb();
}

/**
 * What the customer assistant may see: this account's own workspace only,
 * summarised — never another customer's rows, never message bodies.
 */
function workspaceSummary(me, workspaceId) {
  const mine = db.workspaces.filter(
    (w) => w.owner_user_id === me.id || w.owner_email === me.email
  );
  const ws = workspaceId ? mine.find((w) => w.id === workspaceId) : mine[0];
  if (!ws) return { workspace: null, note: "This account has no workspace yet." };
  const scoped = (rows) => rows.filter((r) => r.workspace_id === ws.id);
  const contacts = scoped(db.contacts);
  const messages = scoped(db.messages);
  return {
    workspace: { name: ws.name, type: ws.type, created: ws.created_at },
    domains: scoped(db.domains).map((d) => ({
      domain: d.domain,
      status: d.status,
      spf: d.spf,
      dkim: d.dkim,
      dmarc: d.dmarc,
    })),
    contacts: {
      total: contacts.length,
      subscribed: contacts.filter((c) => /^subscribed$/i.test(String(c.status || "").trim())).length,
      unsubscribed: contacts.filter((c) => /^unsubscribed$/i.test(String(c.status || "").trim())).length,
    },
    templates: scoped(db.templates).map((t) => ({ name: t.name, subject: decrypt(t.subject) })),
    campaigns: scoped(db.campaigns).map((c) => ({ name: c.name, status: c.status, sent: c.sent })),
    sending: {
      total: messages.length,
      byStatus: messages.reduce((a, m) => ({ ...a, [m.status]: (a[m.status] || 0) + 1 }), {}),
      deliveredRate: rate(messages, (m) => m.status === "delivered"),
      bounceRate: rate(messages, (m) => m.status === "bounced"),
    },
    suppressions: scoped(db.suppressions).length,
  };
}

/** May this account act inside this workspace? Staff may act anywhere. */
function canUseWorkspace(me, workspaceId) {
  if (STAFF_ROLES.includes(me.role)) return true;
  if (!workspaceId) return false;
  return db.workspaces.some(
    (w) => w.id === workspaceId && (w.owner_user_id === me.id || w.owner_email === me.email)
  );
}
/** Collections a product customer must never reach. */
const STAFF_ONLY_COLLECTIONS = new Set(["users", "rights", "internal-messages"]);

/* ============================ request handler ============================ */

async function handle(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  // CORS — dev only, allow any localhost origin
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Senditto-Client");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  /* ---------- public ---------- */
  /* ---------- open & click tracking (public: these are hit from inboxes) ---------- */

  const trackOpen = path.match(/^\/t\/o\/([\w-]+)\.gif$/);
  if (trackOpen) {
    const row = db.messages.find((m) => m.id === trackOpen[1]);
    if (row) {
      row.opens = (row.opens || 0) + 1;
      row.updated_at = nowIso();
      sender.record(row, "opened", { text: req.headers["user-agent"] || null });
      broadcast({ type: "change", collection: "messages", event: "updated", id: row.id, row: publicMessage(row) });
      sender.fireWebhooks(row, "message.opened");
      saveDb();
    }
    // A 1x1 transparent GIF, never cached, so every open is counted.
    const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": gif.length,
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    });
    res.end(gif);
    return;
  }

  const trackClick = path.match(/^\/t\/c\/([\w-]+)$/);
  if (trackClick) {
    const target = url.searchParams.get("u") || "";
    const row = db.messages.find((m) => m.id === trackClick[1]);
    // Only ever forward to a normal web address — a tracking link must not
    // become a way to bounce someone to javascript: or data:.
    let safe = null;
    try {
      const parsed = new URL(target);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") safe = parsed.toString();
    } catch {
      safe = null;
    }
    if (row && safe) {
      row.clicks = (row.clicks || 0) + 1;
      row.updated_at = nowIso();
      sender.record(row, "clicked", { text: safe });
      broadcast({ type: "change", collection: "messages", event: "updated", id: row.id, row: publicMessage(row) });
      sender.fireWebhooks(row, "message.clicked");
      saveDb();
    }
    res.writeHead(302, { Location: safe || process.env.PUBLIC_BASE_URL || "https://senditto.dev", "Cache-Control": "no-store" });
    res.end();
    return;
  }

  if (path === "/api/health") {
    send(res, 200, { ok: true, latencyMs: 1 + Math.floor(Math.random() * 4), at: nowIso() });
    return;
  }

  /* Public sign-up for the product. Creates a real customer account plus the
     workspace it starts with. Staff roles can never be self-assigned here. */
  if (path === "/api/auth/register" && method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase().trim();
    const password = String(body.password || "");
    const name = String(body.name || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      send(res, 422, { error: "Enter a valid email address." });
      return;
    }
    if (password.length < 8) {
      send(res, 422, { error: "Password must be at least 8 characters." });
      return;
    }
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      send(res, 409, { error: "An account with this email already exists." });
      return;
    }
    const user = {
      id: uid("usr"),
      email,
      display_name: name || email.split("@")[0],
      role: "developer",
      status: "active",
      phone: "",
      company: String(body.company || "").trim(),
      country: "",
      two_factor_enabled: false,
      password: hashPassword(password),
      created_at: nowIso(),
      last_seen: nowIso(),
    };
    db.users.push(user);
    const ws = {
      id: uid("ws"),
      name: user.company || `${user.display_name}'s workspace`,
      type: String(body.workspaceType || "Developer"),
      region: "eu-west",
      timezone: "Europe/Berlin",
      status: "Active",
      owner_user_id: user.id,
      owner_email: user.email,
      owner_display_name: user.display_name,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    db.workspaces.push(ws);
    const token = randomBytes(24).toString("hex");
    db.sessions.push({
      id: uid("ses"),
      token,
      user_id: user.id,
      email: user.email,
      role: user.role,
      purpose: String(body.purpose || "platform"),
      created_at: nowIso(),
      last_seen_at: nowIso(),
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    });
    logAudit("success", "auth.register", `${user.email} created an account`, "security");
    // Screen the new account in the background: never make signup wait on it,
    // and never block an account on an assessment that failed to run.
    screenSignup(user, ws).catch(() => {});
    broadcast({ type: "change", collection: "users", event: "created", id: user.id, row: publicUser(user) });
    broadcast({ type: "change", collection: "workspaces", event: "created", id: ws.id, row: ws });
    saveDb();
    send(res, 201, { token, expiresAt: db.sessions[db.sessions.length - 1].expires_at, user: publicUser(user) });
    return;
  }

  if (path === "/api/auth/login" && method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase().trim();
    const user = db.users.find((u) => u.email.toLowerCase() === email);
    if (!user || !verifyPassword(body.password || "", user.password)) {
      send(res, 401, { error: "Invalid email or password" });
      return;
    }
    if (user.status !== "active") {
      send(res, 403, { error: "Account is disabled" });
      return;
    }
    const token = randomBytes(24).toString("hex");
    const session = {
      id: uid("ses"),
      token,
      user_id: user.id,
      email: user.email,
      role: user.role,
      purpose: String(body.purpose || "studio"),
      created_at: nowIso(),
      last_seen_at: nowIso(),
      expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString(),
    };
    db.sessions.push(session);
    user.last_seen = nowIso();
    logAudit("success", "auth.login", `${user.email} signed in (${session.purpose})`, "security");
    broadcast({ type: "change", collection: "sessions", event: "created", id: session.id });
    saveDb();
    send(res, 200, { token, expiresAt: session.expires_at, user: publicUser(user) });
    return;
  }

  /* ---------- everything below requires auth ---------- */
  const session = sessionFor(req);
  if (!session) {
    send(res, 401, { error: "Unauthorized" });
    return;
  }
  const me = userOf(session);

  if (path === "/api/auth/logout" && method === "POST") {
    db.sessions = db.sessions.filter((s) => s.token !== session.token);
    broadcast({ type: "change", collection: "sessions", event: "deleted", id: session.id });
    saveDb();
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/api/auth/2fa/setup" && method === "POST") {
    send(res, 200, { twoFactorSecret: randomBytes(10).toString("hex").toUpperCase() });
    return;
  }

  /**
   * Who am I, and how long is this session good for? Reaching this endpoint
   * has already rolled the expiry forward, so the caller can refresh its own
   * cookie to match and stay signed in.
   */
  if (path === "/api/auth/session") {
    send(res, 200, {
      user: { ...publicUser(me), displayName: me.display_name },
      expiresAt: session.expires_at,
      purpose: session.purpose,
    });
    return;
  }

  /** The full life of one message: every step, in order. */
  if (path.match(/^\/api\/messages\/[^/]+\/events$/)) {
    const messageId = path.split("/")[3];
    const row = db.messages.find((m) => m.id === messageId);
    if (!row) {
      send(res, 404, { error: "Message not found" });
      return;
    }
    if (!canUseWorkspace(me, row.workspace_id)) {
      send(res, 403, { error: "That message is not yours" });
      return;
    }
    const events = (db.message_events || [])
      .filter((e) => e.message_id === messageId)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    send(res, 200, { message: publicMessage(row), events });
    return;
  }

  if (path === "/api/stats") {
    send(res, 200, statsPayload());
    return;
  }

  /* ---------------- AI ---------------- */

  if (path === "/api/ai/status") {
    send(res, 200, { ...aiStatus(), brainAccess: ["owner", "admin"].includes(me.role) });
    return;
  }

  /** The Brain is for the people who run Senditto, and nobody else. */
  if (path === "/api/ai/brain" && method === "POST") {
    if (!["owner", "admin"].includes(me.role)) {
      send(res, 403, { error: "The AI Brain is available to the owner and admins only" });
      return;
    }
    const body = await readBody(req);
    const question = String(body.question || "").trim();
    if (!question) {
      send(res, 422, { error: "Ask a question first" });
      return;
    }
    try {
      const result = await brainAsk({ question, snapshot: platformSnapshot() });
      logAudit("info", "ai.brain", `${me.email} asked the AI Brain a question`, "ai");
      saveDb();
      send(res, 200, result);
    } catch (err) {
      send(res, err.code || 502, { error: err.message });
    }
    return;
  }

  /** The customer assistant sees only the caller's own workspace. */
  if (path === "/api/ai/assistant" && method === "POST") {
    const body = await readBody(req);
    const question = String(body.question || "").trim();
    if (!question) {
      send(res, 422, { error: "Ask a question first" });
      return;
    }
    const workspaceId = body.workspaceId || body.workspace_id || null;
    if (workspaceId && !canUseWorkspace(me, workspaceId)) {
      send(res, 403, { error: "That workspace is not yours" });
      return;
    }
    try {
      const result = await assistantAsk({ question, workspace: workspaceSummary(me, workspaceId) });
      send(res, 200, result);
    } catch (err) {
      send(res, err.code || 502, { error: err.message });
    }
    return;
  }

  /** Re-run the abuse check on an account or a message, on demand. */
  if (path === "/api/ai/fraud-check" && method === "POST") {
    if (!STAFF_ROLES.includes(me.role)) {
      send(res, 403, { error: "Fraud review is for staff only" });
      return;
    }
    const body = await readBody(req);
    try {
      send(res, 200, await fraudScore(body.subject || body));
    } catch (err) {
      send(res, err.code || 502, { error: err.message });
    }
    return;
  }

  /* ---------------- sending setup (DNS + keys) ---------------- */

  /**
   * Everything an operator needs to get a domain sending: the exact records to
   * publish and whether each one is live in public DNS right now.
   */
  if (path === "/api/sending/setup") {
    if (!STAFF_ROLES.includes(me.role)) {
      send(res, 403, { error: "Sending setup is for staff only" });
      return;
    }
    const info = dkimInfo();
    const domain = url.searchParams.get("domain") || info.domain || db.domains[0]?.domain || "";
    const spfInclude = db.meta.spfInclude || process.env.SPF_INCLUDE || "";
    const live = domain ? await verifyDomain(domain, { selector: info.selector, spfInclude }) : null;
    send(res, 200, {
      domain,
      dkim: {
        ...info,
        record: dkimPublicRecord(),
        rotatedAt: db.meta.dkimRotatedAt || null,
      },
      spfInclude,
      records: domain
        ? [
            {
              id: "dkim",
              type: "TXT",
              name: `${info.selector}._domainkey`,
              value: dkimPublicRecord() || "",
              purpose: "Proves the mail really came from you. Required.",
              published: live?.dkim?.ok || false,
              detail: live?.dkim?.reason,
            },
            {
              id: "spf",
              type: "TXT",
              name: "@",
              value: `v=spf1 ${spfInclude ? `include:${spfInclude} ` : ""}~all`,
              purpose: "Authorises your sending host. Required.",
              published: live?.spf?.ok || false,
              detail: live?.spf?.reason,
              needsInput: !spfInclude,
            },
            {
              id: "dmarc",
              type: "TXT",
              name: "_dmarc",
              value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`,
              purpose: "Tells inboxes what to do with mail that fails. Start at p=none, then tighten.",
              published: live?.dmarc?.ok || false,
              detail: live?.dmarc?.reason,
            },
          ]
        : [],
      verified: live?.ok || false,
      checkedAt: live?.checkedAt || null,
      mailer: mailerStatus(),
    });
    return;
  }

  /** Record which provider's SPF to include, so the record is complete. */
  if (path === "/api/sending/spf" && method === "POST") {
    if (!["owner", "admin"].includes(me.role)) {
      send(res, 403, { error: "Only an owner or admin can change sending setup" });
      return;
    }
    const body = await readBody(req);
    db.meta.spfInclude = String(body.include || "").trim().replace(/^include:/, "");
    logAudit("info", "sending.spf", `${me.email} set the SPF include to ${db.meta.spfInclude || "(none)"}`, "domains");
    saveDb();
    send(res, 200, { spfInclude: db.meta.spfInclude });
    return;
  }

  /**
   * Rotate the DKIM signing key. The new private key is stored encrypted and
   * used immediately; the operator publishes the new public record.
   * The old key keeps working for receivers until DNS catches up, so rotate
   * and then republish — never the other way round.
   */
  if (path === "/api/sending/dkim/rotate" && method === "POST") {
    if (!["owner", "admin"].includes(me.role)) {
      send(res, 403, { error: "Only an owner or admin can rotate the signing key" });
      return;
    }
    const body = await readBody(req);
    const info = dkimInfo();
    const domain = String(body.domain || info.domain || db.domains[0]?.domain || "").trim();
    if (!domain) {
      send(res, 422, { error: "Add a sending domain first" });
      return;
    }
    const selector = String(body.selector || `senditto${new Date().getFullYear()}`).trim();
    const pair = generateDkimKeypair();
    db.meta.dkim = {
      domain,
      selector,
      privateKey: encryptIfPossible(pair.privateKey),
      createdAt: nowIso(),
    };
    db.meta.dkimRotatedAt = nowIso();
    configureDkim({ domain, selector, privateKey: pair.privateKey });
    logAudit("warn", "sending.dkim.rotate", `${me.email} rotated the DKIM key (selector ${selector})`, "security");
    saveDb();
    send(res, 200, {
      domain,
      selector,
      host: `${selector}._domainkey.${domain}`,
      record: `v=DKIM1; k=rsa; p=${pair.publicKeyBase64}`,
      rotatedAt: db.meta.dkimRotatedAt,
      note: "Publish this record, then press Check. Mail is already being signed with the new key.",
    });
    return;
  }

  /* ---------------- sending ---------------- */

  /** What the delivery pipeline is capable of right now. */
  if (path === "/api/send/status") {
    send(res, 200, {
      mailer: mailerStatus(),
      encryptionAtRest: encryptionReady(),
      streams: Object.entries(STREAMS).map(([id, s]) => ({ id, ...s })),
      queued: db.messages.filter((m) => m.status === "queued").length,
    });
    return;
  }

  /** Send one message: transactional, notification or marketing. */
  if (path === "/api/send" && method === "POST") {
    const body = await readBody(req);
    const workspaceId = body.workspaceId || body.workspace_id || null;
    if (!canUseWorkspace(me, workspaceId)) {
      send(res, 403, { error: "That workspace is not yours" });
      return;
    }
    if (!mailerReady()) {
      send(res, 503, {
        error: "Email delivery is not configured yet. Set SMTP_HOST and SMTP_FROM on the server.",
      });
      return;
    }
    const result = sender.enqueue({
      workspaceId,
      stream: body.stream || "transactional",
      from: body.from,
      to: body.to,
      subject: body.subject,
      text: body.text,
      html: body.html,
      replyTo: body.replyTo,
      meta: { sentBy: me.email },
    });
    if (result.error) {
      send(res, result.code || 422, { error: result.error });
      return;
    }
    send(res, 202, { message: publicMessage(result.row) });
    return;
  }

  /** Issue a one-time passcode by email. The code is never stored in clear. */
  if (path === "/api/otp/send" && method === "POST") {
    const body = await readBody(req);
    const workspaceId = body.workspaceId || body.workspace_id || null;
    if (!canUseWorkspace(me, workspaceId)) {
      send(res, 403, { error: "That workspace is not yours" });
      return;
    }
    if (!mailerReady()) {
      send(res, 503, { error: "Email delivery is not configured yet." });
      return;
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const ttl = STREAMS.otp.ttlMinutes;
    const purpose = String(body.purpose || "sign-in");
    const result = sender.enqueue({
      workspaceId,
      stream: "otp",
      from: body.from,
      to: body.to,
      subject: `Your ${purpose} code: ${code}`,
      text: `Your Senditto ${purpose} code is ${code}. It expires in ${ttl} minutes. If you did not request it, ignore this email.`,
      html: `<p>Your Senditto ${purpose} code is</p><p style="font:600 28px/1.2 system-ui;letter-spacing:.16em">${code}</p><p>It expires in ${ttl} minutes. If you did not request it, ignore this email.</p>`,
      meta: { purpose },
    });
    if (result.error) {
      send(res, result.code || 422, { error: result.error });
      return;
    }
    db.otp_codes = db.otp_codes || [];
    db.otp_codes.push({
      id: uid("otp"),
      workspace_id: workspaceId,
      email: encryptIfPossible(String(body.to).toLowerCase()),
      email_hint: hint(String(body.to).toLowerCase()),
      code_hash: hashSecret(code),
      purpose,
      consumed: false,
      attempts: 0,
      created_at: nowIso(),
      expires_at: new Date(Date.now() + ttl * 60000).toISOString(),
    });
    saveDb();
    // The code itself is returned to nobody: it only exists in the email.
    send(res, 202, { messageId: result.row.id, expiresAt: db.otp_codes.at(-1).expires_at });
    return;
  }

  /** Check a passcode. Wrong or expired codes are rejected and counted. */
  if (path === "/api/otp/verify" && method === "POST") {
    const body = await readBody(req);
    const email = String(body.email || "").toLowerCase();
    db.otp_codes = db.otp_codes || [];
    const entry = [...db.otp_codes]
      .reverse()
      .find((o) => !o.consumed && decrypt(o.email) === email && o.purpose === String(body.purpose || "sign-in"));
    if (!entry) {
      send(res, 404, { error: "No code was issued for that address" });
      return;
    }
    if (new Date(entry.expires_at).getTime() < Date.now()) {
      send(res, 410, { error: "That code has expired" });
      return;
    }
    entry.attempts += 1;
    if (entry.attempts > 5) {
      entry.consumed = true;
      saveDb();
      send(res, 429, { error: "Too many attempts — request a new code" });
      return;
    }
    if (!verifySecret(String(body.code || ""), entry.code_hash)) {
      saveDb();
      send(res, 401, { error: "That code is not correct" });
      return;
    }
    entry.consumed = true;
    entry.consumed_at = nowIso();
    logAudit("success", "otp.verified", `Passcode verified for ${entry.email_hint}`, "security");
    saveDb();
    send(res, 200, { ok: true });
    return;
  }

  /** Send a campaign to every subscribed contact in its workspace. */
  if (path.match(/^\/api\/campaigns\/[^/]+\/send$/) && method === "POST") {
    const campaign = db.campaigns.find((c) => c.id === path.split("/")[3]);
    if (!campaign) {
      send(res, 404, { error: "Campaign not found" });
      return;
    }
    if (!canUseWorkspace(me, campaign.workspace_id)) {
      send(res, 403, { error: "That campaign is not yours" });
      return;
    }
    if (!mailerReady()) {
      send(res, 503, { error: "Email delivery is not configured yet." });
      return;
    }
    // Exactly "subscribed" — "Unsubscribed" also contains the word, and
    // mailing those people would break both the law and their trust.
    const audience = db.contacts.filter(
      (c) => c.workspace_id === campaign.workspace_id && /^subscribed$/i.test(String(c.status || "").trim())
    );
    let queued = 0;
    const skipped = [];
    for (const contact of audience) {
      const result = sender.enqueue({
        workspaceId: campaign.workspace_id,
        stream: "marketing",
        from: campaign.from_email,
        to: decrypt(contact.email),
        subject: campaign.subject || campaign.name,
        html: campaign.body || `<p>${campaign.subject || campaign.name}</p>`,
        text: campaign.body_text || campaign.subject || campaign.name,
        meta: { campaignId: campaign.id },
      });
      if (result.error) skipped.push({ to: hint(decrypt(contact.email)), reason: result.error });
      else queued++;
    }
    campaign.status = queued ? "Sending" : campaign.status;
    campaign.sent = (campaign.sent || 0) + queued;
    campaign.updated_at = nowIso();
    logAudit("info", "campaign.send", `${me.email} sent “${campaign.name}” to ${queued} contacts`, "campaigns", {
      workspace_id: campaign.workspace_id,
    });
    broadcast({ type: "change", collection: "campaigns", event: "updated", id: campaign.id, row: campaign });
    saveDb();
    send(res, 202, { queued, skipped, audience: audience.length });
    return;
  }

  /** Verify a domain against real public DNS. */
  if (path.match(/^\/api\/domains\/[^/]+\/verify$/) && method === "POST") {
    const domain = db.domains.find((d) => d.id === path.split("/")[3]);
    if (!domain) {
      send(res, 404, { error: "Domain not found" });
      return;
    }
    if (!canUseWorkspace(me, domain.workspace_id)) {
      send(res, 403, { error: "That domain is not yours" });
      return;
    }
    const result = await verifyDomain(domain.domain, {
      selector: process.env.DKIM_SELECTOR || "senditto",
      spfInclude: process.env.SPF_INCLUDE || "",
    });
    domain.spf = result.spf?.ok || false;
    domain.dkim = result.dkim?.ok || false;
    domain.dmarc = result.dmarc?.ok || false;
    domain.status = result.status || "pending";
    domain.last_check = result.checkedAt;
    domain.check_detail = {
      spf: result.spf?.reason,
      dkim: result.dkim?.reason,
      dmarc: result.dmarc?.reason,
      mx: result.mx?.reason,
    };
    domain.updated_at = nowIso();
    logAudit(result.ok ? "success" : "warn", "domain.verify", `${domain.domain} checked: ${domain.status}`, "domains", {
      workspace_id: domain.workspace_id,
    });
    broadcast({ type: "change", collection: "domains", event: "updated", id: domain.id, row: domain });
    saveDb();
    send(res, 200, result);
    return;
  }

  /* Everything the signed-in account may see in the product UI.
     Staff roles get the full picture; a customer only ever gets their own. */
  if (path === "/api/platform/state") {
    const staff = ["owner", "admin", "operator", "support"].includes(me.role);
    const mine = db.workspaces.filter(
      (w) => staff || w.owner_user_id === me.id || w.owner_email === me.email
    );
    const wsIds = new Set(mine.map((w) => w.id));
    const scoped = (rows) => rows.filter((r) => staff || wsIds.has(r.workspace_id));
    send(res, 200, {
      at: nowIso(),
      user: { ...publicUser(me), displayName: me.display_name },
      workspaces: mine,
      domains: scoped(db.domains),
      keys: scoped(db.api_keys),
      messages: scoped(db.messages).map(publicMessage),
      messageEvents: scoped(db.message_events || []).slice(0, 1000),
      suppressions: scoped(db.suppressions).map(publicRow),
      contacts: scoped(db.contacts).map(publicRow),
      templates: scoped(db.templates),
      campaigns: scoped(db.campaigns),
      webhooks: scoped(db.webhooks),
      logs: staff ? db.audit.slice(0, 300) : [],
      stats: statsPayload(),
    });
    return;
  }

  if (path === "/api/db/realtime") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": origin,
    });
    res.write(`data: ${JSON.stringify({ type: "tick", at: nowIso() })}\n\n`);
    sseClients.add(res);
    req.on("close", () => sseClients.delete(res));
    return;
  }

  if (path.startsWith("/api/db/tables/")) {
    const name = decodeURIComponent(path.split("/").pop());
    const map = Object.fromEntries(tableMeta().map((t) => [t.name, t]));
    const rowsByTable = {
      users: db.users.map(publicUser),
      workspaces: db.workspaces,
      domains: db.domains,
      api_keys: db.api_keys,
      messages: db.messages.map(publicMessage),
      suppressions: db.suppressions.map(publicRow),
      audit_log: db.audit,
      rights_requests: db.rights,
      sessions: db.sessions.map(({ token, ...s }) => s),
      internal_messages: db.internal_messages,
      message_events: db.message_events.map(publicRow),
      contacts: db.contacts,
      templates: db.templates,
      campaigns: db.campaigns,
      webhooks: db.webhooks,
    };
    const rows = rowsByTable[name];
    if (!rows) {
      send(res, 404, { error: `Unknown table ${name}` });
      return;
    }
    const sample = rows.slice(0, 25);
    const first = sample[0] || {};
    const columns = Object.keys(first).map((k) => ({
      column_name: k,
      data_type: Array.isArray(first[k]) ? "jsonb" : typeof first[k] === "number" ? "integer" : typeof first[k] === "boolean" ? "boolean" : typeof first[k] === "object" && first[k] ? "jsonb" : /(_at|_seen)$/.test(k) ? "timestamptz" : "text",
      is_nullable: "YES",
      column_default: null,
    }));
    send(res, 200, { name, columns, rowCount: rows.length, rows: sample, size: map[name]?.size });
    return;
  }

  /* ---------- role matrices ---------- */
  if (path === "/api/roles/matrix" && method === "GET") {
    send(res, 200, {
      matrix: db.meta.roleMatrix,
      source: db.meta.roleMatrix ? "database" : "defaults",
      updatedAt: db.meta.matrixUpdatedAt,
      canEdit: me?.role === "owner",
    });
    return;
  }
  if (path === "/api/roles/matrix" && method === "PUT") {
    const body = await readBody(req);
    if (me?.role !== "owner") {
      send(res, 403, { error: "Only the owner can edit the matrix" });
      return;
    }
    if (!/^\d{6}$/.test(String(body.twoFactorCode || ""))) {
      send(res, 400, { error: "A 6-digit 2FA code is required" });
      return;
    }
    db.meta.roleMatrix = body.matrix || null;
    db.meta.matrixUpdatedAt = nowIso();
    logAudit("warn", "matrix.update", `${me.email} updated the platform role matrix`, "security");
    saveDb();
    send(res, 200, { matrix: db.meta.roleMatrix, source: "database", updatedAt: db.meta.matrixUpdatedAt, canEdit: true });
    return;
  }
  if (path === "/api/roles/matrix/reset" && method === "POST") {
    const body = await readBody(req);
    if (me?.role !== "owner") {
      send(res, 403, { error: "Only the owner can reset the matrix" });
      return;
    }
    if (!/^\d{6}$/.test(String(body.twoFactorCode || ""))) {
      send(res, 400, { error: "A 6-digit 2FA code is required" });
      return;
    }
    db.meta.roleMatrix = null;
    db.meta.matrixUpdatedAt = nowIso();
    logAudit("warn", "matrix.reset", `${me.email} restored the factory role matrix`, "security");
    saveDb();
    send(res, 200, { matrix: null, source: "defaults", updatedAt: db.meta.matrixUpdatedAt, canEdit: true });
    return;
  }
  if (path === "/api/roles/workspace-matrix" && method === "GET") {
    send(res, 200, { matrix: db.meta.workspaceMatrix, source: db.meta.workspaceMatrix ? "database" : "defaults" });
    return;
  }
  if (path === "/api/roles/workspace-matrix" && method === "PUT") {
    const body = await readBody(req);
    db.meta.workspaceMatrix = body.matrix || null;
    logAudit("warn", "matrix.workspace.update", `${me.email} updated workspace role defaults`, "security");
    saveDb();
    send(res, 200, { matrix: db.meta.workspaceMatrix });
    return;
  }
  if (path === "/api/roles/workspace-matrix/reset" && method === "POST") {
    db.meta.workspaceMatrix = null;
    logAudit("warn", "matrix.workspace.reset", `${me.email} restored workspace role defaults`, "security");
    saveDb();
    send(res, 200, { matrix: null });
    return;
  }

  /* ---------- audit ---------- */
  if (path === "/api/audit" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 500, 1000);
    send(res, 200, { rows: db.audit.slice(0, limit), total: db.audit.length });
    return;
  }

  /* ---------- sessions ---------- */
  if (path === "/api/sessions" && method === "GET") {
    send(res, 200, {
      rows: db.sessions.map(({ token, ...s }) => s),
      total: db.sessions.length,
    });
    return;
  }
  if (path.startsWith("/api/sessions/") && method === "DELETE") {
    const id = path.split("/").pop();
    const target = db.sessions.find((s) => s.id === id);
    db.sessions = db.sessions.filter((s) => s.id !== id);
    if (target) logAudit("warn", "sessions.revoke", `${me.email} revoked a session for ${target.email}`, "security");
    broadcast({ type: "change", collection: "sessions", event: "deleted", id });
    saveDb();
    send(res, 200, { ok: true });
    return;
  }

  /* ---------- special user routes ---------- */
  if (path.match(/^\/api\/users\/[^/]+\/grant-role$/) && method === "POST") {
    const id = path.split("/")[3];
    const body = await readBody(req);
    const target = db.users.find((u) => u.id === id);
    if (!target) {
      send(res, 404, { error: "User not found" });
      return;
    }
    if (me?.role !== "owner") {
      send(res, 403, { error: "Only the owner can grant elevated roles" });
      return;
    }
    if (!/^\d{6}$/.test(String(body.twoFactorCode || ""))) {
      send(res, 400, { error: "A 6-digit 2FA code is required" });
      return;
    }
    if (String(body.confirmEmail || "").toLowerCase() !== target.email.toLowerCase()) {
      send(res, 400, { error: "Confirmation email does not match" });
      return;
    }
    target.role = String(body.role || target.role);
    target.updated_at = nowIso();
    logAudit("warn", "roles.grant", `${me.email} granted ${target.role} to ${target.email}`, "security");
    broadcast({ type: "change", collection: "users", event: "updated", id: target.id, row: publicUser(target) });
    saveDb();
    send(res, 200, { row: publicUser(target) });
    return;
  }

  /* ---------- key rotation & webhook test ---------- */
  if (path.match(/^\/api\/keys\/[^/]+\/rotate$/) && method === "POST") {
    const id = path.split("/")[3];
    const key = db.api_keys.find((k) => k.id === id);
    if (!key) {
      send(res, 404, { error: "Key not found" });
      return;
    }
    const secret = `${key.key_prefix}${randomBytes(18).toString("hex")}`;
    key.last_used = null;
    key.updated_at = nowIso();
    logAudit("warn", "keys.rotate", `${me.email} rotated API key “${key.name}”`, "keys");
    broadcast({ type: "change", collection: "keys", event: "updated", id: key.id, row: key });
    saveDb();
    send(res, 200, { ...key, secret });
    return;
  }
  if (path.match(/^\/api\/webhooks\/[^/]+\/test$/) && method === "POST") {
    const id = path.split("/")[3];
    const hook = db.webhooks.find((w) => w.id === id);
    if (!hook) {
      send(res, 404, { error: "Webhook not found" });
      return;
    }
    // Actually call the endpoint and report what it answered.
    const payload = {
      event: "webhook.test",
      webhook_id: hook.id,
      workspace_id: hook.workspace_id,
      at: nowIso(),
    };
    let outcome;
    try {
      const started = Date.now();
      const r = await fetch(hook.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Senditto-Event": "webhook.test" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10000),
      });
      outcome = { ok: r.ok, status: r.status, ms: Date.now() - started };
      hook[r.ok ? "success" : "failures"] = (hook[r.ok ? "success" : "failures"] || 0) + 1;
      hook.last_status = r.status;
      hook.last_error = r.ok ? null : `Endpoint answered ${r.status}`;
    } catch (e) {
      outcome = { ok: false, status: 0, error: String(e.message || e).slice(0, 200) };
      hook.failures = (hook.failures || 0) + 1;
      hook.last_status = 0;
      hook.last_error = outcome.error;
    }
    hook.last_delivery_at = nowIso();
    hook.updated_at = nowIso();
    logAudit(outcome.ok ? "success" : "warn", "webhook.test",
      `Test to “${hook.name}” ${outcome.ok ? `succeeded (${outcome.status})` : `failed (${outcome.error || outcome.status})`}`,
      "webhooks", { workspace_id: hook.workspace_id });
    broadcast({ type: "change", collection: "webhooks", event: "updated", id: hook.id, row: hook });
    saveDb();
    send(res, outcome.ok ? 200 : 502, outcome);
    return;
  }

  /* ---------- generic collections ---------- */
  const m = path.match(/^\/api\/([a-z-]+)(?:\/([^/]+))?$/);
  if (m && COLLECTIONS[m[1]]) {
    const [dbKey, prefix] = COLLECTIONS[m[1]];
    const kind = m[1];
    const rows = db[dbKey];
    const id = m[2];

    /* Authorization. Product accounts are confined to workspaces they own;
       operator-only collections and role changes stay with staff. */
    const staff = STAFF_ROLES.includes(me.role);
    if (!staff && STAFF_ONLY_COLLECTIONS.has(kind)) {
      send(res, 403, { error: "You do not have access to this data" });
      return;
    }
    if (STAFF_ONLY_COLLECTIONS.has(kind) && !["owner", "admin"].includes(me.role) && method !== "GET") {
      send(res, 403, { error: "Only an owner or admin can change this data" });
      return;
    }
    const ownWorkspaceIds = new Set(
      db.workspaces.filter((w) => w.owner_user_id === me.id || w.owner_email === me.email).map((w) => w.id)
    );
    const mayTouch = (row) => {
      if (staff) return true;
      if (kind === "workspaces") return row.owner_user_id === me.id || row.owner_email === me.email;
      return !row.workspace_id || ownWorkspaceIds.has(row.workspace_id);
    };

    if (method === "GET" && !id) {
      const visible = staff ? rows : rows.filter(mayTouch);
      // Never hand out stored ciphertext or a full recipient address.
      const shaped = kind === "messages" ? visible.map(publicMessage) : visible.map(publicRow);
      send(res, 200, { rows: shaped, total: shaped.length });
      return;
    }

    if (!staff && (method === "PATCH" || method === "PUT" || method === "DELETE") && id) {
      const target = rows.find((r) => String(r.id) === String(id));
      if (target && !mayTouch(target)) {
        send(res, 403, { error: "This item belongs to another workspace" });
        return;
      }
    }

    if (method === "POST" && !id) {
      const body = await readBody(req);
      if (!staff && kind !== "workspaces") {
        const wsId = body.workspaceId || body.workspace_id;
        if (wsId && !ownWorkspaceIds.has(wsId)) {
          send(res, 403, { error: "This item belongs to another workspace" });
          return;
        }
      }
      const row = createRow(m[1], prefix, body, me);
      if (row.__error) {
        send(res, row.__code || 422, { error: row.__error });
        return;
      }
      rows.unshift(row.row);
      logAudit("info", `${m[1]}.create`, row.auditMsg || `${me.email} created ${m[1].slice(0, -1)}`, m[1], {
        workspace_id: row.row.workspace_id,
      });
      if (m[1] === "suppressions") broadcast({ type: "suppression", event: "created", email: row.row.email, reason: row.row.reason, id: row.row.id });
      broadcast({ type: "change", collection: m[1], event: "created", id: row.row.id, row: row.row });
      saveDb();
      send(res, 201, row.extra ? { ...row.row, ...row.extra } : { row: row.row, ...(row.topLevel || {}) });
      return;
    }

    if ((method === "PATCH" || method === "PUT") && id) {
      const body = await readBody(req);
      const row = rows.find((r) => String(r.id) === String(id));
      if (!row) {
        send(res, 404, { error: "Not found" });
        return;
      }
      patchRow(m[1], row, body);
      row.updated_at = nowIso();
      logAudit("info", `${m[1]}.update`, `${me.email} updated ${m[1].slice(0, -1)} ${row.name || row.email || row.subject || row.id}`, m[1], { workspace_id: row.workspace_id });
      broadcast({ type: "change", collection: m[1], event: "updated", id: row.id, row });
      saveDb();
      send(res, 200, { row });
      return;
    }

    if (method === "DELETE" && id) {
      const row = rows.find((r) => String(r.id) === String(id));
      if (!row) {
        send(res, 404, { error: "Not found" });
        return;
      }
      db[dbKey] = rows.filter((r) => r !== row);
      logAudit("warn", `${m[1]}.delete`, `${me.email} deleted ${m[1].slice(0, -1)} ${row.name || row.email || row.subject || row.id}`, m[1], { workspace_id: row.workspace_id });
      if (m[1] === "suppressions") broadcast({ type: "suppression", event: "deleted", email: row.email, id: row.id });
      broadcast({ type: "change", collection: m[1], event: "deleted", id: row.id, row });
      saveDb();
      send(res, 200, { ok: true });
      return;
    }
  }

  send(res, 404, { error: `No route: ${method} ${path}` });
}

/* ---------- per-entity create/patch logic ---------- */

function createRow(kind, prefix, body, me) {
  const base = { id: uid(prefix), created_at: nowIso(), updated_at: nowIso() };
  // Clients send either camelCase or snake_case; accept both so a row never
  // loses its workspace and disappears from the owner's scoped view.
  const wsId = body.workspaceId || body.workspace_id || null;
  const ws = wsId ? { workspace_id: wsId, workspace_name: wsName(wsId) } : { workspace_id: null, workspace_name: null };

  switch (kind) {
    case "users": {
      if (!body.email) return { __error: "Email is required" };
      if (db.users.some((u) => u.email.toLowerCase() === String(body.email).toLowerCase()))
        return { __error: "A user with this email already exists" };
      // Only the owner may mint elevated accounts.
      if (["owner", "admin"].includes(body.role) && me.role !== "owner")
        return { __error: "Only the owner can create owner or admin accounts", __code: 403 };
      const temporaryPassword = body.password || `tmp-${randomBytes(4).toString("hex")}`;
      return {
        row: {
          ...base,
          email: body.email,
          display_name: body.displayName || "",
          role: body.role || "viewer",
          status: "active",
          phone: "",
          company: "",
          country: "",
          two_factor_enabled: false,
          password: hashPassword(temporaryPassword),
          last_seen: null,
        },
        topLevel: body.password ? {} : { temporaryPassword },
        auditMsg: `${me.email} created user ${body.email}`,
      };
    }
    case "workspaces": {
      // Default to the signed-in account, so a workspace is never ownerless.
      const owner =
        db.users.find((u) => u.id === (body.ownerUserId || body.owner_user_id)) || me || null;
      return {
        row: {
          ...base,
          name: body.name || "Untitled workspace",
          type: body.type || "Developer",
          region: body.region || "eu-west",
          timezone: body.timezone || "UTC",
          status: body.status || "Active",
          owner_user_id: owner?.id || null,
          owner_email: owner?.email || null,
          owner_display_name: owner?.display_name || null,
        },
        auditMsg: `${me.email} created workspace “${body.name}”`,
      };
    }
    case "domains":
      if (!body.domain) return { __error: "Domain is required" };
      return {
        row: { ...base, domain: body.domain, status: "pending", spf: false, dkim: false, dmarc: false, ...ws },
        auditMsg: `${me.email} added domain ${body.domain}`,
      };
    case "keys": {
      const env = /live/i.test(body.environment || "live") ? "live" : "test";
      const secret = `sk_${env}_${randomBytes(18).toString("hex")}`;
      return {
        row: {
          ...base,
          name: body.name || "New key",
          key_prefix: `sk_${env}_`,
          environment: env,
          scopes: Array.isArray(body.scopes) && body.scopes.length ? body.scopes : ["email:send"],
          status: "active",
          last_used: null,
          ...ws,
        },
        extra: { secret },
        auditMsg: `${me.email} created API key “${body.name}”`,
      };
    }
    case "messages": {
      if (!body.to) return { __error: "Recipient is required" };
      if (body.respectSuppressions !== false) {
        const blocked = db.suppressions.find((s) => s.email.toLowerCase() === String(body.to).toLowerCase());
        if (blocked) return { __error: `Recipient is suppressed (${blocked.reason}) — respecting the block list`, __code: 422 };
      }
      return {
        row: {
          ...base,
          to_email: body.to,
          from_email: body.from || "no-reply@senditto.dev",
          subject: body.subject || "(no subject)",
          body: body.body || "",
          stream: body.stream || "Transactional",
          status: "queued",
          meta: {},
          ...ws,
        },
        auditMsg: `${me.email} queued a ${body.stream || "Transactional"} message to ${body.to}`,
      };
    }
    case "suppressions":
      if (!body.email) return { __error: "Email is required" };
      return {
        row: {
          ...base,
          email: body.email,
          reason: body.reason || "unsubscribe",
          source: body.source || "support_request",
          user_note: body.userNote || body.note || "",
          channel: body.channel || null,
          owner_email: ws.workspace_id ? db.workspaces.find((w) => w.id === ws.workspace_id)?.owner_email || null : null,
          event_at: nowIso(),
          ...ws,
        },
        auditMsg: `${me.email} recorded opt-out for ${body.email} (${body.source || "support_request"})`,
      };
    case "rights":
      return {
        row: {
          ...base,
          type: body.type || "access",
          requester_email: body.requesterEmail || "",
          requester_name: body.requesterName || "",
          subject_email: body.subjectEmail || body.requesterEmail || "",
          status: "recorded",
          description: body.description || "",
          note: body.note || "",
          due_at: body.dueAt || new Date(Date.now() + 30 * 864e5).toISOString(),
          source: body.source || "manual",
          channel: body.channel || "studio",
          status_history: [{ status: "recorded", at: nowIso() }],
          ...ws,
        },
        auditMsg: `${me.email} recorded a ${body.type || "access"} rights request`,
      };
    case "contacts":
      if (!body.email) return { __error: "Email is required" };
      return {
        row: {
          ...base,
          name: body.name || "",
          email: body.email,
          status: body.status || "Subscribed",
          tags: Array.isArray(body.tags) ? body.tags : [],
          ...ws,
        },
        auditMsg: `${me.email} added contact ${body.email}`,
      };
    case "templates":
      return {
        row: {
          ...base,
          name: body.name || "Untitled template",
          category: body.category || "Other",
          subject: body.subject || "",
          html: body.html || "",
          status: body.status || "Draft",
          usage: 0,
          ...ws,
        },
        auditMsg: `${me.email} created template “${body.name}”`,
      };
    case "campaigns":
      return {
        row: {
          ...base,
          name: body.name || "Untitled campaign",
          subject: body.subject || "",
          audience: body.audience || "",
          status: body.status || "Draft",
          sent: 0,
          opened: 0,
          clicked: 0,
          ...ws,
        },
        auditMsg: `${me.email} created campaign “${body.name}”`,
      };
    case "webhooks":
      if (!body.url) return { __error: "Endpoint URL is required" };
      return {
        row: {
          ...base,
          name: body.name || "New endpoint",
          url: body.url,
          events: Array.isArray(body.events) ? body.events : [],
          status: body.status || "Active",
          success: 0,
          failed: 0,
          ...ws,
        },
        auditMsg: `${me.email} added webhook “${body.name}”`,
      };
    case "internal-messages": {
      const target = body.toUserId ? db.users.find((u) => u.id === body.toUserId) : null;
      return {
        row: {
          ...base,
          channel: body.channel || "internal",
          to: body.to || target?.email || "",
          to_user_id: body.toUserId || target?.id || null,
          subject: body.subject || "",
          body: body.body || "",
          from: body.from || me.email,
          ...ws,
        },
        auditMsg: `${me.email} sent an operator message to ${body.to || target?.email || "user"}`,
      };
    }
    default:
      return { __error: "Unsupported" };
  }
}

function patchRow(kind, row, body) {
  const set = (k, v) => {
    if (v !== undefined) row[k] = v;
  };
  switch (kind) {
    case "users":
      set("display_name", body.displayName);
      set("status", body.status);
      set("phone", body.phone);
      set("company", body.company);
      set("country", body.country);
      if (body.twoFactorEnabled !== undefined) row.two_factor_enabled = !!body.twoFactorEnabled;
      if (body.password) row.password = hashPassword(body.password);
      break;
    case "workspaces":
      set("name", body.name);
      set("type", body.type);
      set("region", body.region);
      set("timezone", body.timezone);
      set("status", body.status);
      break;
    case "domains":
      if (body.status !== undefined) {
        row.status = body.status;
        const on = /verified/i.test(body.status);
        row.spf = on;
        row.dkim = on;
        row.dmarc = on;
      }
      set("spf", body.spf);
      set("dkim", body.dkim);
      set("dmarc", body.dmarc);
      break;
    case "keys":
      if (body.revoke) row.status = "revoked";
      if (Array.isArray(body.scopes)) row.scopes = body.scopes;
      set("name", body.name);
      set("status", body.status);
      break;
    case "messages":
      set("status", body.status);
      break;
    case "rights":
      if (body.status !== undefined && body.status !== row.status) {
        row.status = body.status;
        row.status_history = [...(row.status_history || []), { status: body.status, at: nowIso() }];
      }
      set("note", body.note);
      set("due_at", body.dueAt);
      break;
    case "contacts":
      set("name", body.name);
      set("email", body.email);
      set("status", body.status);
      if (Array.isArray(body.tags)) row.tags = body.tags;
      if (body.workspaceId !== undefined) {
        row.workspace_id = body.workspaceId || null;
        row.workspace_name = body.workspaceId ? wsName(body.workspaceId) : null;
      }
      break;
    case "templates":
      set("name", body.name);
      set("category", body.category);
      set("subject", body.subject);
      set("html", body.html);
      set("status", body.status);
      if (body.workspaceId !== undefined) {
        row.workspace_id = body.workspaceId || null;
        row.workspace_name = body.workspaceId ? wsName(body.workspaceId) : null;
      }
      break;
    case "campaigns":
      set("name", body.name);
      set("subject", body.subject);
      set("audience", body.audience);
      set("status", body.status);
      if (body.workspaceId !== undefined) {
        row.workspace_id = body.workspaceId || null;
        row.workspace_name = body.workspaceId ? wsName(body.workspaceId) : null;
      }
      break;
    case "webhooks":
      set("name", body.name);
      set("url", body.url);
      set("status", body.status);
      if (Array.isArray(body.events)) row.events = body.events;
      if (body.workspaceId !== undefined) {
        row.workspace_id = body.workspaceId || null;
        row.workspace_name = body.workspaceId ? wsName(body.workspaceId) : null;
      }
      break;
    default:
      break;
  }
}

/* ============================ boot ============================ */

loadDb();

const sender = createSender({ db, saveDb, broadcast, logAudit, uid, nowIso });
sender.start();
loadDkim();

/**
 * Use the DKIM key stored in the database, so a rotation done in the studio
 * survives a restart. The environment variable is only the bootstrap.
 */
function loadDkim() {
  const stored = db.meta?.dkim;
  if (stored?.privateKey) {
    configureDkim({
      domain: stored.domain,
      selector: stored.selector,
      privateKey: decrypt(stored.privateKey),
    });
    console.log(`DKIM signing as ${stored.selector}._domainkey.${stored.domain} (from database).`);
  }
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    try {
      send(res, 500, { error: err?.message || "Internal error" });
    } catch {
      /* socket gone */
    }
  });
}).listen(PORT, () => {
  console.log(`Senditto API → http://localhost:${PORT}`);
  if (SEED_DEMO && OWNER_PASSWORD === "senditto-owner") {
    console.log(`Studio login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}  (DEV ONLY)`);
  } else {
    console.log(`Studio owner: ${OWNER_EMAIL} (password from environment, not logged)`);
  }
});
