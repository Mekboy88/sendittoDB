/**
 * Senditto mail delivery.
 *
 * A real SMTP client — no library, no simulation. It opens a socket to the
 * configured relay, upgrades to TLS, authenticates, and delivers the message.
 * If the relay refuses, the failure is reported; nothing is ever marked
 * delivered unless the receiving server accepted it.
 *
 * Security posture:
 *   • TLS is mandatory. Implicit TLS on 465, STARTTLS elsewhere. A relay that
 *     cannot offer STARTTLS is refused rather than downgraded to plaintext.
 *   • Certificates are verified by default; only an explicit
 *     SMTP_ALLOW_SELF_SIGNED=1 relaxes that, for a private relay.
 *   • Messages are DKIM-signed (RSA-SHA256, relaxed/relaxed) when a private
 *     key is configured, so receivers can prove the mail is really ours.
 *   • Headers are sanitised, so no address or subject can inject its own
 *     headers into the message.
 *
 * Configuration (environment):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *   DKIM_DOMAIN, DKIM_SELECTOR, DKIM_PRIVATE_KEY (PEM, \n escaped is fine)
 */
import net from "node:net";
import tls from "node:tls";
import { createSign, createPublicKey, randomBytes, createHash, generateKeyPairSync } from "node:crypto";

/**
 * DKIM keys live in the database so an operator can rotate them from the
 * studio without a restart. The environment is only the bootstrap: whatever
 * is configured here wins once loaded.
 */
let dkimOverride = null;

export function configureDkim(key) {
  dkimOverride = key && key.privateKey ? { ...key } : null;
}

/** Make a fresh signing keypair. The private half never leaves the server. */
export function generateDkimKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey, publicKeyBase64: pemBody(publicKey) };
}

/** The base64 body of a PEM, which is what a DNS record carries. */
export function pemBody(pem) {
  return String(pem)
    .split("\n")
    .filter((l) => l && !l.startsWith("-----"))
    .join("");
}

const cfg = () => ({
  host: process.env.SMTP_HOST || "",
  port: Number(process.env.SMTP_PORT || 587),
  user: process.env.SMTP_USER || "",
  pass: process.env.SMTP_PASS || "",
  from: process.env.SMTP_FROM || "",
  // Implicit TLS (the whole session encrypted from the first byte). Standard
  // on 465; SMTP_SECURE forces it on any port.
  secure: process.env.SMTP_SECURE === "1" || Number(process.env.SMTP_PORT || 587) === 465,
  allowSelfSigned: process.env.SMTP_ALLOW_SELF_SIGNED === "1",
  dkim: dkimOverride
    ? {
        domain: dkimOverride.domain || process.env.DKIM_DOMAIN || "",
        selector: dkimOverride.selector || "senditto",
        key: dkimOverride.privateKey,
      }
    : {
        domain: process.env.DKIM_DOMAIN || "",
        selector: process.env.DKIM_SELECTOR || "senditto",
        key: (process.env.DKIM_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      },
});

/**
 * Is the configured key actually usable? A present-but-unparseable key is
 * worse than none: mail goes out unsigned while the studio reports it signed.
 * (systemd's EnvironmentFile strips backslashes, which silently corrupts a
 * PEM passed through the environment — hence checking, not just presence.)
 */
export function dkimUsable() {
  const c = cfg();
  if (!c.dkim.domain || !c.dkim.key) return false;
  try {
    createPublicKey(c.dkim.key);
    return true;
  } catch {
    return false;
  }
}

/** What the operator needs to publish, and what we are signing with. */
export function dkimInfo() {
  const c = cfg();
  const usable = dkimUsable();
  return {
    domain: c.dkim.domain,
    selector: c.dkim.selector,
    active: usable,
    keyPresent: Boolean(c.dkim.key),
    problem: c.dkim.key && !usable ? "The stored signing key is not readable — rotate it." : null,
    host: c.dkim.domain ? `${c.dkim.selector}._domainkey.${c.dkim.domain}` : null,
  };
}

/** Derive the public half from the stored private key. */
export function dkimPublicRecord() {
  const c = cfg();
  if (!c.dkim.key) return null;
  try {
    const pub = createPublicKey(c.dkim.key).export({ type: "spki", format: "pem" });
    return `v=DKIM1; k=rsa; p=${pemBody(pub)}`;
  } catch {
    return null;
  }
}

export function mailerReady() {
  const c = cfg();
  return Boolean(c.host && c.from);
}

export function mailerStatus() {
  const c = cfg();
  return {
    configured: mailerReady(),
    host: c.host ? "configured" : "missing",
    auth: c.user ? "configured" : "none",
    from: c.from || "",
    tls: c.secure ? "implicit" : "starttls",
    dkim: dkimUsable() ? `${c.dkim.selector}._domainkey.${c.dkim.domain}` : "not signed",
  };
}

/* ----------------------------- header safety ----------------------------- */

/** Strip CR/LF so a value can never inject extra headers. */
const clean = (v) => String(v ?? "").replace(/[\r\n]+/g, " ").trim();

/** Encode a header value that may contain non-ASCII (RFC 2047). */
function encodeHeader(value) {
  const v = clean(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function formatAddress(input) {
  const raw = clean(input);
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return `${encodeHeader(m[1])} <${clean(m[2])}>`;
  return raw;
}

export function addressOnly(input) {
  const raw = clean(input);
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

export function isValidEmail(value) {
  return /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(addressOnly(value));
}

/* --------------------------------- DKIM --------------------------------- */

function canonicalizeHeaderRelaxed(name, value) {
  return `${name.toLowerCase()}:${String(value).replace(/\s+/g, " ").trim()}\r\n`;
}

function canonicalizeBodyRelaxed(body) {
  let b = body.replace(/[ \t]+(?=\r\n)/g, "").replace(/\r\n/g, "\n");
  b = b.replace(/\n+$/, "");
  return b.replace(/\n/g, "\r\n") + "\r\n";
}

/**
 * Sign the message so receiving servers can verify it came from us.
 * Without DKIM most providers treat bulk mail as suspicious.
 */
function dkimSignature(headers, body) {
  const { domain, selector, key } = cfg().dkim;
  if (!domain || !key) return null;

  const signedNames = ["from", "to", "subject", "date", "message-id", "mime-version", "content-type"];
  const present = signedNames.filter((n) => headers.some(([k]) => k.toLowerCase() === n));

  const bodyHash = createHash("sha256").update(canonicalizeBodyRelaxed(body), "utf8").digest("base64");

  let dkimHeader =
    `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=${selector}; ` +
    `t=${Math.floor(Date.now() / 1000)}; bh=${bodyHash}; h=${present.join(":")}; b=`;

  let toSign = "";
  for (const name of present) {
    const entry = headers.find(([k]) => k.toLowerCase() === name);
    toSign += canonicalizeHeaderRelaxed(entry[0], entry[1]);
  }
  // RFC 6376 §3.7: the DKIM-Signature header is canonicalized with its own
  // b= empty and, unlike every other header, with no trailing CRLF.
  toSign += canonicalizeHeaderRelaxed("dkim-signature", dkimHeader).replace(/\r\n$/, "");

  try {
    const signer = createSign("RSA-SHA256");
    signer.update(toSign, "utf8");
    return dkimHeader + signer.sign(key, "base64");
  } catch {
    return null; // a bad key must not stop delivery being attempted
  }
}

/* ------------------------------ message build ---------------------------- */

export function buildMessage({ from, to, subject, text, html, replyTo, headers: extra = {} }) {
  const boundary = `--_senditto_${randomBytes(12).toString("hex")}`;
  const messageId = `<${randomBytes(16).toString("hex")}@${(addressOnly(from).split("@")[1] || "senditto.dev")}>`;

  const headers = [
    ["From", formatAddress(from)],
    ["To", formatAddress(to)],
    ["Subject", encodeHeader(subject)],
    ["Date", new Date().toUTCString()],
    ["Message-ID", messageId],
    ["MIME-Version", "1.0"],
  ];
  if (replyTo) headers.push(["Reply-To", formatAddress(replyTo)]);
  for (const [k, v] of Object.entries(extra)) if (v) headers.push([clean(k), clean(v)]);

  let body;
  if (html && text) {
    headers.push(["Content-Type", `multipart/alternative; boundary="${boundary}"`]);
    body =
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n${wrap64(text)}\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n` +
      `Content-Transfer-Encoding: base64\r\n\r\n${wrap64(html)}\r\n--${boundary}--\r\n`;
  } else {
    headers.push(["Content-Type", `text/${html ? "html" : "plain"}; charset=UTF-8`]);
    headers.push(["Content-Transfer-Encoding", "base64"]);
    body = wrap64(html || text || "");
  }

  const signature = dkimSignature(headers, body);
  const all = signature ? [["DKIM-Signature", signature], ...headers] : headers;
  const raw = all.map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n" + body;
  return { raw, messageId, signed: Boolean(signature) };
}

function wrap64(s) {
  return (Buffer.from(String(s), "utf8").toString("base64").match(/.{1,76}/g) || []).join("\r\n");
}

/* ------------------------------- SMTP client ------------------------------ */

function talk(socket, expectCodes, command) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk) => {
      buffer += chunk.toString("utf8");
      // A reply is complete when the last line is "NNN <space>".
      const lines = buffer.split("\r\n").filter(Boolean);
      const last = lines[lines.length - 1] || "";
      if (!/^\d{3} /.test(last)) return;
      cleanup();
      const code = Number(last.slice(0, 3));
      if (expectCodes.includes(code)) resolve({ code, text: buffer.trim() });
      else reject(new Error(`SMTP ${code}: ${last.slice(4) || buffer.trim()}`));
    };
    const onError = (e) => {
      cleanup();
      reject(e);
    };
    const timer = setTimeout(() => onError(new Error("SMTP timed out")), 30000);
    function cleanup() {
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
    }
    socket.on("data", onData);
    socket.on("error", onError);
    if (command !== undefined) socket.write(command + "\r\n");
  });
}

/**
 * Deliver one message. Resolves with the relay's acceptance, or throws with
 * the reason the relay gave — which the caller records against the message.
 */
export async function sendMail({ from, to, subject, text, html, replyTo, headers }) {
  const c = cfg();
  if (!c.host) throw new Error("SMTP is not configured");
  const sender = from || c.from;
  if (!isValidEmail(sender)) throw new Error("Sender address is invalid");
  if (!isValidEmail(to)) throw new Error("Recipient address is invalid");

  const { raw, messageId, signed } = buildMessage({ from: sender, to, subject, text, html, replyTo, headers });

  const implicitTls = c.secure;
  let socket = implicitTls
    ? tls.connect({ host: c.host, port: c.port, servername: c.host, rejectUnauthorized: !c.allowSelfSigned })
    : net.connect({ host: c.host, port: c.port });

  await new Promise((resolve, reject) => {
    socket.once(implicitTls ? "secureConnect" : "connect", resolve);
    socket.once("error", reject);
    socket.setTimeout(30000, () => reject(new Error("Connection to the mail relay timed out")));
  });

  try {
    await talk(socket, [220]);
    const ehlo = await talk(socket, [250], `EHLO ${hostname()}`);

    if (!implicitTls) {
      if (!/STARTTLS/i.test(ehlo.text)) {
        throw new Error("The mail relay does not offer STARTTLS — refusing to send unencrypted");
      }
      await talk(socket, [220], "STARTTLS");
      socket = tls.connect({
        socket,
        servername: c.host,
        rejectUnauthorized: !c.allowSelfSigned,
      });
      await new Promise((resolve, reject) => {
        socket.once("secureConnect", resolve);
        socket.once("error", reject);
      });
      await talk(socket, [250], `EHLO ${hostname()}`);
    }

    if (c.user) {
      await talk(socket, [334], "AUTH LOGIN");
      await talk(socket, [334], Buffer.from(c.user).toString("base64"));
      await talk(socket, [235], Buffer.from(c.pass).toString("base64"));
    }

    await talk(socket, [250], `MAIL FROM:<${addressOnly(sender)}>`);
    await talk(socket, [250, 251], `RCPT TO:<${addressOnly(to)}>`);
    await talk(socket, [354], "DATA");
    // Dot-stuffing: a line of a single dot would otherwise end the message.
    const safe = raw.replace(/\r\n\./g, "\r\n..");
    const accepted = await talk(socket, [250], `${safe}\r\n.`);
    try {
      await talk(socket, [221], "QUIT");
    } catch {
      /* the message was already accepted */
    }
    return { accepted: true, messageId, signed, response: accepted.text.split("\r\n").pop() };
  } finally {
    socket.destroy();
  }
}

function hostname() {
  return process.env.SMTP_EHLO_NAME || cfg().dkim.domain || "senditto.dev";
}
