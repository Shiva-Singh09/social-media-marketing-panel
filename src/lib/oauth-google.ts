import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google OAuth hardening helpers (P1 — state + PKCE + nonce).
 *
 * The transient cookie binds three one-time values to the browser session:
 *   - a digest of the OAuth `state` value (login-CSRF / replay protection),
 *   - the PKCE `code_verifier` (authorization-code binding),
 *   - the OIDC `nonce` (id_token replay / response mix-up protection),
 * plus the exact `redirect_uri` used at start time (host-header-poisoning
 * protection — the callback only exchanges a code for the URI we issued).
 *
 * The cookie is HttpOnly + Secure-in-production + SameSite=Lax + short-lived
 * (10 minutes) and scoped to the callback path only. Nothing sensitive is
 * ever placed in the `state` query parameter (just random bytes), and no
 * value is ever logged.
 */

export const OAUTH_COOKIE = "smm_oauth";
export const OAUTH_COOKIE_PATH = "/api/auth/google/callback";
/** 10 minutes — matches Google's ~10 min authorization-code expiry window. */
export const OAUTH_COOKIE_TTL_SECONDS = 600;

/** 32 random bytes (256-bit) — sufficient entropy for state / verifier. */
export function generateOAuthSecret(bits = 256): string {
  return Buffer.from(randomBytes(bits / 8)).toString("base64url");
}

/** URL-safe base64 (no padding) — RFC 7636 `unreserved` alphabet. */
export function b64url(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * RFC 7636 §4.2 S256 PKCE challenge:
 *   code_challenge = BASE64URL(SHA256(ASCII(code_verifier)))
 * The verifier is generated as 32 random bytes → 43 URL-safe chars (within
 * the 43..128 range the RFC requires). `plain` is never used.
 */
export function pkceChallenge(verifier: string): string {
  const digest = createHash("sha256").update(verifier, "utf8").digest();
  return Buffer.from(digest).toString("base64url");
}

/**
 * Constant-time comparison for one-time values read from the callback URL
 * vs. values captured at start time — avoids timing side channels that could
 * help an attacker narrow down a valid state/redirect pair.
 */
export function credentialEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  // Length is pre-checked so timingSafeEqual never throws; the comparison
  // itself runs in constant time.
  return timingSafeEqual(ab, bb);
}

export type OAuthTransient = {
  stateDigest: string;
  codeVerifier: string;
  nonce: string;
  redirectUri: string;
};

export type OAuthTransientResult =
  | { ok: true; transient: OAuthTransient }
  | { ok: false };

/** Serialize the transient values into the opaque cookie value. */
export function serializeOAuthTransient(
  stateDigest: string,
  codeVerifier: string,
  nonce: string,
  redirectUri: string,
): string {
  return "v1." + [stateDigest, codeVerifier, nonce, b64url(redirectUri)].join(".");
}

/**
 * Parse + validate a transient cookie value. Returns { ok:false } for any
 * malformed shape — the caller treats it exactly like a missing cookie.
 * Length checks enforce the RFC 7636 verifier bounds so a poisoned cookie can
 * never carry an out-of-spec (e.g. tiny/`plain`) verifier.
 */
export function parseOAuthTransient(raw: string | null | undefined): OAuthTransientResult {
  if (!raw) return { ok: false };
  const parts = raw.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") return { ok: false };
  const [, stateDigest, codeVerifier, nonce, redirectB64] = parts;
  if (!stateDigest || !codeVerifier || !nonce || !redirectB64) return { ok: false };
  if (stateDigest.length < 32 || stateDigest.length > 128) return { ok: false };
  if (codeVerifier.length < 43 || codeVerifier.length > 128) return { ok: false };
  if (nonce.length < 8 || nonce.length > 128) return { ok: false };
  let redirectUri: string;
  try {
    redirectUri = Buffer.from(redirectB64, "base64url").toString("utf8");
  } catch {
    return { ok: false };
  }
  if (!/^https?:\/\/[^ ]+$/.test(redirectUri)) return { ok: false };
  return {
    ok: true,
    transient: { stateDigest, codeVerifier, nonce, redirectUri },
  };
}