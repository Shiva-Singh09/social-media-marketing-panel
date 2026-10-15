import { User } from "@/db";
import { fail, handle, ok } from "@/lib/api";
import { comparePassword, setSessionCookie, signToken, toSafeUser } from "@/lib/auth";
import {
  isLoginLocked,
  noteFailedLogin,
  resetLoginAbuse,
} from "@/lib/login-abuse";
import { limitOrFail } from "@/lib/rate-limit";
import { ensureSeeded } from "@/lib/seed";
import { firstError, loginSchema } from "@/lib/validators";

/**
 * Static bcrypt digest used ONLY to equalize response timing on the
 * unknown-email path below. It is the cost-12 hash of a throwaway string —
 * not a credential, not a secret, and no comparison against it can ever
 * authenticate anyone (the route returns the generic 401 either way).
 */
const DUMMY_BCRYPT_HASH = "$2b$12$yGbz41MdMTXw.3tgt8NyeeWusPWDbM1IjcVtgiWaJBWKHv3n1k54u";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handle(async () => {
    await ensureSeeded();
    const limited = await limitOrFail(req, "login");
    if (limited) return fail(limited, 429);

    const parsed = loginSchema.safeParse(await req.json());
    if (!parsed.success) return fail(firstError(parsed.error), 422);
    const { email, password } = parsed.data;

    const user = await User.findOne({ email: email.toLowerCase() });
    // Anti-enumeration: unknown emails return the same generic 401 as a
    // password mismatch, and one real bcrypt comparison is burned on this
    // path too so response TIMING cannot distinguish "no such account" from
    // "wrong password" (the known-account path always runs a real compare).
    // No per-account tracking is possible here (there is no account), and
    // IP-based `login` rate limiting above already applies.
    if (!user) {
      await comparePassword(password, DUMMY_BCRYPT_HASH);
      return fail("Invalid email or password", 401);
    }
    if (user.status === "blocked") return fail("Your account has been blocked", 403);

    // Temporary per-account cool-down (Task 3). The response stays the same
    // generic 401 so callers cannot distinguish "wrong password" from
    // "cooling down" — and therefore cannot oracle account existence either.
    if (isLoginLocked(user)) return fail("Invalid email or password", 401);

    // Google-only accounts have no password; treat exactly like a mismatch.
    const valid = await comparePassword(password, user.password ?? null);
    if (!valid) {
      // Best-effort: a persistence failure here must never turn login into
      // a 500 (that would be a worse availability posture than skipping the
      // counter write). The IP bucket is the primary defense regardless.
      try {
        await noteFailedLogin(user);
      } catch {
        console.error("[login] abuse-counter write failed");
      }
      return fail("Invalid email or password", 401);
    }

    // Success clears any accumulated failures (also best-effort), so a
    // legitimate user is never stuck behind a stale counter.
    try {
      await resetLoginAbuse(user);
    } catch {
      console.error("[login] abuse-counter reset failed");
    }

    user.lastLogin = new Date();
    await user.save();

    const token = await signToken({
      sub: String(user._id),
      email: user.email,
      role: user.role === "admin" ? "admin" : "user",
      sv: user.sessionVersion ?? 0,
    });
    await setSessionCookie(token);

    // The JWT lives only in the httpOnly cookie — returning it in the JSON
    // body as well would let any page script read it, defeating httpOnly.
    return ok({ user: toSafeUser(user) }, "Signed in successfully");
  });
}
