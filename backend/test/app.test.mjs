import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../dist/app.js";
import { hashOtp, hashPassword, hashSessionToken } from "../dist/security.js";

const sessionSecret = "test-session-secret-with-at-least-32-bytes";
const config = {
  environment: "test",
  host: "127.0.0.1",
  port: 4000,
  webOrigin: "http://localhost:3000",
  databaseUrl: "postgres://unused",
  sessionSecret,
};

function makeApp(pool = {
  query: async () => { throw new Error("Unexpected database query"); },
  connect: async () => { throw new Error("Unexpected database connection"); },
}) {
  return buildApp({ pool, config });
}

test("portfolio reset endpoint is removed", async () => {
  const app = await makeApp();
  try {
    const response = await app.inject({ method: "POST", url: "/v1/practice/reset" });
    assert.equal(response.statusCode, 404);
  } finally { await app.close(); }
});

for (const scenario of ["valid", "invalid", "already-credited", "credit-failed"]) {
  test(`signup referral transaction: ${scenario}`, async () => {
    const statements = [];
    const user = { id: "123e4567-e89b-42d3-a456-426614174000", email: "new@example.com", mobile: "9876543210", full_name: "New User", college: "University" };
    const inviter = "123e4567-e89b-42d3-a456-426614174001";
    const app = await makeApp({
      query: async () => { throw new Error("Unexpected query outside transaction"); },
      connect: async () => ({
        release() {},
        query: async (sql, values = []) => {
          statements.push(sql);
          if (sql.includes("INSERT INTO users")) return { rows: [user] };
          if (sql.includes("SELECT id FROM users WHERE uid")) {
            assert.deepEqual(values, ["AB12CD34", user.id]);
            assert.match(sql, /id <> \$2/);
            return { rows: scenario === "invalid" ? [] : [{ id: inviter }] };
          }
          if (sql.includes("INSERT INTO referral_rewards")) {
            assert.deepEqual(values, [user.id, inviter]);
            assert.match(sql, /ON CONFLICT \(referred_user_id\) DO NOTHING/);
            return { rows: [], rowCount: scenario === "already-credited" ? 0 : 1 };
          }
          if (sql.includes("UPDATE practice_portfolios")) {
            assert.deepEqual(values, [inviter]);
            assert.match(sql, /cash = cash \+ 1000/);
            if (scenario === "credit-failed") throw new Error("Simulated credit failure");
          }
          return { rows: [] };
        },
      }),
    });
    try {
      const response = await app.inject({ method: "POST", url: "/v1/auth/signup", payload: {
        fullName: "New User", email: user.email, mobile: user.mobile, college: "University",
        password: "a-long-password", adultConsent: true, referralUid: "AB12CD34",
      } });
      assert.equal(response.statusCode, scenario === "invalid" ? 400 : scenario === "credit-failed" ? 500 : 201);
      const failed = scenario === "invalid" || scenario === "credit-failed";
      assert.equal(statements.includes("COMMIT"), !failed);
      assert.equal(statements.includes("ROLLBACK"), failed);
      assert.equal(statements.filter((sql) => sql.includes("UPDATE practice_portfolios")).length,
        scenario === "valid" || scenario === "credit-failed" ? 1 : 0);
    } finally { await app.close(); }
  });
}

test("health endpoint is public and does not need database access", async () => {
  const app = await makeApp();
  try {
    const response = await app.inject({ method: "GET", url: "/health" });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("password recovery reports missing email delivery configuration", async () => {
  const app = await makeApp();
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/request",
      payload: { email: "user@example.com" },
    });
    assert.equal(response.statusCode, 503);
    assert.match(response.json().message, /not configured/i);
  } finally {
    await app.close();
  }
});

test("unconfigured OAuth providers return to login with an explicit status", async () => {
  const app = await makeApp();
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/oauth/google/start?returnOrigin=http%3A%2F%2Flocalhost%3A3000",
    });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "http://localhost:3000/login?oauth=unavailable");
  } finally {
    await app.close();
  }
});

test("configured OAuth start uses an allowlisted return origin and PKCE", async () => {
  let insertValues;
  const app = await buildApp({
    pool: {
      query: async (sql, values = []) => {
        if (sql.includes("INSERT INTO oauth_transactions")) insertValues = values;
        return { rows: [] };
      },
      connect: async () => { throw new Error("Unexpected database connection"); },
    },
    config: {
      ...config,
      googleOAuth: {
        clientId: "google-client-id",
        clientSecret: "google-client-secret",
        redirectUri: "http://localhost:4000/v1/auth/oauth/google/callback",
      },
    },
  });
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/oauth/google/start?returnOrigin=http%3A%2F%2Fevil.example",
    });
    const authorization = new URL(response.headers.location);
    assert.equal(response.statusCode, 302);
    assert.equal(authorization.origin, "https://accounts.google.com");
    assert.equal(authorization.searchParams.get("redirect_uri"), "http://localhost:4000/v1/auth/oauth/google/callback");
    assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
    assert.match(response.headers["set-cookie"].join(";"), /HttpOnly/);
    assert.equal(insertValues[5], "http://localhost:3000");
  } finally {
    await app.close();
  }
});

test("practice endpoints reject requests without a PostgreSQL session", async () => {
  const app = await makeApp();
  try {
    const response = await app.inject({ method: "GET", url: "/v1/practice/dashboard" });
    assert.equal(response.statusCode, 401);
    assert.deepEqual(response.json(), { message: "Sign in to continue." });
  } finally {
    await app.close();
  }
});

test("valid opaque session tokens authenticate API requests", async () => {
  const user = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    email: "user@example.com",
    mobile: "9876543210",
    full_name: "A User",
    college: "University",
  };
  const validHash = hashSessionToken("valid-token", sessionSecret);
  const pool = {
    query: async (sql, values = []) => {
      if (sql.includes("FROM auth_sessions")) {
        return { rows: values[0] === validHash ? [user] : [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    connect: async () => { throw new Error("Unexpected database connection"); },
  };
  const app = await makeApp(pool);
  try {
    const response = await app.inject({
      method: "GET",
      url: "/v1/auth/me",
      headers: { cookie: "xocrisk_session=valid-token" },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json().user, {
      id: user.id,
      email: user.email,
      mobile: user.mobile,
      fullName: user.full_name,
      college: user.college,
    });
  } finally {
    await app.close();
  }
});

test("signup creates a hashed-password account and an opaque database session", async () => {
  const userId = "123e4567-e89b-42d3-a456-426614174000";
  const statements = [];
  const pool = {
    query: async () => { throw new Error("Unexpected pool query"); },
    connect: async () => ({
      query: async (sql, values = []) => {
        statements.push(sql);
        if (sql.includes("INSERT INTO users")) {
          assert.equal(values[0], "user@example.com");
          assert.equal(values[1], "9876543210");
          assert.equal(values[3], "A User");
          assert.match(values[2], /^[0-9a-f]{32}:[0-9a-f]{128}$/);
          return {
            rows: [{
              id: userId,
              email: values[0],
              mobile: values[1],
              full_name: values[3],
              college: values[4],
            }],
          };
        }
        if (sql.includes("INSERT INTO auth_sessions")) {
          assert.equal(values[0], userId);
          assert.match(values[1], /^[0-9a-f]{64}$/);
          return { rows: [] };
        }
        return { rows: [] };
      },
      release() {},
    }),
  };
  const app = await makeApp(pool);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/signup",
      payload: {
        fullName: "A User",
        email: "User@Example.com",
        mobile: "9876543210",
        college: "University",
        password: "a-long-password",
        adultConsent: true,
      },
    });
    assert.equal(response.statusCode, 201);
    assert.equal(response.json().user.id, userId);
    assert.match(response.headers["set-cookie"], /HttpOnly/);
    assert.equal(response.json().token, undefined);
    assert.ok(statements.includes("BEGIN"));
    assert.ok(statements.includes("COMMIT"));
  } finally {
    await app.close();
  }
});

test("login checks the stored password hash before issuing a session", async () => {
  let sessionExpiresAt;
  const passwordHash = await hashPassword("a-long-password");
  const user = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    email: "user@example.com",
    mobile: "9876543210",
    full_name: "A User",
    college: "University",
    password_hash: passwordHash,
  };
  const pool = {
    query: async (sql, values = []) => {
      if (sql.includes("FROM users")) {
        assert.equal(values[0], "user@example.com");
        return { rows: [user] };
      }
      if (sql.includes("INSERT INTO auth_sessions")) {
        sessionExpiresAt = values[2];
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    connect: async () => { throw new Error("Unexpected database connection"); },
  };
  const app = await makeApp(pool);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { email: "USER@example.com", password: "a-long-password", rememberMe: true },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["set-cookie"], /HttpOnly/);
    assert.match(response.headers["set-cookie"], /Max-Age=15552000/);
    assert.ok(sessionExpiresAt.getTime() - Date.now() > 29 * 24 * 60 * 60 * 1000);
    assert.equal(response.json().token, undefined);
  } finally {
    await app.close();
  }
});

test("login accepts an Indian mobile number as the account identifier", async () => {
  const passwordHash = await hashPassword("a-long-password");
  const user = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    email: "user@example.com",
    mobile: "9876543210",
    full_name: "A User",
    college: "University",
    password_hash: passwordHash,
  };
  let sessionExpiresAt;
  const pool = {
    query: async (sql, values = []) => {
      if (sql.includes("FROM users")) {
        assert.deepEqual(values, [null, "9876543210"]);
        return { rows: [user] };
      }
      if (sql.includes("INSERT INTO auth_sessions")) {
        sessionExpiresAt = values[2];
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    connect: async () => { throw new Error("Unexpected database connection"); },
  };
  const app = await makeApp(pool);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      payload: { identifier: "+91 98765 43210", password: "a-long-password" },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["set-cookie"], /HttpOnly/);
    assert.doesNotMatch(response.headers["set-cookie"], /Max-Age=/);
    assert.ok(sessionExpiresAt.getTime() - Date.now() < 13 * 60 * 60 * 1000);
  } finally {
    await app.close();
  }
});

test("first-time OAuth identity linking requires and follows password verification", async () => {
  const user = {
    id: "123e4567-e89b-42d3-a456-426614174000",
    email: "user@example.com",
    mobile: "9876543210",
    full_name: "A User",
    college: "University",
    password_hash: await hashPassword("a-long-password"),
  };
  const linked = [];
  const pool = {
    query: async (sql) => {
      if (sql.includes("FROM users")) return { rows: [user] };
      throw new Error(`Unexpected pool query: ${sql}`);
    },
    connect: async () => ({
      query: async (sql, values = []) => {
        if (sql.includes("DELETE FROM oauth_link_attempts")) {
          return { rows: [{ provider: "google", provider_subject: "provider-subject" }] };
        }
        if (sql.includes("INSERT INTO oauth_accounts")) linked.push(values);
        return { rows: [] };
      },
      release() {},
    }),
  };
  const app = await makeApp(pool);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/login",
      headers: { cookie: "xocrisk_oauth_link=opaque-link-token" },
      payload: { identifier: "user@example.com", password: "a-long-password" },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().providerLinked, true);
    assert.deepEqual(linked, [["google", "provider-subject", user.id]]);
    assert.match(response.headers["set-cookie"].join(";"), /xocrisk_session=/);
  } finally {
    await app.close();
  }
});

test("password reset replaces the password, consumes its code, and revokes sessions", async () => {
  const statements = [];
  const pool = {
    query: async () => { throw new Error("Unexpected pool query"); },
    connect: async () => ({
      query: async (sql, values = []) => {
        statements.push(sql);
        if (sql.includes("SELECT user_id, code_hash")) {
          return { rows: [{ user_id: "123e4567-e89b-42d3-a456-426614174000", code_hash: hashOtp("012345", sessionSecret) }] };
        }
        if (sql.includes("UPDATE users SET password_hash")) {
          assert.match(values[0], /^[0-9a-f]{32}:[0-9a-f]{128}$/);
          return { rows: [] };
        }
        return { rows: [] };
      },
      release() {},
    }),
  };
  const app = await makeApp(pool);
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/auth/password-reset/complete",
      payload: { email: "user@example.com", code: "012345", password: "new-long-password" },
    });
    assert.equal(response.statusCode, 200);
    assert.match(response.headers["set-cookie"], /Max-Age=0/);
    assert.ok(statements.includes("DELETE FROM auth_sessions WHERE user_id = $1"));
    assert.ok(statements.includes("COMMIT"));
  } finally {
    await app.close();
  }
});
