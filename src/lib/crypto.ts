/**
 * Authenticated encryption for third-party credentials (social account
 * access/refresh tokens) stored in MongoDB.
 *
 * Why: a database dump must never expose usable OAuth tokens. We use
 * AES-256-GCM (authenticated — tampering is detected on decrypt) with a key
 * derived via scrypt from `ACCOUNT_ENCRYPTION_KEY`.
 *
 * Production rule: ACCOUNT_ENCRYPTION_KEY is REQUIRED and must NOT silently
 * fall back to JWT_SECRET (separate compromise domains). In non-production a
 * JWT_SECRET fallback remains only so local development keeps working.
 *
 * Ciphertext format:  v1.<iv-b64url>.<authTag-b64url>.<ciphertext-b64url>
 * The version prefix allows transparent key rotation later.
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const VERSION = "v1";
/** Static salt is acceptable here because the input secret itself is high-
 *  entropy (≥32 chars) and never user-chosen; scrypt still hardens it. */
const SCRYPT_SALT = "smm-panel.account-tokens.v1";
const KEY_LENGTH = 32; // AES-256

let cachedKey: Buffer | null = null;

function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const explicit = process.env.ACCOUNT_ENCRYPTION_KEY?.trim() ?? "";
  if (explicit) {
    if (explicit.length < 16) {
      throw new Error("ACCOUNT_ENCRYPTION_KEY must be set to encrypt account tokens.");
    }
    cachedKey = scryptSync(explicit, SCRYPT_SALT, KEY_LENGTH);
    return cachedKey;
  }
  // Non-production only: fall back to JWT_SECRET so local dev keeps working.
  // Production must configure a dedicated key (separate compromise domains).
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ACCOUNT_ENCRYPTION_KEY is required in production and must not fall back to JWT_SECRET. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\".",
    );
  }
  const devFallback = process.env.JWT_SECRET?.trim() ?? "";
  if (!devFallback || devFallback.length < 16) {
    throw new Error("ACCOUNT_ENCRYPTION_KEY (or JWT_SECRET) must be set to encrypt account tokens.");
  }
  cachedKey = scryptSync(devFallback, SCRYPT_SALT, KEY_LENGTH);
  return cachedKey;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Encrypts a plaintext secret. Returns an opaque string safe to store in
 * MongoDB. Throws only on configuration problems — never leaks plaintext.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12); // 96-bit IV is the GCM recommendation
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [VERSION, b64url(iv), b64url(authTag), b64url(ciphertext)].join(".");
}

/**
 * Decrypts a value produced by {@link encryptSecret}. Returns `null` on ANY
 * failure (wrong key, tampered ciphertext, malformed input) so callers can
 * treat the credential as simply absent instead of crashing a request.
 */
export function decryptSecret(payload: string | null | undefined): string | null {
  if (!payload) return null;
  const parts = payload.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64!, "base64url"));
    decipher.setAuthTag(Buffer.from(tagB64!, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataB64!, "base64url")),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch {
    // Wrong key or tampered data — treat as missing, never throw raw crypto errors.
    return null;
  }
}