import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidEmail,
  normalizeIndianMobile,
  normalizeLoginIdentifier,
  parseRupees,
  STARTING_PRACTICE_BALANCE_PAISE,
} from "../dist/index.js";

test("parses rupees into integer paise without floating-point arithmetic", () => {
  assert.equal(parseRupees("1512.40"), 151240);
  assert.equal(parseRupees("0.01"), 1);
  assert.equal(parseRupees("-1.25"), -125);
});

test("defines the practice balance as integer paise", () => {
  assert.equal(STARTING_PRACTICE_BALANCE_PAISE, 10_000_000);
});

test("rejects invalid precision and unsafe amounts", () => {
  assert.throws(() => parseRupees("1.001"), RangeError);
  assert.throws(() => parseRupees("not money"), RangeError);
  assert.throws(() => parseRupees("90071992547410"), RangeError);
});

test("normalizes Indian mobile numbers and validates login identifiers", () => {
  assert.equal(normalizeIndianMobile("+91 98765-43210"), "9876543210");
  assert.equal(normalizeIndianMobile("09876543210"), "9876543210");
  assert.equal(normalizeIndianMobile("5123456789"), null);
  assert.equal(normalizeLoginIdentifier(" USER@COLLEGE.AC.IN "), "user@college.ac.in");
  assert.equal(normalizeLoginIdentifier("not-an-identifier"), null);
  assert.equal(isValidEmail("user@college.ac.in"), true);
  assert.equal(isValidEmail("user@college"), false);
});