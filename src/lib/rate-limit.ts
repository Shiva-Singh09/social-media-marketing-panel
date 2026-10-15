import { RateLimitBucket } from "@/db/mongodb-schema";
import { HttpError } from "@/lib/auth";

/**
 * MongoDB-backed rate limiter. Unlike an in-memory Map, counters live in the
 * database so limits are enforced consistently across every server instance
 * / replica, not just within a single Node.js process.
 */
export type RateRule = { windowMs: number; max: number };

export const RATE_RULES = {
  login: { windowMs: 15 * 60 * 1000, max: 5 },
  register: { windowMs: 60 * 60 * 1000, max: 5 },
  // Password-reset token consumption: same brute-force budget as login.
  // Separate bucket from `login` so reset attempts never lock out logins
  // (and vice versa). Enforced in /api/auth/reset-password.
  passwordReset: { windowMs: 15 * 60 * 1000, max: 5 },
  order: { windowMs: 60 * 1000, max: 10 },
  payment: { windowMs: 60 * 1000, max: 5 },
  general: { windowMs: 15 * 60 * 1000, max: 100 },
  support: { windowMs: 60 * 1000, max: 5 },
  // --- SMM integration endpoints ---
  // Scheduling creates provider orders (costs real money) — keep it tight.
  schedule: { windowMs: 60 * 1000, max: 10 },
  // Analytics reads hit MongoDB aggregations; ingest is cheap but unbounded.
  analytics: { windowMs: 60 * 1000, max: 30 },
  accounts: { windowMs: 60 * 1000, max: 15 },
  // Cron-triggered due-post processing: at most once per minute.
  smmProcess: { windowMs: 60 * 1000, max: 2 },
  // Cron-triggered order submission-recovery processing: the worker polls the
  // provider and therefore shares the smmProcess cadence (cheap reads, small
  // bounded batch). Kept as a SEPARATE named rule so the two cron endpoints
  // cannot starve each other out of their 2/minute budgets.
  ordersProcess: { windowMs: 60 * 1000, max: 2 },
} satisfies Record<string, RateRule>;

/**
 * `X-Forwarded-For` is fully attacker-controlled unless a trusted reverse
 * proxy appends the real client IP as the LAST hop. We only trust it when
 * `TRUST_PROXY=true` is explicitly set (documented in .env.example), and even
 * then we read the last entry — not the first, which the client can forge —
 * so an attacker rotating the header's leading values cannot evade limits.
 */
export function clientIp(req: Request): string {
  const trustProxy = process.env.TRUST_PROXY === "true";
  if (trustProxy) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
      if (hops.length > 0) return hops[hops.length - 1]!;
    }
    const realIp = req.headers.get("x-real-ip");
    if (realIp) return realIp.trim();
  }
  // No trusted proxy configured — fall back to a shared bucket. Anonymous
  // rate limits become coarser (shared across all clients on this path) but
  // can never be bypassed by spoofing headers.
  return "untrusted-proxy";
}

/**
 * Security-sensitive rules whose brute-force / abuse protection must NEVER
 * silently disappear. When the MongoDB backing store is unavailable these
 * rules fail closed (503) via limitOrFail instead of failing open.
 * Everything else (general, analytics reads, support tickets, scheduling
 * helpers, cron-triggered processing) keeps the previous fail-open behavior
 * so a DB hiccup degrades gracefully instead of taking the whole app down.
 */
const SENSITIVE_RULES: ReadonlySet<keyof typeof RATE_RULES> = new Set([
  "login",
  "register",
  "passwordReset",
  "payment",
  "order",
] as Array<keyof typeof RATE_RULES>);

export function isSensitiveRule(name: keyof typeof RATE_RULES): boolean {
  return SENSITIVE_RULES.has(name);
}

/**
 * Atomically increments a bucket and resets it once its window has elapsed,
 * using MongoDB findByIdAndUpdate with upsert so concurrent requests
 * from different instances can't race each other.
 *
 * Throws on infrastructure errors — the caller (rateLimit) decides whether
 * to fail closed (sensitive rules) or fail open (general rules).
 */
async function increment(key: string, windowMs: number): Promise<{ count: number }> {
  const seconds = Math.max(1, Math.ceil(windowMs / 1000));
  const now = new Date();
  const resetAt = new Date(now.getTime() + seconds * 1000);

  try {
    const bucket = await RateLimitBucket.findById(key);
    
    if (!bucket || bucket.resetAt <= now) {
      // Create new or reset expired bucket
      await RateLimitBucket.findByIdAndUpdate(
        key,
        {
          _id: key,
          bucketKey: key,
          count: 1,
          resetAt,
        },
        { returnDocument: "after", upsert: true }
      );
      return { count: 1 };
    } else {
      // Increment existing bucket
      const updated = await RateLimitBucket.findByIdAndUpdate(
        key,
        { $inc: { count: 1 } },
        { returnDocument: "after" }
      );
      return { count: updated?.count ?? 1 };
    }
  } catch (error) {
    // Infrastructure failure: rethrow and let rateLimit() decide — sensitive
    // rules fail closed (503), general rules fail open. The raw error is
    // never serialized into a response.
    console.error("[rate-limit:error] backing store unavailable");
    throw error;
  }
}

/** Returns null when allowed, or a human readable error when the limit is hit. */
export async function rateLimit(
  key: string,
  rule: RateRule,
  opts?: { sensitive?: boolean },
): Promise<string | null> {
  try {
    const { count } = await increment(key, rule.windowMs);
    if (count > rule.max) {
      const seconds = Math.ceil(rule.windowMs / 1000);
      return `Too many requests. Please retry in ${seconds}s.`;
    }
    return null;
  } catch {
    console.error("[rate-limit:error] enforcement unavailable");
    if (opts && opts.sensitive) {
      throw new HttpError("Security protection is temporarily unavailable. Please try again shortly.", 503);
    }
    return null;
  }
}

export async function limitOrFail(
  req: Request,
  name: keyof typeof RATE_RULES,
  id?: string,
): Promise<string | null> {
  return rateLimit(`${name}:${id ?? clientIp(req)}`, RATE_RULES[name], {
    sensitive: isSensitiveRule(name),
  });
}
