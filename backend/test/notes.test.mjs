import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { buildApp } from "../dist/app.js";
import { hashSessionToken } from "../dist/security.js";

test("shared learning notes enforce admin writes and preserve private notes", async t => {
  const db = new PGlite();
  const secret = "notes-test-session-secret-at-least-32-bytes";
  const admin = "123e4567-e89b-42d3-a456-426614174000";
  const member = "123e4567-e89b-42d3-a456-426614174001";
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated;
    CREATE TABLE users (id uuid PRIMARY KEY, uid text UNIQUE, email text, mobile text, full_name text, college text, deletion_requested_at timestamptz);
    CREATE TABLE auth_sessions (user_id uuid, token_hash text, expires_at timestamptz);
    CREATE TABLE user_notes (id text PRIMARY KEY, user_id uuid, title text, body text);
    INSERT INTO user_notes VALUES ('private', '${member}', 'Private journal', 'Never publish this');
    INSERT INTO users (id, uid) VALUES ('${admin}', 'QVT4QQDG'), ('${member}', 'MEMBER01');
  `);
  for (const migration of ["019_learning_notes.sql", "020_seed_learning_notes.sql", "021_assign_notes_admin.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
  }
  for (const [token, id] of [["admin-token", admin], ["member-token", member]]) {
    await db.query("INSERT INTO auth_sessions VALUES ($1, $2, now() + interval '1 hour')", [id, hashSessionToken(token, secret)]);
  }
  assert.deepEqual((await db.query("SELECT user_id FROM notes_admins")).rows, [{ user_id: admin }]);
  const pool = { query: async (sql, values) => {
    const result = await db.query(sql, values);
    return { rows: result.rows, rowCount: result.rows.length || result.affectedRows || 0 };
  } };
  const app = await buildApp({ pool, config: {
    environment: "test", host: "127.0.0.1", port: 4000, webOrigin: "http://localhost:3000", sessionSecret: secret,
  } });
  t.after(async () => { await app.close(); await db.close(); });
  const request = (token, method, url, payload, extraHeaders = {}) => app.inject({
    method, url, ...(payload === undefined ? {} : { payload }),
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders },
  });

  await t.test("every write rejects guests and non-admins, including forged admin fields", async () => {
    const mutations = [
      ["POST", "/v1/notes", { title: "Injected", body: "Not allowed", canEdit: true, isAdmin: true }],
      ["PUT", "/v1/notes/hammer", { title: "Injected", body: "Not allowed", version: 1, role: "admin" }],
      ["DELETE", "/v1/notes/hammer?version=1"],
    ];
    for (const [token, status] of [[null, 401], ["member-token", 403], ["invalid-token", 401]]) {
      for (const [method, url, payload] of mutations) {
        const response = await request(token, method, url, payload, { "x-admin": "true", "x-user-id": admin });
        assert.equal(response.statusCode, status, `${token}: ${method} ${response.body}`);
      }
    }
    assert.equal((await request(null, "GET", "/v1/notes")).statusCode, 401);
  });

  await t.test("everyone reads the same complete learning content; personal notes stay private", async () => {
    const ordinary = await request("member-token", "GET", "/v1/notes");
    const elevated = await request("admin-token", "GET", "/v1/notes");
    assert.equal(ordinary.statusCode, 200);
    assert.equal(ordinary.headers["cache-control"], "private, no-store");
    const { notes, canEdit } = ordinary.json();
    assert.equal(canEdit, false);
    assert.equal(elevated.json().canEdit, true);
    assert.deepEqual(notes, elevated.json().notes);
    assert.equal(notes.length, 60);
    assert.equal(notes.filter(note => note.category === "foundation").length, 7);
    assert.equal(notes.filter(note => note.category === "candlestick").length, 35);
    assert.equal(notes.filter(note => note.category === "chart").length, 18);
    assert.ok(notes.find(note => note.id === "hammer").illustrations.length);
    assert.ok(!ordinary.body.includes("Never publish this"));
    assert.equal((await db.query("SELECT body FROM user_notes")).rows[0].body, "Never publish this");
  });

  await t.test("admin saves persist for readers, stale saves cannot overwrite changes", async () => {
    const before = (await request("admin-token", "GET", "/v1/notes")).json().notes.find(note => note.id === "hammer");
    const response = await request("admin-token", "PUT", "/v1/notes/hammer", { title: "Hammer explained", body: "Updated learning text", version: before.version });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().note.version, 2);
    assert.deepEqual(response.json().note.illustrations, before.illustrations);
    const visible = (await request("member-token", "GET", "/v1/notes")).json().notes.find(note => note.id === "hammer");
    assert.equal(visible.body, "Updated learning text");
    assert.equal((await db.query("SELECT updated_by FROM learning_notes WHERE id = 'hammer'")).rows[0].updated_by, admin);
    assert.equal((await request("admin-token", "PUT", "/v1/notes/hammer", { title: "Stale", body: "Old", version: 1 })).statusCode, 409);
    assert.equal((await request("admin-token", "DELETE", "/v1/notes/hammer?version=1")).statusCode, 409);
    assert.equal((await request("admin-token", "PUT", "/v1/notes/hammer", { title: " ", body: "", version: 2 })).statusCode, 400);
    assert.equal((await request("admin-token", "PUT", "/v1/notes/hammer", { title: "Valid", body: "x".repeat(10001), version: 2 })).statusCode, 400);
  });

  await t.test("only admins create/delete shared notes; revoking membership takes effect immediately", async () => {
    // The character limit must also work for Hindi text that exceeds the global 16 KB request limit.
    const teachingText = "अ".repeat(9000);
    const created = await request("admin-token", "POST", "/v1/notes", { title: "New lesson", body: teachingText });
    assert.equal(created.statusCode, 201, created.body);
    assert.equal(created.json().note.body, teachingText);
    const { id, version } = created.json().note;
    assert.equal((await request("member-token", "DELETE", `/v1/notes/${id}?version=${version}`)).statusCode, 403);
    assert.equal((await request("admin-token", "DELETE", `/v1/notes/${id}?version=${version}`)).statusCode, 200);
    await db.query("DELETE FROM notes_admins WHERE user_id = $1", [admin]);
    assert.equal((await request("admin-token", "GET", "/v1/notes")).json().canEdit, false);
    assert.equal((await request("admin-token", "POST", "/v1/notes", { title: "Denied", body: "" })).statusCode, 403);
  });

  await t.test("Supabase browser roles cannot edit content or grant themselves admin", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        for (const sql of ["SELECT * FROM notes_admins", `INSERT INTO notes_admins (user_id) VALUES ('${member}')`,
          "UPDATE learning_notes SET body = 'injected'", "DELETE FROM learning_notes"]) {
          await assert.rejects(db.exec(sql), /permission denied/);
        }
      } finally { await db.exec("RESET ROLE"); }
    }
    const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE relname IN ('learning_notes', 'notes_admins')");
    assert.equal(rls.rows.length, 2);
    assert.ok(rls.rows.every(row => row.relrowsecurity));
  });

  await t.test("admin assignment is repeatable and refuses a missing or inactive designated account", async () => {
    const grant = await readFile(new URL("../migrations/021_assign_notes_admin.sql", import.meta.url), "utf8");
    await db.exec(grant);
    await db.exec(grant);
    assert.deepEqual((await db.query("SELECT user_id FROM notes_admins")).rows, [{ user_id: admin }]);
    await db.exec("DELETE FROM notes_admins");
    await db.query("UPDATE users SET deletion_requested_at = now() WHERE id = $1", [admin]);
    await assert.rejects(db.exec(grant), /Active account QVT4QQDG was not found/);
    await db.query("UPDATE users SET deletion_requested_at = NULL, uid = 'OTHERUID' WHERE id = $1", [admin]);
    await assert.rejects(db.exec(grant), /Active account QVT4QQDG was not found/);
    assert.equal((await db.query("SELECT user_id FROM notes_admins")).rows.length, 0);
  });
});
