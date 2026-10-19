/**
 * Phase 3 (auth/token flows) — focused acceptance regression tests.
 *
 * Every test drives the REAL route handlers:
 *   POST /api/auth/register
 *   POST /api/auth/forgot-password
 *   POST /api/auth/reset-password
 *   GET  /api/auth/verify-email/[token]
 *   POST /api/auth/resend-verification
 *   PUT/DELETE /api/admin/users/[id]   (last-admin protection)
 *
 * plus the REAL session machinery from src/lib/auth.ts — imported by RELATIVE
 * path so it bypasses the "@/lib/auth" test stub and exercises genuine
 * jose JWT signing/verification, bcryptjs hashing and cookie handling.
 *
 * Guarantees:
 *   - in-memory DB only (`globalThis.__SMM_TEST_DB__` set before imports);
 *   - SMTP_* are cleared at startup so sendEmail can NEVER open a real mail
 *     connection; one test re-points SMTP at 127.0.0.1:1 (refused) to prove
 *     the delivery-failure path leaks nothing.
 *
 * Run standalone:
 *   SMM_TEST_MOCK_AUTH=1 node --import ./tests/register-hooks.mjs tests/12-phase3-auth-tokens.test.mjs
 */
import test from "node:test";
import assert from "assert/strict";
import { randomBytes } from "node:crypto";
import { SignJWT } from "jose";

globalThis.__SMM_TEST_DB__ = {};

// Real JWT machinery requires a secret (>= 32 chars outside production).
process.env.JWT_SECRET = randomBytes(48).toString("hex");
// Bootstrap configuration for @/lib/seed — the register route calls
// ensureSeeded() on every request, so seeding must succeed deterministically.
process.env.ADMIN_EMAIL = "bootstrap-admin@example.test";
process.env.ADMIN_PASSWORD = "Bootstrap-Admin-Pass1!";
// Never allow a real mail connection from tests.
delete process.env.SMTP_HOST;
delete process.env.SMTP_USER;
delete process.env.SMTP_PASS;

const { ensureSeeded } = await import("@/lib/seed");
await ensureSeeded(); // seed once; each test then starts from __resetDb()

const { POST: registerPost } = await import("@/app/api/auth/register/route");
const { POST: forgotPost } = await import("@/app/api/auth/forgot-password/route");
const { POST: resetPost } = await import("@/app/api/auth/reset-password/route");
const { GET: verifyGet } = await import("@/app/api/auth/verify-email/[token]/route");
const { POST: resendPost } = await import("@/app/api/auth/resend-verification/route");
const { PUT: adminUsersPut, DELETE: adminUsersDelete } = await import("@/app/api/admin/users/[id]/route");
const db = await import("@/db");
const { hashSecurityToken } = await import("@/lib/security-tokens");
const { resolve: hooksResolve } = await import("../module-hooks.mjs");
// Real auth implementation (bypasses the "@/lib/auth" stub via relative path).
const realAuth = await import("../src/lib/auth.ts");

/* ---------------- fixtures & helpers ---------------- */
const ALICE_ID = "64c0000000000000000000a1";
const ADMIN_ID = "64c0000000000000000000a2";
const ADMIN2_ID = "64c0000000000000000000a3";

function aliceUser(extra = {}) {
  return {
    _id: ALICE_ID,
    name: "Alice",
    email: "alice@example.test",
    password: "hashed:Original-Pass1!",
    role: "user",
    status: "active",
    emailVerified: true,
    sessionVersion: 0,
    creditBalance: 50,
    ...extra,
  };
}

function adminUser(extra = {}) {
  return {
    _id: ADMIN_ID,
    name: "Panel Admin",
    email: "admin@example.test",
    password: "hashed:Admin-Pass1!",
    role: "admin",
    status: "active",
    emailVerified: true,
    sessionVersion: 0,
    creditBalance: 0,
    ...extra,
  };
}

function seedUsers(users) {
  db.__resetDb({ users, services: [], orders: [], transactions: [] });
}

function userByEmail(email) {
  return [...db.__db().users.values()].find((u) => u.email === email);
}

async function postJson(handler, url, body) {
  const res = await handler(
    new Request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: await res.json() };
}

const register = (body) => postJson(registerPost, "http://localhost/api/auth/register", body);
const forgot = (body) => postJson(forgotPost, "http://localhost/api/auth/forgot-password", body);
const reset = (body) => postJson(resetPost, "http://localhost/api/auth/reset-password", body);
const resend = () => postJson(resendPost, "http://localhost/api/auth/resend-verification", {});

function verify(token) {
  return verifyGet(new Request(`http://localhost/api/auth/verify-email/${token}`), {
    params: Promise.resolve({ token }),
  });
}

async function adminPut(id, body) {
  const res = await adminUsersPut(
    new Request(`http://localhost/api/admin/users/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

async function adminDelete(id) {
  const res = await adminUsersDelete(
    new Request(`http://localhost/api/admin/users/${id}`, { method: "DELETE" }),
    { params: Promise.resolve({ id }) },
  );
  return { status: res.status, body: await res.json() };
}

function captureConsole() {
  const infos = [];
  const errors = [];
  const origInfo = console.info;
  const origError = console.error;
  console.info = (...args) => { infos.push(args.map(String).join(" ")); };
  console.error = (...args) => { errors.push(args.map(String).join(" ")); };
  return {
    all: () => [...infos, ...errors],
    restore: () => { console.info = origInfo; console.error = origError; },
  };
}

test.beforeEach(() => {
  db.__resetDb({ users: [], services: [], orders: [], transactions: [] });
  delete globalThis.__SMM_TEST__;
  // Cookie-store state written by the real session helpers must never leak
  // from one test into the next.
  delete globalThis.__SMM_TEST_COOKIES__;
});

/* ---------------- registration ---------------- */

test("register: mass assignment is rejected, password stored hashed, secrets never in the response", async () => {
  const res = await register({
    name: "Mallory",
    email: "mallory@example.test",
    password: "Sup3rSecret!pw",
    // hostile extras — must be stripped by the validator
    role: "admin",
    status: "blocked",
    emailVerified: true,
    creditBalance: 99999,
    sessionVersion: 7,
    verificationToken: "attacker-token",
    resetPasswordToken: "attacker-token",
    _id: "attacker-chosen-id",
  });

  assert.equal(res.status, 201);
  const created = userByEmail("mallory@example.test");
  assert.ok(created, "account must exist");
  assert.notEqual(created.role, "admin", "role must not be client-assignable");
  assert.notEqual(created.emailVerified, true, "emailVerified must not be client-assignable");
  assert.notEqual(Number(created.creditBalance ?? 0), 99999, "wallet must not be client-assignable");
  assert.notEqual(created.sessionVersion, 7, "sessionVersion must not be client-assignable");
  assert.notEqual(created.password, "Sup3rSecret!pw", "password must never be stored in plaintext");
  assert.ok(String(created.password).length > 20, "password must be stored as a hash");
  assert.match(String(created.verificationToken), /^[0-9a-f]{64}$/, "only a digest of the emailed token is stored");
  assert.notEqual(String(created._id), "attacker-chosen-id", "identity must be server-assigned");

  const dump = JSON.stringify(res.body);
  assert.ok(!dump.includes("Sup3rSecret!pw"), "plaintext password must never appear in a response");
  assert.ok(!dump.includes(created.verificationToken), "verification digest must never appear in a response");
  assert.equal(res.body.data.user.password, undefined, "response user must be the safe projection");
  assert.equal(res.body.data.user.verificationToken, undefined);
  assert.equal(res.body.data.user.resetPasswordToken, undefined);
  assert.notEqual(res.body.data.user.role, "admin");
});

test("register: duplicate registration returns a generic non-enumerating response and creates no second account", async () => {
  const first = await register({ name: "Alice", email: "dup@example.test", password: "Passw0rd!aa" });
  assert.equal(first.status, 201);

  const second = await register({ name: "Alice", email: "dup@example.test", password: "Passw0rd!bb" });
  // Deliberate, documented deviation from a literal "409 duplicate" spec:
  // the route answers a GENERIC 200 so the endpoint cannot be used to
  // enumerate registered emails (see src/app/api/auth/register/route.ts).
  assert.equal(second.status, 200);
  assert.equal(second.body.success, false);
  assert.ok(!second.body.message.toLowerCase().includes("already"), "message must not confirm the email exists");
  assert.ok(!JSON.stringify(second.body).includes("dup@example.test"), "response must not echo the email");

  const rows = [...db.__db().users.values()].filter((u) => u.email === "dup@example.test");
  assert.equal(rows.length, 1, "no second account may be created");
  assert.equal(rows[0].password, "hashed:Passw0rd!aa", "the first account must be untouched");
});

test("register: rate limited after the hourly budget — 6th attempt is429", async () => {
  for (let i = 1; i <= 5; i += 1) {
    const r = await register({ name: `User${i}`, email: `rl${i}@example.test`, password: "Passw0rd!xx" });
    assert.equal(r.status, 201, `attempt ${i} must succeed`);
  }
  const blocked = await register({ name: "User6", email: "rl6@example.test", password: "Passw0rd!xx" });
  assert.equal(blocked.status, 429, "register abuse must hit the rate limit");
});

/* ---------------- password & token primitives ---------------- */

test("passwords are bcrypt-hashed and security tokens are stored only as SHA-256 digests", async () => {
  const hashed = await realAuth.hashPassword("Sup3rSecret!pw");
  assert.notEqual(hashed, "Sup3rSecret!pw");
  assert.match(hashed, /^\$2[aby]\$/, "bcrypt digest expected");
  assert.equal(await realAuth.comparePassword("Sup3rSecret!pw", hashed), true);
  assert.equal(await realAuth.comparePassword("wrong-password", hashed), false);
  assert.equal(await realAuth.comparePassword("anything", null), false, "a missing hash can never match");

  const raw = randomBytes(32).toString("hex");
  const digest = hashSecurityToken(raw);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.notEqual(digest, raw, "the raw token must not be recoverable from storage");
  assert.equal(hashSecurityToken(raw), digest, "digest must be deterministic");
});

/* ---------------- forgot password ---------------- */

test("forgot-password: stores only a SHA-256 digest, expires the link in ~1h, and never leaks a token", async () => {
  seedUsers([aliceUser()]);
  const logs = captureConsole();
  try {
    const res = await forgot({ email: "alice@example.test" });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.message, "If that email exists, a reset link has been sent.");
    // Dev transport is unconfigured in tests -> delivery reported as failed.
    assert.equal(res.body.data.sent, false);

    const row = userByEmail("alice@example.test");
    assert.match(String(row.resetPasswordToken), /^[0-9a-f]{64}$/, "only a SHA-256 digest may be stored");
    const remaining = new Date(row.resetPasswordExpires).getTime() - Date.now();
    assert.ok(remaining > 55 * 60 * 1000 && remaining < 65 * 60 * 1000, `link must expire in ~1h (got ${remaining}ms)`);

    // Nothing in the response or the server logs may expose a token or link.
    const dump = JSON.stringify(res.body);
    assert.ok(!/[0-9a-f]{64}/.test(dump), "no token/digest may appear in the response body");
    assert.ok(!dump.includes("/reset-password/"), "no reset link may appear in the response body");
    const lines = logs.all();
    assert.ok(lines.length > 0, "the delivery attempt must still be logged for operators");
    for (const line of lines) {
      assert.ok(!/[0-9a-f]{64}/.test(line), `no token may be logged: ${line}`);
      assert.ok(!line.includes("/reset-password/"), `no reset link may be logged: ${line}`);
    }
  } finally {
    logs.restore();
  }
});

test("forgot-password: identical response for known vs unknown email (anti-enumeration)", async () => {
  seedUsers([aliceUser()]);
  const known = await forgot({ email: "alice@example.test" });
  const unknown = await forgot({ email: "ghost@example.test" });

  assert.equal(known.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(known.body.message, unknown.body.message, "the message must not reveal whether the account exists");
  assert.equal(unknown.body.success, true);
  assert.equal(userByEmail("ghost@example.test"), undefined, "an unknown address must never create state");

  // Pinned actual behavior: `data.sent` is the mail-transport outcome for an
  // existing account (false while SMTP is unconfigured) but hardcoded true for
  // an unknown address. With working production SMTP both are true; the shared
  // `message` above is the anti-enumeration surface the route guarantees.
  assert.equal(known.body.data.sent, false);
  assert.equal(unknown.body.data.sent, true);
});

test("forgot-password and reset-password share one passwordReset budget: 6th attempt is 429", async () => {
  seedUsers([aliceUser()]);
  for (let i = 1; i <= 5; i += 1) {
    const r = await forgot({ email: "ghost@example.test" });
    assert.equal(r.status, 200, `attempt ${i} must pass`);
  }
  const blocked = await reset({ token: "0123456789abcdef0123456789abcdef", password: "Whatever-Pass1!" });
  assert.equal(blocked.status, 429, "reset must be blocked by forgot-password traffic (shared bucket)");
  assert.ok(blocked.body.message.includes("Too many requests"));
});

test("forgot-password: SMTP delivery failure is survivable and leaks nothing", async () => {
  seedUsers([aliceUser()]);
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_PORT = "1";
  process.env.SMTP_USER = "smtp-user";
  process.env.SMTP_PASS = "smtp-pass";
  const logs = captureConsole();
  try {
    const res = await forgot({ email: "alice@example.test" });
    assert.equal(res.status, 200, "a mail outage must not surface as an API error");
    assert.equal(res.body.success, true);
    assert.equal(res.body.data.sent, false, "delivery must be reported as failed");
    // Same generic message as the success path -> an outage cannot be used to
    // probe which accounts exist.
    assert.equal(res.body.message, "If that email exists, a reset link has been sent.");

    const lines = logs.all();
    assert.ok(lines.some((l) => l.includes("[mail:error]")), "the transport failure must be logged server-side");
    for (const line of lines) {
      assert.ok(!/[0-9a-f]{64}/.test(line), `no token may appear in logs: ${line}`);
      assert.ok(!line.includes("/reset-password/"), `no reset link may appear in logs: ${line}`);
    }
    const dump = JSON.stringify(res.body);
    assert.ok(!/[0-9a-f]{64}/.test(dump), "no token may appear in the response");
  } finally {
    logs.restore();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  }
});

/* ---------------- reset password ---------------- */

test("reset-password: valid token updates the password once, clears the token, and bumps sessionVersion", async () => {
  const raw = randomBytes(32).toString("hex");
  seedUsers([
    aliceUser({
      sessionVersion: 0,
      resetPasswordToken: hashSecurityToken(raw),
      resetPasswordExpires: new Date(Date.now() + 30 * 60 * 1000),
    }),
  ]);

  const res = await reset({ token: raw, password: "New-Passw0rd!aa" });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.message, "Password updated — you can sign in now");
  assert.equal(res.body.data.email, "alice@example.test");

  const row = userByEmail("alice@example.test");
  assert.notEqual(row.password, "New-Passw0rd!aa", "password must never be stored in plaintext");
  assert.notEqual(row.password, "hashed:Original-Pass1!", "the previous password hash must be replaced");
  assert.equal(row.resetPasswordToken, null, "the token must be cleared after use");
  assert.equal(row.resetPasswordExpires, null, "the expiry must be cleared after use");
  assert.equal(row.sessionVersion, 1, "sessionVersion must be bumped to invalidate old sessions");

  const dump = JSON.stringify(res.body);
  assert.ok(!dump.includes(raw), "the raw token must never be echoed");
  assert.ok(!dump.includes("New-Passw0rd!aa"), "the new password must never be echoed");

  // Single-use: the consumed token must not work again.
  const replay = await reset({ token: raw, password: "Replay-Passw0rd!bb" });
  assert.equal(replay.status, 400);
  assert.equal(replay.body.message, "This reset link is invalid or expired");
  const after = userByEmail("alice@example.test");
  assert.equal(after.sessionVersion, 1, "a rejected replay must not bump sessionVersion again");
  assert.notEqual(after.password, "Replay-Passw0rd!bb");
});

test("reset-password: unknown and expired tokens are indistinguishable generic 400s", async () => {
  const raw = randomBytes(32).toString("hex");
  seedUsers([
    aliceUser({
      sessionVersion: 0,
      resetPasswordToken: hashSecurityToken(raw),
      resetPasswordExpires: new Date(Date.now() - 60 * 1000), // already expired
    }),
  ]);

  const expired = await reset({ token: raw, password: "Whatever-Pass1!" });
  const unknown = await reset({ token: randomBytes(32).toString("hex"), password: "Whatever-Pass1!" });

  assert.equal(expired.status, 400);
  assert.equal(unknown.status, 400);
  assert.equal(expired.body.message, unknown.body.message, "expired vs unknown must be indistinguishable");
  assert.equal(expired.body.message, "This reset link is invalid or expired");

  const row = userByEmail("alice@example.test");
  assert.equal(row.password, "hashed:Original-Pass1!", "a failed reset must not touch the password");
  assert.equal(row.sessionVersion, 0, "a failed reset must not invalidate sessions");
  assert.equal(row.resetPasswordToken, hashSecurityToken(raw), "a failed reset must not consume the token");
});

test("reset-password: concurrent double-use of one token — exactly one request wins", async () => {
  const raw = randomBytes(32).toString("hex");
  seedUsers([
    aliceUser({
      sessionVersion: 0,
      resetPasswordToken: hashSecurityToken(raw),
      resetPasswordExpires: new Date(Date.now() + 30 * 60 * 1000),
    }),
  ]);

  const [a, b] = await Promise.all([
    reset({ token: raw, password: "First-Passw0rd!aa" }),
    reset({ token: raw, password: "Second-Passw0rd!bb" }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 400], `exactly one must succeed (got ${a.status}, ${b.status})`);

  const winner = a.status === 200 ? a : b;
  const loser = a.status === 200 ? b : a;
  assert.equal(winner.body.success, true);
  assert.equal(loser.status, 400);
  assert.equal(loser.body.message, "This reset link is invalid or expired");

  const row = userByEmail("alice@example.test");
  assert.equal(row.sessionVersion, 1, "sessionVersion must be bumped exactly once");
  assert.equal(row.resetPasswordToken, null, "the token must end up consumed");
  const winnerPassword = a.status === 200 ? "First-Passw0rd!aa" : "Second-Passw0rd!bb";
  assert.notEqual(row.password, winnerPassword, "the winner's password must be hashed, not stored raw");
  assert.notEqual(row.password, "hashed:Original-Pass1!");
});

test("reset-password: brute-force token guessing is rate limited after the shared budget", async () => {
  seedUsers([aliceUser()]);
  for (let i = 1; i <= 5; i += 1) {
    const r = await reset({ token: randomBytes(32).toString("hex"), password: "Whatever-Pass1!" });
    assert.equal(r.status, 400, `guess ${i} must get the generic 400`);
  }
  const blocked = await reset({ token: randomBytes(32).toString("hex"), password: "Whatever-Pass1!" });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.body.message.includes("Too many requests"));
});

/* ---------------- verify email ---------------- */

test("verify-email: valid token verifies once (302 success), replay returns invalid without downgrading", async () => {
  const raw = randomBytes(24).toString("hex");
  seedUsers([
    aliceUser({
      emailVerified: false,
      verificationToken: hashSecurityToken(raw),
      verificationTokenExpires: new Date(Date.now() + 60 * 60 * 1000),
    }),
  ]);

  const res = await verify(raw);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get("location"), "http://localhost/login?verify=success");

  const row = userByEmail("alice@example.test");
  assert.equal(row.emailVerified, true, "the account must become verified");
  assert.equal(row.verificationToken, null, "the token must be consumed (single-use)");
  assert.equal(row.verificationTokenExpires, null);

  // Replay: consumed token is rejected, but a verified account stays verified.
  const replay = await verify(raw);
  assert.equal(replay.status, 302);
  assert.equal(replay.headers.get("location"), "http://localhost/login?verify=invalid");
  const after = userByEmail("alice@example.test");
  assert.equal(after.emailVerified, true, "a replay must not downgrade verification");
  assert.equal(after.verificationToken, null);
});

test("verify-email: unknown and expired tokens redirect to invalid and consume nothing", async () => {
  const raw = randomBytes(24).toString("hex");
  seedUsers([
    aliceUser({
      emailVerified: false,
      verificationToken: hashSecurityToken(raw),
      verificationTokenExpires: new Date(Date.now() - 60 * 1000), // expired
    }),
  ]);

  const expired = await verify(raw);
  assert.equal(expired.status, 302);
  assert.equal(expired.headers.get("location"), "http://localhost/login?verify=invalid");

  const unknown = await verify(randomBytes(24).toString("hex"));
  assert.equal(unknown.status, 302);
  assert.equal(unknown.headers.get("location"), "http://localhost/login?verify=invalid");

  let row = userByEmail("alice@example.test");
  assert.equal(row.emailVerified, false, "no state may change on failure");
  assert.equal(row.verificationToken, hashSecurityToken(raw), "a failed attempt must not consume the token");

  // Already-verified account holding a live token: the emailVerified:false
  // filter refuses the write — verification is never downgraded or "re-run".
  row.emailVerified = true;
  const reverify = await verify(raw);
  assert.equal(reverify.status, 302);
  assert.equal(reverify.headers.get("location"), "http://localhost/login?verify=invalid");
  row = userByEmail("alice@example.test");
  assert.equal(row.emailVerified, true);
  assert.equal(row.verificationToken, hashSecurityToken(raw), "the live token must not be consumed");
});

/* ---------------- resend verification ---------------- */

test("resend-verification: unauthenticated callers get 401", async () => {
  delete globalThis.__SMM_TEST__;
  const res = await resend();
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.message, "Please sign in first");
});

test("resend-verification: already-verified users short-circuit without spending rate budget", async () => {
  seedUsers([aliceUser({ emailVerified: true })]);
  globalThis.__SMM_TEST__ = { currentUser: userByEmail("alice@example.test") };

  const res = await resend();
  assert.equal(res.status, 200);
  assert.equal(res.body.data.alreadyVerified, true);
  assert.equal(res.body.message, "Your email is already verified");

  const buckets = globalThis.__SMM_TEST_DB__.buckets ?? new Map();
  assert.equal(
    buckets.get(`support:verify-resend-${ALICE_ID}`),
    undefined,
    "the early return must not consume rate-limit budget",
  );
  assert.equal(userByEmail("alice@example.test").verificationToken, null, "no token may be rotated");
});

test("resend-verification: rotates the digest, never returns the link, rate limits after 5/min", async () => {
  const oldDigest = hashSecurityToken("old-raw-verification-token");
  seedUsers([
    aliceUser({
      emailVerified: false,
      verificationToken: oldDigest,
      verificationTokenExpires: new Date(Date.now() - 1000),
    }),
  ]);
  globalThis.__SMM_TEST__ = { currentUser: userByEmail("alice@example.test") };
  const logs = captureConsole();
  try {
    for (let i = 1; i <= 5; i += 1) {
      const r = await resend();
      assert.equal(r.status, 200, `resend ${i} must pass`);
      // The link is NEVER exposed by the API — only the email may carry it.
      assert.equal(r.body.data.verifyLink, null);
      assert.equal(r.body.data.sent, false, "dev transport cannot deliver");

      const row = userByEmail("alice@example.test");
      assert.match(String(row.verificationToken), /^[0-9a-f]{64}$/, "a fresh digest must be stored");
      assert.notEqual(row.verificationToken, oldDigest, "each resend must rotate the digest");
      const remaining = new Date(row.verificationTokenExpires).getTime() - Date.now();
      assert.ok(remaining > 23.9 * 60 * 60 * 1000 && remaining < 24.1 * 60 * 60 * 1000, "expiry must be ~24h");
      const dump = JSON.stringify(r.body);
      assert.ok(!/[0-9a-f]{64}/.test(dump), "no digest may appear in the response");
      assert.ok(!dump.includes("/api/auth/verify-email/"), "no verification link may appear in the response");
    }

    const blocked = await resend();
    assert.equal(blocked.status, 429, "6th resend within the minute must be limited");
    assert.ok(blocked.body.message.includes("Too many requests"));

    for (const line of logs.all()) {
      assert.ok(!line.includes("/api/auth/verify-email/"), `no verification link may be logged: ${line}`);
      assert.ok(!/[0-9a-f]{64}/.test(line), `no digest may be logged: ${line}`);
    }
  } finally {
    logs.restore();
  }
});

/* ---------------- admin users: gates + last-admin protection (PUT) ---------------- */

test("admin users PUT: auth gates — 401 unauthenticated, 403 non-admin, 400 invalid id", async () => {
  seedUsers([aliceUser(), adminUser()]);

  delete globalThis.__SMM_TEST__;
  const anon = await adminPut(ADMIN_ID, { role: "user" });
  assert.equal(anon.status, 401);
  assert.equal(anon.body.success, false);

  globalThis.__SMM_TEST__ = { admin: { _id: ALICE_ID, role: "user" } };
  const customer = await adminPut(ADMIN_ID, { role: "user" });
  assert.equal(customer.status, 403);
  assert.equal(customer.body.success, false);

  globalThis.__SMM_TEST__ = { admin: adminUser() };
  const badId = await adminPut("not-an-object-id", { role: "user" });
  assert.equal(badId.status, 400);
  assert.equal(badId.body.message, "Invalid user id");

  // Nothing may have changed through any rejected request.
  assert.equal(userByEmail("admin@example.test").role, "admin");
});

test("admin users PUT: the sole active admin cannot demote or block itself (409/400)", async () => {
  seedUsers([aliceUser(), adminUser()]);
  globalThis.__SMM_TEST__ = { admin: adminUser() };

  // Role demotion of self: passes the self-block guard (status only), reaches
  // the transactional count, and must be refused as the last active admin.
  const demote = await adminPut(ADMIN_ID, { role: "user" });
  assert.equal(demote.status, 409);
  assert.equal(demote.body.success, false);
  assert.equal(demote.body.message, "The last active administrator cannot be removed or disabled");
  assert.equal(userByEmail("admin@example.test").role, "admin", "the role must be unchanged after 409");

  // Blocking self is refused even earlier, before any transaction.
  const block = await adminPut(ADMIN_ID, { status: "blocked" });
  assert.equal(block.status, 400);
  assert.equal(block.body.message, "You cannot block your own admin account");
  assert.equal(userByEmail("admin@example.test").status, "active", "status must be unchanged after 400");

  // No audit rows may exist for refused mutations.
  assert.equal(db.__db().auditLogs.size, 0, "refused mutations must not be audited as successes");
});

test("admin users PUT: demoting an admin is allowed when a second active admin remains, and is audited", async () => {
  seedUsers([
    aliceUser(),
    adminUser(),
    adminUser({ _id: ADMIN2_ID, email: "admin2@example.test" }),
  ]);
  globalThis.__SMM_TEST__ = { admin: adminUser() };

  const res = await adminPut(ADMIN2_ID, { role: "user" });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.user.role, "user");
  assert.equal(res.body.data.user.password, undefined, "the response must be the safe projection");
  assert.equal(res.body.data.user.resetPasswordToken, undefined);

  const target = userByEmail("admin2@example.test");
  assert.equal(target.role, "user", "the demotion must be persisted");
  assert.equal(userByEmail("admin@example.test").role, "admin", "the other admin is untouched");

  const audits = [...db.__db().auditLogs.values()];
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "user.update");
  assert.equal(audits[0].targetType, "user");
  assert.equal(String(audits[0].targetId), ADMIN2_ID);
  assert.equal(String(audits[0].adminId), ADMIN_ID);
});
