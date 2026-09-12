/**
 * Central environment validation for P0 secret hygiene.
 *
 * This module NEVER returns secret values for logging and NEVER prints them.
 * All error messages describe WHAT is missing and HOW to generate it, without
 * echoing the configured value.
 *
 * Classification used by `.env.example`:
 *   REQUIRED in production  — MONGODB_URI, JWT_SECRET, ADMIN_EMAIL/ADMIN_PASSWORD,
 *                             ACCOUNT_ENCRYPTION_KEY, CRON_SECRET
 *   OPTIONAL                — Razorpay keys (required only for live payments),
 *                             SMTP (required only for real email),
 *                             SMM_API_KEY (required only for live boosts/status),
 *                             Google OAuth, HEALTH_SECRET, demo seed
 *   DEVELOPMENT ONLY        — demo checkout fallback (non-production only)
 *   PUBLIC/PUBLISHABLE      — NEXT_PUBLIC_RAZORPAY_KEY_ID only (publishable Key ID)
 */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Heuristic strength check for high-entropy secrets.
 * Requires length AND charset diversity AND rejects well-known placeholders.
 * Does not inspect the real secret beyond boolean checks and never logs it.
 */
function looksWeakSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 32) return true;
  const lower = v.toLowerCase();
  const weakSubstrings = [
    "changethis",
    "change-this",
    "password",
    "secret",
    "test",
    "development",
    "example",
    "sample",
    "123456",
    "yourpanel",
    "smmpanel",
  ];
  if (weakSubstrings.some((w) => lower.includes(w))) return true;
  // A JWT *header* prefix (e.g. the well-known base64 for {"alg":...}) is not
  // a random secret — reject it explicitly.
  if (v.startsWith("eyJhbGciOi")) return true;
  // Require reasonable charset diversity so "aaaaaaaaaaaaaaaa..." fails.
  const unique = new Set(v).size;
  if (unique < 12) return true;
  return false;
}

/**
 * Validates JWT_SECRET without ever returning or logging the value.
 * Throws a clear operator-facing error in every environment when missing;
 * in production additionally rejects low-entropy/placeholder values.
 */
export function assertJwtSecretConfigured(): void {
  const secret = (process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET)?.trim() ?? "";
  if (!secret) {
    throw new Error(
      "JWT_SECRET (or NEXTAUTH_SECRET) environment variable is required. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\" " +
        "and set it in the environment. Refusing to sign or verify sessions without it.",
    );
  }
  if (secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be at least 32 characters long (256-bit minimum entropy). " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\".",
    );
  }
  if (isProduction() && looksWeakSecret(secret)) {
    throw new Error(
      "JWT_SECRET is not cryptographically strong for production. " +
        "Set a 96-character hex value generated with: " +
        "node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\". " +
        "Do not use placeholders, passwords, or JWT header fragments.",
    );
  }
}

/** True when an explicit per-purpose secret is configured (non-empty after trim). */
function hasExplicit(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

/**
 * Production readiness check for security-critical variables.
 * Returns a list of human-readable problems WITHOUT secret values.
 * Call at boot (seed/settings) or from a health check in production.
 */
export function validateProductionEnv(): string[] {
  if (!isProduction()) return [];
  const problems: string[] = [];
  const jwt = (process.env.JWT_SECRET ?? process.env.NEXTAUTH_SECRET)?.trim() ?? "";
  if (!jwt) problems.push("JWT_SECRET is missing (required in production).");
  else if (jwt.length < 32 || looksWeakSecret(jwt))
    problems.push("JWT_SECRET must be a strong random value (see .env.example for generation).");
  if (!hasExplicit("ACCOUNT_ENCRYPTION_KEY"))
    problems.push("ACCOUNT_ENCRYPTION_KEY is missing (required in production; no fallback to JWT_SECRET).");
  else if ((process.env.ACCOUNT_ENCRYPTION_KEY?.trim() ?? "").length < 32)
    problems.push("ACCOUNT_ENCRYPTION_KEY must be at least 32 characters long.");
  if (!hasExplicit("CRON_SECRET"))
    problems.push("CRON_SECRET is missing (required in production for /api/posts/process).");
  else if ((process.env.CRON_SECRET?.trim() ?? "").length < 32)
    problems.push("CRON_SECRET must be at least 32 characters long.");
  // Razorpay: keys are optional overall (payments disabled without them), but a
  // webhook secret must never be implicitly derived in production.
  if (hasExplicit("RAZORPAY_KEY_ID") !== hasExplicit("RAZORPAY_KEY_SECRET"))
    problems.push("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be set together.");
  if ((hasExplicit("RAZORPAY_KEY_ID") || hasExplicit("RAZORPAY_KEY_SECRET")) && !hasExplicit("RAZORPAY_WEBHOOK_SECRET"))
    problems.push("RAZORPAY_WEBHOOK_SECRET must be set explicitly in production (no fallback to the key secret).");
  return problems;
}
