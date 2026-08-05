/**
 * Real DNS verification for sending domains.
 *
 * Every check below is an actual lookup against public DNS. A domain is only
 * marked verified when the records are really published — the studio never
 * sets these flags by hand.
 */
import { Resolver } from "node:dns/promises";

const resolver = new Resolver({ timeout: 5000, tries: 2 });
// Public resolvers, so a server's local DNS view cannot mask a missing record.
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

const flatten = (records) => records.map((r) => (Array.isArray(r) ? r.join("") : String(r)));

async function txt(name) {
  try {
    return flatten(await resolver.resolveTxt(name));
  } catch {
    return [];
  }
}

/** SPF: does the domain authorise our sending host? */
export async function checkSpf(domain, expectedInclude = "") {
  const records = (await txt(domain)).filter((r) => /^v=spf1/i.test(r));
  if (!records.length) return { ok: false, found: null, reason: "No SPF record published" };
  const record = records[0];
  if (records.length > 1) {
    return { ok: false, found: record, reason: "More than one SPF record — receivers will reject all of them" };
  }
  if (expectedInclude && !record.toLowerCase().includes(expectedInclude.toLowerCase())) {
    return { ok: false, found: record, reason: `SPF does not include ${expectedInclude}` };
  }
  return { ok: true, found: record, reason: "SPF published" };
}

/** DKIM: is the public key published at <selector>._domainkey.<domain>? */
export async function checkDkim(domain, selector = "senditto") {
  const host = `${selector}._domainkey.${domain}`;
  const records = (await txt(host)).filter((r) => /p=/.test(r));
  if (!records.length) return { ok: false, found: null, reason: `No DKIM key at ${host}` };
  const record = records[0];
  const key = (record.match(/p=([A-Za-z0-9+/=]*)/) || [])[1] || "";
  if (!key) return { ok: false, found: record, reason: "DKIM record has an empty public key" };
  return { ok: true, found: record, reason: "DKIM key published" };
}

/** DMARC: is a policy published, and is it strong enough to matter? */
export async function checkDmarc(domain) {
  const records = (await txt(`_dmarc.${domain}`)).filter((r) => /^v=DMARC1/i.test(r));
  if (!records.length) return { ok: false, found: null, reason: "No DMARC policy published" };
  const record = records[0];
  const policy = (record.match(/\bp=([a-z]+)/i) || [])[1] || "none";
  return {
    ok: true,
    found: record,
    policy,
    reason:
      policy === "none"
        ? "DMARC published with p=none — monitoring only, move to quarantine or reject when ready"
        : `DMARC published with p=${policy}`,
  };
}

/** Can the domain receive mail at all? */
export async function checkMx(domain) {
  try {
    const mx = await resolver.resolveMx(domain);
    if (!mx.length) return { ok: false, found: null, reason: "No MX records" };
    const best = mx.sort((a, b) => a.priority - b.priority)[0];
    return { ok: true, found: `${best.exchange} (priority ${best.priority})`, reason: "MX published" };
  } catch {
    return { ok: false, found: null, reason: "No MX records" };
  }
}

/** Full verification used by the studio and the product. */
export async function verifyDomain(domain, { selector = "senditto", spfInclude = "" } = {}) {
  const name = String(domain || "").trim().toLowerCase();
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) {
    return { domain: name, ok: false, error: "That is not a valid domain name" };
  }
  const [spf, dkim, dmarc, mx] = await Promise.all([
    checkSpf(name, spfInclude),
    checkDkim(name, selector),
    checkDmarc(name),
    checkMx(name),
  ]);
  // Sending needs SPF and DKIM. DMARC is required for a good reputation but
  // is reported separately so an operator can see exactly what is missing.
  const ok = spf.ok && dkim.ok;
  return {
    domain: name,
    ok,
    status: ok ? "verified" : "pending",
    spf,
    dkim,
    dmarc,
    mx,
    checkedAt: new Date().toISOString(),
  };
}
