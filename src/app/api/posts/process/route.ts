/**
 * POST /api/posts/process — worker endpoint that publishes due posts.
 *
 * Auth: EITHER
 *   - an admin session (cookie/JWT), OR
 *   - the shared secret in the `x-cron-secret` header matching CRON_SECRET
 *     (for platform cron jobs like Vercel Cron / GitHub Actions schedules).
 *
 * CSRF is intentionally not applicable: this route is called server-to-server
 * with a bearer-style secret, mirroring how /api/payment/webhook is exempted
 * in src/proxy.ts — so it must be added to CSRF_EXEMPT_PREFIXES there.
 *
 * Example crontab entry:
 *   * * * * * curl -s -X POST https://your-panel.com/api/posts/process \
 *             -H "x-cron-secret: $CRON_SECRET"
 */

import { fail, handle, ok } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { limitOrFail } from "@/lib/rate-limit";
import { processDuePosts } from "@/lib/scheduler";
import { firstError, processDueSchema } from "@/lib/smm-validators";

export const dynamic = "force-dynamic";

/** Constant-time-ish comparison to avoid trivial timing oracles on the secret. */
function secretsMatch(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= candidate.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: Request) {
  return handle(async () => {
    // --- Rate limit first (cheap, per IP for cron callers) ---
    const limited = await limitOrFail(req, "smmProcess");
    if (limited) return fail(limited, 429);

    // --- Authenticate: admin session OR x-cron-secret ---
    const user = await getCurrentUser(req);
    const isAdmin = user?.role === "admin";

    if (!isAdmin) {
      const expected = process.env.CRON_SECRET?.trim();
      const provided = req.headers.get("x-cron-secret")?.trim() ?? "";
      if (!expected) {
        return fail(
          "Worker endpoint requires CRON_SECRET to be configured or an admin session",
          503,
        );
      }
      // In production a short/guessable shared secret must not be accepted.
      if (process.env.NODE_ENV === "production" && expected.length < 32) {
        return fail("Worker endpoint is not securely configured", 503);
      }
      if (!provided || !secretsMatch(provided, expected)) {
        return fail("Invalid worker credentials", 401);
      }
    }

    // --- Optional batch size override (?limit=25) ---
    const rawLimit = new URL(req.url).searchParams.get("limit");
    const parsed = processDueSchema.safeParse({ limit: rawLimit ?? undefined });
    if (!parsed.success) return fail(firstError(parsed.error), 422);

    const summary = await processDuePosts(parsed.data.limit);

    // Structured log line — counts only, never post content or provider ids.
    console.info("[scheduler] processed due posts", summary);

    return ok(summary, `Processed ${summary.due} due post(s)`);
  });
}