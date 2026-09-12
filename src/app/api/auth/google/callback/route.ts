import { cookies } from "next/headers";
import { User } from "@/db";
import { setSessionCookie, signToken } from "@/lib/auth";
import { verifyGoogleIdToken } from "@/lib/google";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  credentialEqual,
  parseOAuthTransient,
  pkceChallenge,
} from "@/lib/oauth-google";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

// GOOGLE_TOKEN_URL is a TEST-ONLY override (synthetic OAuth token servers).
// Production always uses Google's token endpoint.
const GOOGLE_TOKEN_ENDPOINT =
  process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";

/**
 * Authorization-response processing for the hardened Google OAuth code flow.
 * Steps (each MUST pass before the next; any failure → generic `google_failed`):
 *   1. `state` present, and its SHA-256 digest matches the digest bound to
 *      this browser's transient cookie at start time (login-CSRF / replay).
 *   2. The exact `redirect_uri` used at start time matches this request's
 *      origin (host-header-poisoning / response mix-up protection).
 *   3. Token exchange is authenticated with the PKCE `code_verifier` bound in
 *      the same transient cookie (authorization-code binding).
 *   4. The returned id_token is signature + issuer + audience verified, and
 *      its `nonce` claim matches the one bound at start time.
 * The transient cookie, PKCE verifier and nonce are consumed (cleared) on
 * every path, so a callback URL can never be replayed successfully.
 */
async function processGoogleCallback(input: {
  state: string | null;
  code: string | null;
  origin: string;
  fetchImpl?: typeof fetch;
}): Promise<{ user: NonNullable<Awaited<ReturnType<typeof User.findOne>>>; token: string }> {
  const { state, code, origin } = input;
  const fetchImpl = input.fetchImpl ?? fetch;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("google not configured");
  }

  // Consume the one-time cookie NOW — success or failure, it never stays.
  // (Expiry is further enforced by the cookie's short maxAge.)
  const store = await cookies();
  const cookieValue = store.get(OAUTH_COOKIE)?.value;
  const clearCookie = () => {
    store.set(OAUTH_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: OAUTH_COOKIE_PATH,
      maxAge: 0,
    });
  };

  // A malformed callback URL (missing code/state) must also consume the
  // transient cookie so no half-completed OAuth session lingers in the
  // browser for the cookie's remaining TTL.
  if (!code || !state) {
    clearCookie();
    throw new Error("missing code or state");
  }

  const parsed = parseOAuthTransient(cookieValue);
  if (!parsed.ok) {
    clearCookie();
    throw new Error("OAuth session cookie invalid or missing");
  }
  const { transient } = parsed;

  // Step 1 — state binding: the callback's `state` must match the session it
  // was issued to. Compare digests in constant time; mismatch = abort now.
  if (!credentialEqual(transient.stateDigest, pkceChallenge(state))) {
    clearCookie();
    throw new Error("state mismatch");
  }

  // Step 2 — redirect_uri binding: only exchange a code for the exact URI we
  // issued at start time (prevents Host-header poisoning from steering the
  // code (and the eventual session) to an attacker-controlled origin).
  if (transient.redirectUri !== `${origin}/api/auth/google/callback`) {
    clearCookie();
    throw new Error("redirect_uri mismatch");
  }

  clearCookie();

  // Step 3 — PKCE-authenticated token exchange.
  const tokenRes = await fetchImpl(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: transient.redirectUri,
      grant_type: "authorization_code",
      code_verifier: transient.codeVerifier,
    }),
  });
  if (!tokenRes.ok) throw new Error("token exchange failed");
  const tokens = (await tokenRes.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("missing id_token");

  // Step 4 — nonce-checked verification. jose cryptographically verifies the
  // RS256 signature against Google's JWKS and validates iss/aud/exp BEFORE
  // the nonce claim is compared.
  const claims = await verifyGoogleIdToken(tokens.id_token, {
    nonce: transient.nonce,
  });
  if (!claims.email) throw new Error("missing email claim");
  const email = claims.email.toLowerCase();

  let user = await User.findOne({ email });
  if (!user) {
    user = await User.create({
      name: claims.name ?? email.split("@")[0]!, email, googleId: claims.sub,
      avatar: claims.picture ?? null, emailVerified: true, lastLogin: new Date(),
    });
  } else {
    user.googleId = claims.sub;
    user.lastLogin = new Date();
    await user.save();
  }

  const token = await signToken({
    sub: String(user._id),
    email: user.email,
    role: user.role === "admin" ? "admin" : "user",
    sv: user.sessionVersion ?? 0,
  });
  return { user, token };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  // Not configured keeps the ORIGINAL pre-hardening redirect so the UI
  // message doesn't change. Any configured OAuth failure below returns the
  // SAME generic `google_failed` regardless of whether it was state, PKCE,
  // nonce, signature, issuer or audience that failed — an attacker can never
  // oracle which check fired.
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return Response.redirect(`${origin}/login?error=google_not_configured`, 302);
  }

  try {
    await ensureSeeded();
    const { user, token } = await processGoogleCallback({ state, code, origin });

    await setSessionCookie(token);
    return Response.redirect(
      `${origin}${user.role === "admin" ? "/admin/dashboard" : "/dashboard"}`,
      302,
    );
  } catch {
    console.error("[google-oauth] callback rejected");
    return Response.redirect(`${origin}/login?error=google_failed`, 302);
  }
}
