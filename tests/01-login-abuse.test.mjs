import test from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_ABUSE_MAX_ATTEMPTS,
  LOGIN_ABUSE_WINDOW_MS,
  LOGIN_LOCK_MS,
  isLoginLocked,
  noteFailedLogin,
  resetLoginAbuse,
} from "@/lib/login-abuse";

/** Minimal user double with a save() recorder. */
function fakeUser(fields = {}) {
  return {
    failedLoginAttempts: 0,
    loginLockUntil: null,
    updatedAt: new Date(),
    save: async () => {},
    ...fields,
  };
}

test("thresholds are short/temporary by design (no permanent lockout)", () => {
  assert.equal(LOGIN_ABUSE_MAX_ATTEMPTS, 8);
  assert.equal(LOGIN_ABUSE_WINDOW_MS, 15 * 60 * 1000);
  assert.equal(LOGIN_LOCK_MS, 10 * 60 * 1000);
});

test("fresh account is not locked", () => {
  assert.equal(isLoginLocked(fakeUser()), false);
});

test("below-threshold failures never lock", () => {
  assert.equal(isLoginLocked(fakeUser({ failedLoginAttempts: LOGIN_ABUSE_MAX_ATTEMPTS - 1 })), false);
});

test("reaching the threshold triggers a temporary lock", async () => {
  const user = fakeUser();
  let attempts = 0;
  for (let i = 0; i < LOGIN_ABUSE_MAX_ATTEMPTS; i += 1) {
    attempts = await noteFailedLogin(user);
  }
  assert.equal(attempts, LOGIN_ABUSE_MAX_ATTEMPTS);
  assert.equal(isLoginLocked(user), true);
  const remainingMs = user.loginLockUntil.getTime() - Date.now();
  assert.ok(remainingMs > 0 && remainingMs <= LOGIN_LOCK_MS + 1000, "lock must be finite/expiring");
});

test("expired lock no longer blocks the account", () => {
  assert.equal(
    isLoginLocked(
      fakeUser({ failedLoginAttempts: LOGIN_ABUSE_MAX_ATTEMPTS, loginLockUntil: new Date(Date.now() - 1) }),
    ),
    false,
  );
});

test("a failure after an expired lock restarts at 1 (no instant re-lock DoS)", async () => {
  const user = fakeUser({
    failedLoginAttempts: LOGIN_ABUSE_MAX_ATTEMPTS,
    loginLockUntil: new Date(Date.now() - 1),
  });
  const attempts = await noteFailedLogin(user);
  assert.equal(attempts, 1);
  assert.equal(user.loginLockUntil, null);
});

test("stale window (last write older than window) restarts at 1", async () => {
  const user = fakeUser({
    failedLoginAttempts: 7,
    updatedAt: new Date(Date.now() - LOGIN_ABUSE_WINDOW_MS - 1000),
  });
  assert.equal(await noteFailedLogin(user), 1);
});

test("consecutive failures within the window increment", async () => {
  const user = fakeUser({ failedLoginAttempts: 3 });
  assert.equal(await noteFailedLogin(user), 4);
  assert.equal(user.failedLoginAttempts, 4);
});

test("successful login resets failed-attempt tracking", async () => {
  const user = fakeUser({
    failedLoginAttempts: LOGIN_ABUSE_MAX_ATTEMPTS,
    loginLockUntil: new Date(Date.now() + LOGIN_LOCK_MS),
  });
  await resetLoginAbuse(user);
  assert.equal(user.failedLoginAttempts, 0);
  assert.equal(user.loginLockUntil, null);
  assert.equal(isLoginLocked(user), false);
});

test("reset is a no-op for a clean account", async () => {
  let saved = 0;
  const user = fakeUser({ save: async () => { saved += 1; } });
  await resetLoginAbuse(user);
  assert.equal(saved, 0);
});
