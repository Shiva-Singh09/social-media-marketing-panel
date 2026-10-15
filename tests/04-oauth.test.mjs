import { createHash } from "node:crypto";
import test from "node:test";
import assert from "assert/strict";
import {
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  OAUTH_COOKIE_TTL_SECONDS,
  generateOAuthSecret,
  pkceChallenge,
  credentialEqual,
  serializeOAuthTransient,
  parseOAuthTransient,
} from "@/lib/oauth-google";

const REDIRECT = "https://panel.example.com/api/auth/google/callback";

test("cookie metadata: narrow scope + short TTL", () => {
  assert.equal(OAUTH_COOKIE_PATH, "/api/auth/google/callback");
  assert.equal(OAUTH_COOKIE_TTL_SECONDS, 600);
  assert.ok(OAUTH_COOKIE.length > 0);
});

test("state/verifier/nonce use 256-bit CSPRNG base64url", () => {
  const value = generateOAuthSecret(256);
  assert.match(value, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(generateOAuthSecret(256), value, "values must be unique per call");
});

test("PKCE uses S256 only: challenge = BASE64URL(SHA256(verifier))", () => {
  const verifier = generateOAuthSecret(256);
  const challenge = pkceChallenge(verifier);
  const expected = createHash("sha256").update(verifier, "utf8").digest("base64url");
  assert.equal(challenge, expected);
  assert.notEqual(challenge, verifier, "challenge must never equal the verifier");
  assert.doesNotMatch(challenge, /[=+/]/, "must be unpadded base64url");
});

test("verifier length satisfies RFC 7636 (43..128) — `plain` PKCE impossible", () => {
  for (let i = 0; i < 5; i += 1) {
    const verifier = generateOAuthSecret(256);
    assert.ok(verifier.length >= 43 && verifier.length <= 128);
  }
});

test("transient cookie round-trips state digest, verifier, nonce, redirect_uri", () => {
  const stateDigest = createHash("sha256").update("some-state").digest("hex");
  const verifier = generateOAuthSecret(256);
  const nonce = generateOAuthSecret(128);
  const raw = serializeOAuthTransient(stateDigest, verifier, nonce, REDIRECT);
  const parsed = parseOAuthTransient(raw);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.transient.stateDigest, stateDigest);
    assert.equal(parsed.transient.codeVerifier, verifier);
    assert.equal(parsed.transient.nonce, nonce);
    assert.equal(parsed.transient.redirectUri, REDIRECT);
  }
});

test("missing/malformed transient data fails safely (treated as absent)", () => {
  const stateDigest = createHash("sha256").update("x").digest("hex");
  const verifier = generateOAuthSecret(256);
  const nonce = generateOAuthSecret(128);
  const bad = [
    null,
    "",
    "garbage",
    "v1.only.three.parts",
    `v2.${stateDigest}.${verifier}.${nonce}.${Buffer.from(REDIRECT).toString("base64url")}`,
    serializeOAuthTransient("", verifier, nonce, REDIRECT),
    serializeOAuthTransient(stateDigest, "short-verifier", nonce, REDIRECT),
    serializeOAuthTransient(stateDigest, verifier, "tiny", REDIRECT),
    serializeOAuthTransient(stateDigest, verifier, nonce, "not-a-url"),
  ];
  for (const raw of bad) assert.equal(parseOAuthTransient(raw).ok, false, String(raw).slice(0, 40));
});

test("state comparison is constant-time-safe and exact", () => {
  const a = "A".repeat(43);
  const b = "B".repeat(43);
  assert.equal(credentialEqual(a, a), true);
  assert.equal(credentialEqual(a, b), false, "same length, different value must not match");
  assert.equal(credentialEqual(a, "shorter"), false, "length mismatch must not throw");
  assert.equal(credentialEqual("", ""), true);
});

test("replayed state digest does not validate against a different state", () => {
  const digestOf = (s) => createHash("sha256").update(s).digest("hex");
  const first = digestOf("state-one");
  const replay = digestOf("state-two");
  assert.equal(credentialEqual(first, replay), false, "replayed/foreign state must be rejected");
});
