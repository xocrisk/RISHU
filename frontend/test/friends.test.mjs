import test from "node:test";
import assert from "node:assert/strict";
import { friendsOf, isLiveMessage, messageLifetimeMs, reduceFriends, seedFriends, sectionOf } from "../src/app/account/friends/model.ts";

test("friends are sorted naturally; groups initially empty for current user", () => {
  const state = seedFriends();
  assert.equal(friendsOf(state).length, 8);
  assert.equal(state.groups.filter((g) => g.members.includes(state.me.id)).length, 0);
  assert.equal(sectionOf("Friend 1"), "F");
  assert.equal(sectionOf("123"), "#");
});
test("accept and reject incoming requests without duplicate friendships", () => {
  let state = seedFriends();
  const request = state.requests[0];
  state = reduceFriends(state, { type: "respond", requestId: request.id, accept: true });
  assert.equal(friendsOf(state).length, 9);
  assert.throws(() => reduceFriends(state, { type: "respond", requestId: request.id, accept: true }));
  state = reduceFriends(state, { type: "respond", requestId: state.requests[1].id, accept: false });
  assert.equal(friendsOf(state).length, 9);
});
test("request validation rejects self, unknown, existing and pending contacts", () => {
  let state = seedFriends();
  for (const userId of [state.me.id, "UNKNOWN", "FR000001", "FR000009"]) assert.throws(() => reduceFriends(state, { type: "request", userId }));
  state = reduceFriends(state, { type: "request", userId: "FR000011" });
  assert.equal(state.requests.at(-1).to, "FR000011");
  assert.throws(() => reduceFriends(state, { type: "request", userId: "FR000011" }));
});
test("group creation requires friends, deduplicates members and includes creator", () => {
  const state = seedFriends();
  const action = { type: "create-group", id: "NEWGROUP", name: "Group 3", members: [] };
  assert.throws(() => reduceFriends(state, action));
  assert.throws(() => reduceFriends(state, { ...action, members: ["FR000014"] }));
  const next = reduceFriends(state, { ...action, members: ["FR000001", "FR000001", "FR000002"] });
  assert.deepEqual(next.groups.at(-1).members, [state.me.id, "FR000001", "FR000002"]);
  assert.equal(state.groups.length, 2);
});
test("joining is idempotent and nonmembers cannot chat", () => {
  let state = seedFriends();
  const message = { type: "message", thread: "GR000001", text: "Hello", id: "m", createdAt: "2026-01-01" };
  assert.throws(() => reduceFriends(state, message));
  state = reduceFriends(state, { type: "join-group", groupId: "GR000001" });
  state = reduceFriends(state, { type: "join-group", groupId: "GR000001" });
  assert.equal(state.groups[0].members.filter((u) => u === state.me.id).length, 1);
  assert.equal(reduceFriends(state, message).messages.at(-1).text, "Hello");
});
test("removing a friend blocks new messages and preserves existing history", () => {
  const state = reduceFriends(seedFriends(), { type: "remove", userId: "FR000001" });
  assert.equal(friendsOf(state).length, 7);
  assert.ok(state.messages.some((m) => m.thread === "FR000001"));
  assert.throws(() => reduceFriends(state, { type: "message", thread: "FR000001", text: "Hello", id: "m", createdAt: "2026-01-01" }));
});
test("direct messages expire after 24 hours, group messages after 1 hour", () => {
  const sent = Date.parse("2026-10-25T10:00:00Z");
  const message = { id: "m", thread: "t", from: "f", text: "hi", createdAt: new Date(sent).toISOString() };
  assert.equal(messageLifetimeMs.direct, 24 * 60 * 60 * 1000);
  assert.equal(messageLifetimeMs.group, 60 * 60 * 1000);
  assert.equal(isLiveMessage(message, sent + messageLifetimeMs.direct - 1), true);
  assert.equal(isLiveMessage(message, sent + messageLifetimeMs.direct), false);
  const groupMessage = { ...message, group: true };
  assert.equal(isLiveMessage(groupMessage, sent + messageLifetimeMs.group - 1), true);
  assert.equal(isLiveMessage(groupMessage, sent + messageLifetimeMs.group), false);
});
