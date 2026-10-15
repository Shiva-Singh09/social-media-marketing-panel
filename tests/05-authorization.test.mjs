// Runs with SMM_TEST_MOCK_AUTH=1 (set by tests/run.mjs) so @/lib/auth and
// next/headers resolve to the deterministic role-aware stubs in module-hooks.mjs.
import test from "node:test";
import assert from "assert/strict";
import { requireAdmin, requireUser, SESSION_COOKIE } from "@/lib/auth";

test("session cookie name is stable and not a secret value", () => {
  assert.equal(SESSION_COOKIE, "smm_token");
});

test("unauthenticated request to an admin endpoint is rejected (401)", async () => {
  delete globalThis.__SMM_TEST__;
  await assert.rejects(requireAdmin(), (err) => err.status === 401);
});

test("non-admin access is rejected (403)", async () => {
  globalThis.__SMM_TEST__ = { admin: { _id: "u1", role: "user" } };
  await assert.rejects(requireAdmin(), (err) => err.status === 403);
});

test("valid admin access passes the gate", async () => {
  const admin = { _id: "a1", role: "admin" };
  globalThis.__SMM_TEST__ = { admin };
  const got = await requireAdmin();
  assert.equal(got, admin);
});

test("unauthenticated user endpoint is rejected (401)", async () => {
  delete globalThis.__SMM_TEST__;
  await assert.rejects(requireUser(), (err) => err.status === 401);
});

test("authenticated user passes requireUser", async () => {
  const user = { _id: "u2", role: "user" };
  globalThis.__SMM_TEST__ = { admin: user, currentUser: user };
  assert.equal(await requireUser(), user);
  delete globalThis.__SMM_TEST__;
});
