import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * Cryptographically verifies a Google-issued ID token (used by both the
 * OAuth "code" callback and Google One-Tap/GIS `credential` flow).
 *
 * Previously this project used `decodeJwt()`, which only base64-decodes the
 * payload and performs NO signature check — any client could hand the
 * server a forged token with an arbitrary email address. This verifies the
 * RS256 signature against Google's published JWKS and checks `iss`/`aud`.
 */
// GOOGLE_JWKS_URL is a TEST-ONLY override (synthetic JWKS servers). Production
// always uses Google's published certificates.
const JWKS_URL = process.env.GOOGLE_JWKS_URL ?? "https://www.googleapis.com/oauth2/v3/certs";
const JWKS = createRemoteJWKSet(new URL(JWKS_URL));

export type GoogleIdTokenClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  /** OIDC `nonce` claim — present when the caller supplied a nonce. */
  nonce?: string;
};

export type VerifyGoogleIdTokenOptions = {
  /**
   * Expected OIDC `nonce` (P1 OAuth hardening). When provided, the verified
   * id_token MUST carry a matching `nonce` claim. Checked only after jose
   * has cryptographically verified the signature, `iss` and `aud` (and
   * enforced `exp`), so an attacker can never influence this comparison
   * with an unsigned/forged token.
   */
  nonce?: string;
};

export async function verifyGoogleIdToken(
  idToken: string,
  opts?: VerifyGoogleIdTokenOptions,
): Promise<GoogleIdTokenClaims> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new Error("GOOGLE_CLIENT_ID is not configured on the server");
  }

  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
  });

  if (!payload.sub) throw new Error("Google token is missing a subject claim");

  const nonce = typeof payload.nonce === "string" ? payload.nonce : undefined;
  // Nonce comparison happens strictly AFTER signature/issuer/audience
  // verification above. Missing or mismatched nonce → hard failure; the
  // caller maps it to the same generic OAuth error as every other failure.
  if (opts?.nonce !== undefined && nonce !== opts.nonce) {
    throw new Error("Google token nonce mismatch");
  }

  return {
    sub: String(payload.sub),
    email: typeof payload.email === "string" ? payload.email : undefined,
    email_verified: Boolean(payload.email_verified),
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
    nonce,
  };
}
