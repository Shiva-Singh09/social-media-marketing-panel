/**
 * GET /api/auth/google/login
 *
 * Legacy OAuth start endpoint, kept for link compatibility. It now FORWARDS
 * to the single hardened start (`/api/auth/google`), which issues the OAuth
 * `state`, the PKCE (S256) `code_challenge` and the OIDC `nonce`, and binds
 * them to the browser via the transient callback cookie. Building an
 * authorization URL here directly — as this route used to — would create a
 * second, unhardened flow whose authorization responses the hardened callback
 * rejects anyway (the callback requires the transient cookie this route never
 * set), so forwarding both preserves the UX and eliminates the weaker path.
 *
 * Example request:
 *   GET /api/auth/google/login
 *
 * Example response:
 *   302 Redirect → /api/auth/google (→ Google consent screen, or
 *   → /login?error=google_not_configured when GOOGLE_CLIENT_ID is unset)
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = new URL(req.url).origin;

  if (!process.env.GOOGLE_CLIENT_ID) {
    // Never leak whether the secret is missing — only the public id matters here.
    return Response.redirect(`${origin}/login?error=google_not_configured`, 302);
  }

  // Forward to the ONE hardened OAuth start (state + PKCE S256 + nonce +
  // transient cookie). No authorization URL is ever built without them.
  return Response.redirect(`${origin}/api/auth/google`, 302);
}