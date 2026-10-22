import assert from "node:assert/strict";
import test from "node:test";
import { lastSessionClose, marketStatus } from "../dist/market/hours.js";

const ist = (value) => new Date(`${value}+05:30`);

test("NSE is open from 09:15 to 15:30 IST on trading days", () => {
  assert.equal(marketStatus(ist("2026-10-16T09:14:59")).isOpen, false);
  assert.equal(marketStatus(ist("2026-10-16T09:15:00")).isOpen, true);
  assert.equal(marketStatus(ist("2026-10-16T15:29:59")).isOpen, true);
  assert.equal(marketStatus(ist("2026-10-16T15:30:00")).isOpen, false);
  assert.deepEqual(marketStatus(ist("2026-10-16T10:00:00")).nextChangeAt, ist("2026-10-16T15:30:00"));
});

test("weekends and NSE holidays are closed and point at the next session", () => {
  const weekend = marketStatus(ist("2026-10-17T11:00:00"));
  assert.equal(weekend.reason, "Weekend");
  assert.deepEqual(weekend.nextChangeAt, ist("2026-10-19T09:15:00"));

  const holiday = marketStatus(ist("2026-10-20T10:00:00"));
  assert.equal(holiday.reason, "NSE holiday: Dussehra");
  assert.deepEqual(holiday.nextChangeAt, ist("2026-10-21T09:15:00"));

  // Monday evening skips Tuesday's holiday.
  assert.deepEqual(marketStatus(ist("2026-10-19T16:00:00")).nextChangeAt, ist("2026-10-21T09:15:00"));
});

test("lastSessionClose finds the most recent completed session", () => {
  assert.deepEqual(lastSessionClose(ist("2026-10-17T11:00:00")), ist("2026-10-16T15:30:00"));
  assert.deepEqual(lastSessionClose(ist("2026-10-19T10:00:00")), ist("2026-10-16T15:30:00"));
  assert.deepEqual(lastSessionClose(ist("2026-10-20T12:00:00")), ist("2026-10-19T15:30:00"));
});
