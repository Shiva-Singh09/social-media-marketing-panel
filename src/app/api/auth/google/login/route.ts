/**
 * GET /api/auth/google/login
 *
 * Starts the Google OAuth 2.0 authorization-code flow:
 *  1. Builds the consent-screen URL with client_id from env (never hardcoded).
 *  2. redirect_uri points back at /api/auth/google/callback, which exchanges
 *     the code and cryptographically verifies the returned id_token.
 *
 * Example request:
 *   GET /api/auth/google/login
 *
 * Example response:
 *   302 Redirect → https://accounts.google.com/o/oauth2/v2/auth?...
 *   (or 302 → /login?error=google_not_configured when GOOGLE_CLIENT_ID is unset)
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const origin = new URL(req.url).origin;

  if (!clientId) {
    // Never leak whether the secret is missing — only the public id matters here.
    return Response.redirect(`${origin}/login?error=google_not_configured`, 302);
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "select_account",
  });

  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}