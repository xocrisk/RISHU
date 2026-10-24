import assert from "node:assert/strict";
import test from "node:test";
import { createAuthSession } from "../src/lib/auth-session.ts";

function device(t, native = false) {
  const storage = new Map();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { Capacitor: { isNativePlatform: () => native } } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  } });
  t.after(() => {
    for (const [key, descriptor] of [["window", originalWindow], ["localStorage", originalStorage]]) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  return storage;
}

test("login reports connection failures without marking the device signed in", async (t) => {
  const storage = device(t);
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError("Failed to fetch"); });
  const result = await createAuthSession("/v1/auth/login", {});
  assert.equal(result.success, false);
  assert.match(result.message, /connection/i);
  assert.equal(storage.has("xocrisk.signedIn"), false);
});

for (const body of ["<html>Bad gateway</html>", "null", ""]) {
  test(`login handles an unavailable API response: ${JSON.stringify(body)}`, async (t) => {
    const storage = device(t);
    t.mock.method(globalThis, "fetch", async () => new Response(body, { status: 503 }));
    const result = await createAuthSession("/v1/auth/login", {});
    assert.equal(result.success, false);
    assert.match(result.message, /temporarily unavailable/i);
    assert.equal(storage.has("xocrisk.signedIn"), false);
  });
}

test("login preserves the API's incorrect-password message", async (t) => {
  device(t);
  const message = "Mobile number, email, or password is incorrect.";
  t.mock.method(globalThis, "fetch", async () => Response.json({ message }, { status: 401 }));
  assert.deepEqual(await createAuthSession("/v1/auth/login", {}), { success: false, message });
});

for (const native of [false, true]) {
  test(`successful ${native ? "app" : "web"} login uses the correct session transport`, async (t) => {
    const storage = device(t, native);
    const payload = { identifier: "user@example.com", password: "a-long-password" };
    t.mock.method(globalThis, "fetch", async (url, init) => {
      assert.ok(url.endsWith("/v1/auth/login/"));
      assert.equal(init.credentials, "include");
      assert.equal(init.headers.get("X-XOCRISK-Client"), native ? "app" : null);
      assert.deepEqual(JSON.parse(init.body), payload);
      assert.ok(init.signal instanceof AbortSignal);
      return Response.json({ user: { email: payload.identifier }, ...(native ? { token: "app-session" } : {}) });
    });
    assert.deepEqual(await createAuthSession("/v1/auth/login", payload), { success: true, email: payload.identifier });
    assert.equal(storage.get("xocrisk.signedIn"), "1");
    assert.equal(storage.get("xocrisk.app.token"), native ? "app-session" : undefined);
  });
}
