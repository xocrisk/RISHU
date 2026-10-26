import test from "node:test";
import assert from "node:assert/strict";
import { completeActivity, learningStats, parseProgress } from "../src/app/account/learning-progress.ts";

test("repeating a lesson or quiz never awards extra XP", () => {
  let state = parseProgress(null);
  for (let attempt = 0; attempt < 3; attempt++) {
    state = completeActivity(state, "completed", "hammer");
    state = completeActivity(state, "quizzes", "candlestick");
  }
  assert.deepEqual(learningStats(state, [{ id: "hammer" }, { id: "doji" }]), { completed: 1, xp: 40, level: 1, percent: 50 });
  assert.deepEqual(parseProgress(JSON.stringify(state)), state);
});

test("invalid storage and removed lessons cannot inflate progress", () => {
  for (const raw of [null, "broken", "null", "42", "{}"])
    assert.deepEqual(parseProgress(raw), { completed: [], quizzes: [] });
  const state = parseProgress(JSON.stringify({ completed: ["hammer", "hammer", "removed", 3], quizzes: ["unknown", "chart", "chart"] }));
  assert.deepEqual(learningStats(state, [{ id: "hammer" }]), { completed: 1, xp: 40, level: 1, percent: 100 });
  assert.equal(learningStats(state, []).percent, 0);
});
