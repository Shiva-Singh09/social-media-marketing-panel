/**
 * Login-abuse helpers (P1 auth hardening, Task 3).
 *
 * Layered on top of the IP-based `login` rate-limit bucket:
 * per-account failed-password tracking with a short, self-expiring
 * temporary delay. An attacker who knows a victim's email can at most force
 * a brief cool-down (LOGIN_LOCK_MS, minutes — not a permanent lockout), and
 * any successful login immediately clears the counter. Google-only accounts
 * (no password) never enter this path.
 */
export const LOGIN_ABUSE_MAX_ATTEMPTS = 8;
export const LOGIN_ABUSE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 10 * 60 * 1000;

/** True when the account is inside an active temporary cool-down. */
export function isLoginLocked(user: {
  failedLoginAttempts?: number | null;
  loginLockUntil?: Date | null;
}): boolean {
  const attempts = user.failedLoginAttempts ?? 0;
  if (attempts < LOGIN_ABUSE_MAX_ATTEMPTS) return false;
  const until = user.loginLockUntil?.getTime() ?? 0;
  return until > Date.now();
}

/**
 * Record a failed password attempt. Returns the post-increment attempt count.
 * Counts consecutive failures only: a stale window restarts at 1. The lock
 * timestamp is set (not stacked) when the threshold is reached. Best-effort
 * save — its caller treats persistence failure as non-fatal so a DB hiccup
 * never converts login into a 500.
 */
export async function noteFailedLogin(user: {
  failedLoginAttempts?: number | null;
  loginLockUntil?: Date | null;
  updatedAt?: Date;
  save: () => Promise<unknown>;
}): Promise<number> {
  const now = Date.now();
  const windowStart = now - LOGIN_ABUSE_WINDOW_MS;
  const lastWrite = user.updatedAt?.getTime() ?? 0;
  // An expired cool-down fully closes: the next failure starts a fresh window
  // at 1 instead of immediately re-locking. Without this, one request per
  // lock period could hold an account shut forever (lockout DoS).
  const lockExpired = (user.loginLockUntil?.getTime() ?? 0) <= now && (user.failedLoginAttempts ?? 0) >= LOGIN_ABUSE_MAX_ATTEMPTS;
  const attempts = lockExpired || lastWrite < windowStart ? 1 : (user.failedLoginAttempts ?? 0) + 1;
  user.failedLoginAttempts = attempts;
  if (lockExpired) user.loginLockUntil = null;
  if (attempts >= LOGIN_ABUSE_MAX_ATTEMPTS) {
    user.loginLockUntil = new Date(now + LOGIN_LOCK_MS);
  }
  await user.save();
  return attempts;
}

/** Clear the counter after a successful password login. Best-effort. */
export async function resetLoginAbuse(user: {
  failedLoginAttempts?: number | null;
  loginLockUntil?: Date | null;
  save: () => Promise<unknown>;
}): Promise<void> {
  if ((user.failedLoginAttempts ?? 0) === 0 && !user.loginLockUntil) return;
  user.failedLoginAttempts = 0;
  user.loginLockUntil = null;
  await user.save();
}
