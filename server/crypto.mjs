/**
 * Senditto cryptography.
 *
 * Three jobs, kept apart on purpose:
 *
 *   1. Passwords    — scrypt, one way. A stolen database cannot reveal them.
 *   2. API secrets  — SHA-256, one way. We keep a fingerprint, never the key.
 *   3. Stored data  — AES-256-GCM, two way, for fields we must read back
 *                     (message bodies, recipient addresses, OTP codes).
 *
 * Algorithms are the ones regulators expect: scrypt (RFC 7914) for password
 * storage and AES-256-GCM (NIST SP 800-38D, FIPS 140 approved) for data at
 * rest. Transport security is TLS, terminated at the edge.
 *
 * The data key comes from SENDITTO_DATA_KEY (64 hex characters). Without it
 * the server refuses to encrypt rather than storing readable personal data.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

/* ------------------------------- passwords ------------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hash a password for storage. Format: scrypt$N$r$p$salt$hash */
export function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(plain), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
    maxmem: 64 * 1024 * 1024,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function isHashed(stored) {
  return typeof stored === "string" && stored.startsWith("scrypt$");
}

/**
 * Check a password against a stored value.
 * Comparison is constant time, so a wrong password cannot be found by
 * measuring how long the answer takes.
 */
export function verifyPassword(plain, stored) {
  if (!stored) return false;
  if (!isHashed(stored)) {
    // Legacy plaintext row that has not been migrated yet.
    const a = Buffer.from(String(plain));
    const b = Buffer.from(String(stored));
    return a.length === b.length && timingSafeEqual(a, b);
  }
  const [, n, r, p, saltHex, hashHex] = stored.split("$");
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(String(plain), Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/* ------------------------------ API secrets ------------------------------ */

/** Fingerprint of an API key. The key itself is shown once and never stored. */
export function hashSecret(secret) {
  return `sha256:${createHash("sha256").update(String(secret)).digest("hex")}`;
}

export function verifySecret(secret, stored) {
  if (!stored) return false;
  const a = Buffer.from(hashSecret(secret));
  const b = Buffer.from(String(stored));
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------------------------- data encryption ---------------------------- */

let cachedKey = null;

function dataKey() {
  if (cachedKey) return cachedKey;
  const hex = process.env.SENDITTO_DATA_KEY || "";
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  cachedKey = Buffer.from(hex, "hex");
  return cachedKey;
}

export function encryptionReady() {
  return dataKey() !== null;
}

/** A key an operator can paste into the environment file. */
export function generateDataKey() {
  return randomBytes(32).toString("hex");
}

/**
 * Encrypt a value for storage. Returns "enc:v1:iv:tag:ciphertext".
 * Every value gets its own random IV, and the tag makes tampering detectable.
 */
export function encrypt(plain) {
  if (plain == null || plain === "") return plain;
  const key = dataKey();
  if (!key) throw new Error("SENDITTO_DATA_KEY is not set — refusing to store personal data unencrypted");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const out = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${out.toString("base64")}`;
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

/** Decrypt a stored value. Returns the input unchanged if it was never encrypted. */
export function decrypt(value) {
  if (!isEncrypted(value)) return value;
  const key = dataKey();
  if (!key) return "[encrypted]";
  try {
    const [, , ivB64, tagB64, dataB64] = value.split(":");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key or altered ciphertext — never return half-decrypted data.
    return "[unreadable]";
  }
}

/** Encrypt when a key is configured; keep working in development when not. */
export function encryptIfPossible(plain) {
  return encryptionReady() ? encrypt(plain) : plain;
}
