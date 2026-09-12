import { cookies } from "next/headers";
import { User } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { setSessionCookie, signToken, toSafeUser } from "@/lib/auth";
import { verifyGoogleIdToken } from "@/lib/google";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_COOKIE_TTL_SECONDS,
  generateOAuthSecret,
  pkceChallenge,
  serializeOAuthTransient,
} from "@/lib/oauth-google";
import { ensureSeeded } from "@/lib/seed";

export const dynamic = "force-dynamic";

/**
 * GET → redirect the browser to Google's consent screen (OAuth code flow),
 * hardened with OAuth `state`, PKCE (S256) and an OIDC `nonce`:
 *   - state    : 256-bit random value; only its SHA-256 digest is stored in
 *                the transient cookie (bound to this browser session).
 *   - PKCE     : random code_verifier stored in the same cookie; Google
 *                returns it on token exchange, so an intercepted/forged
 *                authorization code cannot be replayed by another client.
 *   - nonce    : random value stored in the cookie and re-checked against
 *                the verified id_token claim on the callback.
 */
export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const origin = new URL(req.url).origin;
  if (!clientId) {
    return Response.redirect(`${origin}/login?error=google_not_configured`, 302);
  }

  const state = generateOAuthSecret();
  const codeVerifier = generateOAuthSecret();
  const nonce = generateOAuthSecret(128);
  const redirectUri = `${origin}/api/auth/google/callback`;

  // Bind the one-time values to this browser session. HttpOnly (JS can never
  // read state/verifier/nonce), Secure in production, SameSite=Lax, 10 min
  // TTL, scoped to the callback path. Only the state DIGEST is stored — a
  // stolen cookie alone still cannot be used to upload a craftable state.
  const store = await cookies();
  store.set(
    OAUTH_COOKIE,
    serializeOAuthTransient(
      pkceChallenge(state), // sha256(state) — the digest doubles as the binding
      codeVerifier,
      nonce,
      redirectUri,
    ),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: OAUTH_COOKIE_PATH,
      maxAge: OAUTH_COOKIE_TTL_SECONDS,
    },
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
    state,
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
    nonce,
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

/** POST { credential } → Google One-Tap / GIS id_token login. */
export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded();
    const body = (await req.json()) as { credential?: string };
    if (!body.credential) return fail("Missing Google credential", 422);

    // Signature + issuer + audience are cryptographically verified — never
    // trust a client-supplied JWT payload without this check.
    let claims;
    try {
      claims = await verifyGoogleIdToken(body.credential);
    } catch {
      return fail("Google token verification failed", 401);
    }
    if (!claims.email) return fail("Google account has no email", 400);

    const email = claims.email.toLowerCase();
    let user = await User.findOne({ email });

    if (!user) {
      user = await User.create({
        name: claims.name ?? email.split("@")[0]!,
        email,
        googleId: claims.sub,
        avatar: claims.picture ?? null,
        emailVerified: true,
        lastLogin: new Date(),
      });
    } else {
      user.googleId = claims.sub;
      user.lastLogin = new Date();
      user.emailVerified = true;
      await user.save();
    }

    if (user!.status === "blocked") return fail("Your account has been blocked", 403);

    const token = await signToken({
      sub: String(user!._id),
      email: user!.email,
      role: user!.role === "admin" ? "admin" : "user",
      sv: user!.sessionVersion ?? 0,
    });
    await setSessionCookie(token);
    return ok({ user: toSafeUser(user!) }, "Signed in with Google");
  });
}
