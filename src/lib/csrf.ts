/**
 * Double-submit-cookie CSRF protection.
 *
 * The token is set in a *non*-httpOnly cookie so client-side JS on our own
 * origin can read it and echo it back as a custom request header. A
 * cross-site attacker's page can trigger a request that automatically
 * attaches the cookie, but the same-origin policy prevents that attacker's
 * JavaScript from ever reading the cookie's value to also set the matching
 * header — so a forged cross-site request fails even when Origin/Referer
 * headers are stripped, spoofed, or absent.
 */
export const CSRF_COOKIE = "csrf_token";
export const CSRF_HEADER = "x-csrf-token";

export function generateCsrfToken(): string {
  // Edge + Node compatible.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
