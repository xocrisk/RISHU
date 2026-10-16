import assert from "node:assert/strict";
import test from "node:test";
import {
  createOtp,
  hashOtp,
  hashPassword,
  hashSessionToken,
  isAdultOn,
  matchesHash,
  normalizeEmail,
  verifyPassword,
} from "../dist/security.js";

test("normalizes valid email addresses and rejects malformed values", () => {
  assert.equal(normalizeEmail("  Student@College.AC.IN "), "student@college.ac.in");
  assert.equal(normalizeEmail("not-an-email"), null);
});

test("enforces the 18th birthday using UTC calendar dates", () => {
  const today = new Date("2026-10-15T12:00:00.000Z");
  assert.equal(isAdultOn("2008-10-15", today), true);
  assert.equal(isAdultOn("2008-10-16", today), false);
  assert.equal(isAdultOn("2026-02-30", today), false);
});

test("password hashes are salted and verified without accepting unknown accounts", async () => {
  const first = await hashPassword("a-long-password");
  const second = await hashPassword("a-long-password");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("a-long-password", first), true);
  assert.equal(await verifyPassword("wrong-password", first), false);
  assert.equal(await verifyPassword("a-long-password"), false);
});

test("session and email-code digests are stable, scoped, and resistant to malformed inputs", () => {
  const secret = "a-different-secret-with-32-bytes-minimum";
  const token = "opaque-session-token";
  const codeHash = hashOtp("012345", secret);
  assert.equal(hashSessionToken(token, secret), hashSessionToken(token, secret));
  assert.notEqual(hashSessionToken(token, secret), hashSessionToken(token, `${secret}!`));
  assert.equal(matchesHash(codeHash, hashOtp("012345", secret)), true);
  assert.equal(matchesHash(codeHash, hashOtp("012345", `${secret}!`)), false);
  assert.equal(matchesHash("invalid", codeHash), false);
});

test("generates six-digit codes including leading zeroes", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(createOtp(), /^\d{6}$/);
  }
});
