import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_COOKIE_NAME,
  createAuthToken,
  isRequestAuthenticated,
  passwordMatches,
  verifyAuthToken,
} from "../lib/auth.ts";
import {
  clearFailedLogins,
  loginRateLimitStatus,
  recordFailedLogin,
} from "../lib/login-rate-limit.ts";

const TEST_NOW = Date.UTC(2026, 7, 13, 12, 0, 0);

test("the shared password and signed session token unlock protected requests", async () => {
  process.env.RABBIT_HOLE_PASSWORD = "test-password";
  process.env.RABBIT_HOLE_AUTH_SECRET = "test-only-signing-secret";
  delete process.env.RABBIT_HOLE_AUTH_DISABLED;

  assert.equal(await passwordMatches("test-password"), true);
  assert.equal(await passwordMatches("wrong"), false);

  const token = await createAuthToken(TEST_NOW);
  assert.equal(await verifyAuthToken(token, TEST_NOW), true);
  assert.equal(await verifyAuthToken(`${token}tampered`, TEST_NOW), false);
  assert.equal(await verifyAuthToken(token, TEST_NOW + 8 * 24 * 60 * 60 * 1000), false);

  const request = new Request("https://rabbit-hole.example/api/chat", {
    headers: { cookie: `${AUTH_COOKIE_NAME}=${token}` },
  });
  assert.equal(await isRequestAuthenticated(request), true);
});

test("auth can be disabled explicitly for local testing", async () => {
  process.env.RABBIT_HOLE_AUTH_DISABLED = "1";
  const request = new Request("http://localhost:3000/api/chat");
  assert.equal(await isRequestAuthenticated(request), true);
  delete process.env.RABBIT_HOLE_AUTH_DISABLED;
});

test("failed password attempts are limited and can be cleared after login", () => {
  const key = `test-${crypto.randomUUID()}`;
  assert.deepEqual(loginRateLimitStatus(key, TEST_NOW), {
    limited: false,
    remaining: 5,
    retryAfterSeconds: 0,
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    recordFailedLogin(key, TEST_NOW);
  }

  assert.equal(loginRateLimitStatus(key, TEST_NOW).limited, true);
  clearFailedLogins(key);
  assert.equal(loginRateLimitStatus(key, TEST_NOW).remaining, 5);
});
