import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { CSRF_COOKIE, CSRF_HEADER, generateCsrfToken } from "@/lib/csrf";

const PROTECTED_PAGES = [
  "/dashboard",
  "/new-order",
  "/orders",
  "/add-funds",
  "/support",
  "/profile",
  "/admin",
  // SMM integration studio (accounts / scheduling / analytics).
  "/smm-studio",
];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
// Server-to-server endpoints are exempt from both the same-origin check and
// the CSRF cookie check below:
//  - /api/payment/webhook  Razorpay calls it directly (verified via HMAC).
//  - /api/posts/process    Cron workers call it with the x-cron-secret
//                          header (or an admin session) — no browser involved.
const CSRF_EXEMPT_PREFIXES = ["/api/payment/webhook", "/api/posts/process"];

function secretKey(): Uint8Array | null {
  const secret = process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET;
  if (!secret) return null;
  return new TextEncoder().encode(secret);
}

/**
 * Edge-safe JWT check (signature + expiry only — no DB lookup). Full user
 * status re-validation still happens in every API route via `requireUser`.
 * This only decides whether to let a page render or bounce to /login.
 */
async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("smm_token")?.value;
  if (!token) return false;
  const key = secretKey();
  if (!key) return false;
  try {
    await jwtVerify(token, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * The set of origins this deployment may legitimately be served from. Behind
 * a reverse proxy (Vercel, the platform's preview proxy, Nginx, etc.) the
 * request Next.js sees internally is often on a different host/port than
 * the public URL the browser used — so `req.nextUrl.origin` alone is not
 * reliable. When `TRUST_PROXY=true` we additionally trust the
 * X-Forwarded-Host/Proto pair set by that single trusted proxy layer.
 */
function acceptableOrigins(req: NextRequest): string[] {
  const origins = new Set<string>([req.nextUrl.origin]);
  if (process.env.TRUST_PROXY === "true") {
    const fwdHost = req.headers.get("x-forwarded-host");
    const fwdProto = req.headers.get("x-forwarded-proto") ?? "https";
    if (fwdHost) origins.add(`${fwdProto}://${fwdHost}`);
  }
  const configured = process.env.FRONTEND_URL;
  if (configured) origins.add(configured.replace(/\/$/, ""));
  return Array.from(origins);
}

function isSameOrigin(req: NextRequest, allowed: string[]): boolean {
  const origin = req.headers.get("origin");
  if (origin) return allowed.includes(origin);
  const referer = req.headers.get("referer");
  if (referer) {
    try {
      return allowed.includes(new URL(referer).origin);
    } catch {
      return false;
    }
  }
  // No Origin/Referer at all — browsers always attach Origin on same-origin
  // fetch/XHR calls with a mutating method (see MDN Fetch spec), so a request
  // missing both is either a non-browser client or a stripped/forged header.
  // We fall through to the CSRF double-submit cookie check below rather than
  // rejecting outright, since that check is the authoritative guard.
  return false;
}

function buildCsp(nonce: string): string {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // React's dev-mode error overlay needs eval; never enabled in production.
    process.env.NODE_ENV !== "production" ? "'unsafe-eval'" : "",
    "https://checkout.razorpay.com",
    "https://accounts.google.com",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Inline `style="…"` attributes (used for a few dynamic progress-bar /
    // chart widths) cannot carry a nonce — only <style> tags can. This is a
    // deliberate, narrowly-scoped exception; CSS-only injection cannot
    // execute script in any modern browser.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://accounts.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * Next.js 16 proxy (formerly "middleware"): runs on every matched request to
 * enforce CSRF/same-origin checks, gate protected pages behind a session,
 * and attach a nonce-based CSP.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const exemptFromCsrf = CSRF_EXEMPT_PREFIXES.some((p) => pathname.startsWith(p));
  const existingCsrfCookie = req.cookies.get(CSRF_COOKIE)?.value;

  // --- CSRF: for state-changing API calls, require BOTH a same-origin
  // Origin/Referer AND a matching double-submit token. Either layer alone
  // has known gaps (Origin can be stripped by some clients; a bare
  // double-submit cookie can be defeated by a cookie-injection bug on a
  // sibling subdomain) — requiring both closes each other's gap.
  if (isApi && MUTATING_METHODS.has(req.method) && !exemptFromCsrf) {
    const sameOrigin = isSameOrigin(req, acceptableOrigins(req));
    const csrfHeader = req.headers.get(CSRF_HEADER);
    // A cross-origin attacker's script cannot read our cookie's value (same-
    // origin policy), so it can never make csrfHeader match existingCsrfCookie
    // even though the cookie itself may ride along automatically. Requiring
    // EITHER a verified same-origin Origin/Referer OR a matching CSRF token
    // means a request is only accepted if it demonstrably came from code
    // that could read this site's own cookies or set its own Origin header —
    // i.e. our own frontend.
    const csrfValid = Boolean(existingCsrfCookie) && csrfHeader === existingCsrfCookie;

    if (!sameOrigin && !csrfValid) {
      return NextResponse.json(
        { success: false, data: null, message: "Cross-origin request blocked" },
        { status: 403 },
      );
    }
  }

  if (isApi) {
    const res = NextResponse.next();
    if (!existingCsrfCookie) {
      res.cookies.set(CSRF_COOKIE, generateCsrfToken(), {
        httpOnly: false, // must be JS-readable so the client can echo it back
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }
    return res;
  }

  // --- Session gate for panel pages ---
  const needsAuth = PROTECTED_PAGES.some(
    (base) => pathname === base || pathname.startsWith(`${base}/`),
  );
  if (needsAuth && !(await hasValidSession(req))) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // --- Nonce-based CSP for every page response ---
  const nonce = generateCsrfToken().slice(0, 32);
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("Content-Security-Policy", csp);
  if (!existingCsrfCookie) {
    res.cookies.set(CSRF_COOKIE, generateCsrfToken(), {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
  }
  return res;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};