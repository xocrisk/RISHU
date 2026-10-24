import { randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { normalizeIndianMobile } from "@xocrisk/core";
import {
  createOtp,
  hashPassword,
  hashOtp,
  hashSessionToken,
  matchesHash,
  newSessionToken,
  normalizeEmail,
  verifyPassword,
} from "./security.js";
import type { SmtpConfig, SupabaseConfig } from "./config.js";
import nodemailer from "nodemailer";

type AuthUser = {
  id: string;
  email: string | null;
  mobile: string | null;
  full_name: string | null;
  college: string | null;
};

type SignupBody = {
  fullName: string;
  email: string;
  mobile: string;
  college: string;
  lpuRegistrationNumber?: string;
  password: string;
  adultConsent: true;
  referralUid?: string;
};

declare module "fastify" {
  interface FastifyRequest {
    authUser: AuthUser | null;
    sessionHash: string | null;
  }
}

// Sessions renew themselves while in use (see the preHandler), so people stay signed in until they log out.
const sessionLifetimeMs = 180 * 24 * 60 * 60 * 1000;
const temporarySessionLifetimeMs = 12 * 60 * 60 * 1000;
// The Android/iOS apps keep people signed in (behind their own app lock) and send the token as a Bearer header.
const appSessionLifetimeMs = 180 * 24 * 60 * 60 * 1000;
const isAppClient = (request: FastifyRequest) => request.headers["x-xocrisk-client"] === "app";
const signupSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    required: ["fullName", "email", "mobile", "college", "password", "adultConsent"],
    properties: {
      fullName: { type: "string", minLength: 2, maxLength: 120 },
      email: { type: "string", minLength: 3, maxLength: 254 },
      mobile: { type: "string", minLength: 10, maxLength: 32 },
      college: { type: "string", minLength: 2, maxLength: 160 },
      lpuRegistrationNumber: { type: "string", pattern: "^\\d{8}$" },
      password: { type: "string", minLength: 10, maxLength: 128 },
      adultConsent: { const: true },
      referralUid: { type: "string", pattern: "^[A-Z0-9]{6,64}$" },
    },
  },
} as const;

const loginSchema = {
  body: {
    type: "object",
    additionalProperties: false,
    anyOf: [
      { required: ["identifier", "password"] },
      { required: ["email", "password"] },
    ],
    properties: {
      identifier: { type: "string", minLength: 1, maxLength: 254 },
      email: { type: "string", minLength: 3, maxLength: 254 },
      password: { type: "string", minLength: 1, maxLength: 128 },
      rememberMe: { type: "boolean" },
    },
  },
} as const;

function sessionToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    const token = authorization.slice("Bearer ".length).trim();
    if (token) return token;
  }
  const match = request.headers.cookie?.match(/(?:^|;\s*)xocrisk_session=([A-Za-z0-9_-]+)(?:;|$)/);
  return match?.[1] ?? null;
}

function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    mobile: user.mobile,
    fullName: user.full_name,
    college: user.college,
  };
}

export async function createSession(
  pool: Pool,
  userId: string,
  secret: string,
  lifetimeMs = sessionLifetimeMs,
) {
  const token = newSessionToken();
  const tokenHash = hashSessionToken(token, secret);
  const expiresAt = new Date(Date.now() + lifetimeMs);
  await pool.query(
    "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, tokenHash, expiresAt],
  );
  return token;
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  { pool, sessionSecret, environment, smtp, supabase, webOrigins = [] }: {
    pool: Pool; sessionSecret: string; environment: string; smtp?: SmtpConfig; supabase?: SupabaseConfig; webOrigins?: string[];
  },
): Promise<void> {
  app.decorateRequest("authUser", null);
  app.decorateRequest("sessionHash", null);

  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS") return;
    const token = sessionToken(request);
    if (!token) return;
    const tokenHash = hashSessionToken(token, sessionSecret);
    const result = await pool.query<AuthUser & { renew: boolean }>(
      `SELECT u.id, u.email, u.mobile, u.full_name, u.college,
              -- Long sessions in use get their full lifetime back once a day; 12-hour ones never stretch.
              (s.expires_at > now() + interval '12 hours' AND s.expires_at < now() + $2 * interval '1 millisecond' - interval '1 day') AS renew
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()
         AND u.id <> 'd3a00000-0000-4000-8000-000000000001'::uuid
         AND u.deletion_requested_at IS NULL`,
      [tokenHash, sessionLifetimeMs],
    );
    const row = result.rows[0];
    if (row) {
      const { renew, ...user } = row;
      request.authUser = user;
      request.sessionHash = tokenHash;
      if (renew) {
        await pool.query("UPDATE auth_sessions SET expires_at = $2 WHERE token_hash = $1", [tokenHash, new Date(Date.now() + sessionLifetimeMs)]);
        if (!request.headers.authorization) reply.header("Set-Cookie", sessionCookie(token, environment));
      }
    }
  });

  app.post<{ Body: SignupBody }>(
    "/v1/auth/signup",
    { schema: signupSchema, config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
      async (request, reply) => {
      const email = normalizeEmail(request.body.email);
      const mobile = normalizeIndianMobile(request.body.mobile);
      const fullName = request.body.fullName.trim();
      const college = request.body.college.trim();
      const registrationNumber = request.body.lpuRegistrationNumber?.trim() ?? "";
      if (!email) return reply.code(400).send({ message: "Enter a valid email address." });
      if (!mobile) return reply.code(400).send({ message: "Enter a valid 10-digit Indian mobile number." });
      if (fullName.length < 2 || college.length < 2) {
        return reply.code(400).send({ message: "Enter your name and college." });
      }
      const isLpu = college === "Lovely Professional University (LPU)";
      if ((isLpu && !/^\d{8}$/.test(registrationNumber)) || (!isLpu && registrationNumber)) {
        return reply.code(400).send({ message: "Check the LPU registration number and try again." });
      }

      const passwordHash = await hashPassword(request.body.password);
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const created = await client.query<AuthUser>(
          `INSERT INTO users
             (email, mobile, password_hash, adult_consent_at, full_name, college, lpu_registration_number)
           VALUES ($1, $2, $3, now(), $4, $5, $6)
           RETURNING id, email, mobile, full_name, college`,
          [email, mobile, passwordHash, fullName, college, isLpu ? registrationNumber : null],
        );
        const user = created.rows[0];
        if (request.body.referralUid) {
          const inviter = await client.query<{ id: string }>(
            "SELECT id FROM users WHERE uid = $1 AND deletion_requested_at IS NULL AND adult_consent_at IS NOT NULL AND id <> $2 FOR SHARE",
            [request.body.referralUid, user.id],
          );
          if (!inviter.rows[0]) {
            await client.query("ROLLBACK");
            return reply.code(400).send({ message: "Inviter UID was not found. Check it or remove it to continue." });
          }
          const inviterId = inviter.rows[0].id;
          // Signup and reward commit together. A new account can reward only one inviter once.
          const reward = await client.query(
            `INSERT INTO referral_rewards (referred_user_id, inviter_user_id)
             VALUES ($1, $2) ON CONFLICT (referred_user_id) DO NOTHING RETURNING amount`,
            [user.id, inviterId],
          );
          if (reward.rowCount) {
            await client.query("INSERT INTO practice_portfolios (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING", [inviterId]);
            await client.query(
              `UPDATE practice_portfolios SET cash = cash + 1000, referral_bonus = referral_bonus + 1000,
               day_start_value = day_start_value + 1000, updated_at = now() WHERE user_id = $1`,
              [inviterId],
            );
          }
        }
        const token = newSessionToken();
        const tokenHash = hashSessionToken(token, sessionSecret);
        await client.query(
          "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
          [user.id, tokenHash, new Date(Date.now() + (isAppClient(request) ? appSessionLifetimeMs : sessionLifetimeMs))],
        );
        await client.query("COMMIT");
        if (supabase) await mirrorUserToSupabase(supabase, user, request.log);
        return reply
          .header("Set-Cookie", sessionCookie(token, environment))
          .code(201)
          .send({ user: publicUser(user), ...(isAppClient(request) ? { token } : {}) });
      } catch (error) {
        await client.query("ROLLBACK");
        if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
          return reply.code(409).send({ message: "An account with that email or mobile number already exists." });
        }
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.post<{ Body: { identifier?: string; email?: string; password: string; rememberMe?: boolean } }>(
    "/v1/auth/login",
    { schema: loginSchema, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const identifier = request.body.identifier ?? request.body.email ?? "";
      const email = normalizeEmail(identifier);
      const mobile = normalizeIndianMobile(identifier);
      if (!email && !mobile) {
        return reply.code(401).send({ message: "Mobile number, email, or password is incorrect." });
      }
      const result = await pool.query<AuthUser & { password_hash: string | null }>(
        `SELECT id, email, mobile, full_name, college, password_hash
         FROM users
         WHERE (lower(email) = $1 OR mobile = $2) AND deletion_requested_at IS NULL
         LIMIT 1`,
        [email, mobile],
      );
      const user = result.rows[0];
      if (!await verifyPassword(request.body.password, user?.password_hash)) {
        return reply.code(401).send({ message: "Mobile number, email, or password is incorrect." });
      }
      const linkToken = cookieValue(request.headers.cookie, "xocrisk_oauth_link");
      if (linkToken) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const pendingLink = await client.query<{ provider: "google" | "microsoft"; provider_subject: string }>(
            `DELETE FROM oauth_link_attempts
             WHERE token_hash = $1 AND expires_at > now()
             RETURNING provider, provider_subject`,
            [hashSessionToken(linkToken, sessionSecret)],
          );
          if (!pendingLink.rows[0]) {
            await client.query("ROLLBACK");
            return reply
              .header("Set-Cookie", oauthLinkCookie("", environment, true))
              .code(410)
              .send({ message: "That provider link expired. Start sign-in with the provider again." });
          }
          await client.query(
            "INSERT INTO oauth_accounts (provider, provider_subject, user_id) VALUES ($1, $2, $3)",
            [pendingLink.rows[0].provider, pendingLink.rows[0].provider_subject, user.id],
          );
          const token = newSessionToken();
          const tokenHash = hashSessionToken(token, sessionSecret);
          const rememberMe = request.body.rememberMe === true;
          await client.query(
            "INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
            [user.id, tokenHash, new Date(Date.now() + (rememberMe ? sessionLifetimeMs : temporarySessionLifetimeMs))],
          );
          await client.query("COMMIT");
          return reply
            .header("Set-Cookie", [
              sessionCookie(token, environment, rememberMe),
              expiredSessionCookie(environment),
              oauthLinkCookie("", environment, true),
            ])
            .send({ user: publicUser(user), providerLinked: Boolean(pendingLink.rows[0]) });
        } catch (error) {
          await client.query("ROLLBACK");
          if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
            return reply
              .header("Set-Cookie", oauthLinkCookie("", environment, true))
              .code(409)
              .send({ message: "That provider is already linked to another XOCRISK account." });
          }
          throw error;
        } finally {
          client.release();
        }
      }
      const rememberMe = request.body.rememberMe === true;
      const app = isAppClient(request);
      const token = await createSession(
        pool,
        user.id,
        sessionSecret,
        app ? appSessionLifetimeMs : rememberMe ? sessionLifetimeMs : temporarySessionLifetimeMs,
      );
      return reply.header("Set-Cookie", sessionCookie(token, environment, rememberMe))
        .send({ user: publicUser(user), ...(app ? { token } : {}) });
    },
  );

  app.post<{ Body: { email: string } }>(
    "/v1/auth/password-reset/request",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email"],
          properties: { email: { type: "string", minLength: 3, maxLength: 254 } },
        },
      },
      config: { rateLimit: { max: 3, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const sent = { message: "If an account exists for that email, we've sent a password reset link. Check your inbox and spam folder." };
      // Supabase sends the email: a link that opens /reset-password/ on the site the request came from.
      if (supabase) {
        const email = normalizeEmail(request.body.email);
        if (!email) return reply.code(202).send(sent);
        const user = await pool.query<{ id: string }>(
          "SELECT id FROM users WHERE lower(email) = $1 AND deletion_requested_at IS NULL LIMIT 1", [email],
        );
        if (!user.rows[0]) return reply.code(202).send(sent);
        const headers = { apikey: supabase.secretKey, Authorization: `Bearer ${supabase.secretKey}`, "Content-Type": "application/json" };
        // Supabase can only email people it knows; XOCRISK keeps the password, so a placeholder one is set.
        const created = await fetch(`${supabase.url}/auth/v1/admin/users`, {
          method: "POST", headers, body: JSON.stringify({ email, email_confirm: true, password: randomBytes(24).toString("base64url") }),
        });
        if (!created.ok && created.status !== 422) {
          request.log.error({ status: created.status }, "Supabase user could not be prepared for a password reset.");
          return reply.code(503).send({ message: "Unable to send a password reset email right now. Try again later." });
        }
        const origin = request.headers.origin && webOrigins.includes(request.headers.origin) ? request.headers.origin : webOrigins[0];
        const redirectTo = `${origin}/reset-password/`;
        const recover = await fetch(`${supabase.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
          method: "POST", headers, body: JSON.stringify({ email }),
        });
        if (!recover.ok) {
          // e.g. email_address_not_authorized: Supabase's built-in mailer only reaches team members until custom SMTP is set up.
          const reason = await recover.json().catch(() => ({})) as { error_code?: string };
          request.log.error({ status: recover.status, reason: reason.error_code }, "Supabase password reset email could not be sent.");
          return reply.code(recover.status === 429 ? 429 : 503).send({
            message: recover.status === 429 ? "Too many reset emails were sent. Wait a few minutes and try again." : "Unable to send a password reset email right now. Try again later.",
          });
        }
        return reply.code(202).send(sent);
      }
      if (!smtp) return reply.code(503).send({ message: "Email password recovery is not configured." });
      const email = normalizeEmail(request.body.email);
      if (!email) return reply.code(202).send({ message: "If an account exists for that email, a reset code has been sent." });

      const user = await pool.query<{ id: string }>(
        "SELECT id FROM users WHERE lower(email) = $1 AND deletion_requested_at IS NULL LIMIT 1",
        [email],
      );
      if (!user.rows[0]) {
        return reply.code(202).send({ message: "If an account exists for that email, a reset code has been sent." });
      }

      const code = createOtp();
      await pool.query(
        `INSERT INTO email_otps (email, purpose, user_id, code_hash, expires_at, attempts)
         VALUES ($1, 'password_reset', $2, $3, now() + interval '10 minutes', 0)
         ON CONFLICT (email, purpose) DO UPDATE
         SET user_id = EXCLUDED.user_id, code_hash = EXCLUDED.code_hash,
             expires_at = EXCLUDED.expires_at, attempts = 0, created_at = now()`,
        [email, user.rows[0].id, hashOtp(code, sessionSecret)],
      );

      try {
        const transporter = nodemailer.createTransport({
          host: smtp.host,
          port: smtp.port,
          secure: smtp.secure,
          auth: { user: smtp.user, pass: smtp.password },
        });
        await transporter.sendMail({
          from: smtp.from,
          to: email,
          subject: "Your XOCRISK password reset code",
          text: `Your XOCRISK password reset code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
        });
      } catch (error) {
        request.log.error({ err: error }, "Password reset email could not be sent.");
        await pool.query("DELETE FROM email_otps WHERE email = $1 AND purpose = 'password_reset'", [email]);
        return reply.code(503).send({ message: "Unable to send a password reset email right now. Try again later." });
      }
      return reply.code(202).send({ message: "If an account exists for that email, a reset code has been sent." });
    },
  );

  app.post<{ Body: { email: string; code: string; password: string } }>(
    "/v1/auth/password-reset/complete",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["email", "code", "password"],
          properties: {
            email: { type: "string", minLength: 3, maxLength: 254 },
            code: { type: "string", pattern: "^\\d{6}$" },
            password: { type: "string", minLength: 10, maxLength: 128 },
          },
        },
      },
      config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
    },
    async (request, reply) => {
      const email = normalizeEmail(request.body.email);
      if (!email) return reply.code(400).send({ message: "The reset code is invalid or expired." });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await client.query<{ user_id: string; code_hash: string }>(
          `SELECT user_id, code_hash FROM email_otps
           WHERE email = $1 AND purpose = 'password_reset'
             AND expires_at > now() AND attempts < 5
           FOR UPDATE`,
          [email],
        );
        const reset = result.rows[0];
        if (!reset || !matchesHash(hashOtp(request.body.code, sessionSecret), reset.code_hash)) {
          if (reset) {
            await client.query(
              "UPDATE email_otps SET attempts = attempts + 1 WHERE email = $1 AND purpose = 'password_reset'",
              [email],
            );
          }
          await client.query("COMMIT");
          return reply.code(400).send({ message: "The reset code is invalid or expired." });
        }
        const passwordHash = await hashPassword(request.body.password);
        await client.query("UPDATE users SET password_hash = $1 WHERE id = $2", [passwordHash, reset.user_id]);
        await client.query("DELETE FROM email_otps WHERE email = $1 AND purpose = 'password_reset'", [email]);
        await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [reset.user_id]);
        await client.query("COMMIT");
        return reply
          .header("Set-Cookie", expiredSessionCookie(environment))
          .send({ message: "Password updated. Please log in with your new password." });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  );

  app.get("/v1/auth/me", async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    return { user: publicUser(request.authUser) };
  });

  // Google (and any other Supabase Auth provider): the browser signs in with Supabase, then hands us its
  // access token. We ask Supabase who it belongs to, and sign that verified email into XOCRISK.
  app.post<{ Body: { accessToken: string } }>("/v1/auth/supabase", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["accessToken"],
        properties: { accessToken: { type: "string", minLength: 20, maxLength: 4096 } },
      },
    },
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (!supabase) return reply.code(503).send({ message: "Google sign-in isn't set up yet. Use your email and password." });
    let response: Response;
    try {
      response = await fetch(`${supabase.url}/auth/v1/user`, {
        headers: { apikey: supabase.secretKey, Authorization: `Bearer ${request.body.accessToken}` },
      });
    } catch (error) {
      request.log.error({ reason: error instanceof Error ? error.message : String(error) }, "Supabase user lookup failed.");
      return reply.code(503).send({ message: "Google sign-in is temporarily unavailable. Try again in a minute." });
    }
    if (!response.ok) return reply.code(401).send({ message: "Your Google sign-in expired. Try again." });
    const identity = await response.json() as {
      email?: string; email_confirmed_at?: string | null; user_metadata?: { full_name?: string; name?: string };
    };
    const email = normalizeEmail(identity.email ?? "");
    if (!email || !identity.email_confirmed_at) {
      return reply.code(403).send({ message: "That account's email isn't verified yet." });
    }

    const select = () => pool.query<AuthUser & { deletion_requested_at: Date | null }>(
      "SELECT id, email, mobile, full_name, college, deletion_requested_at FROM users WHERE lower(email) = $1 LIMIT 1", [email],
    );
    let user = (await select()).rows[0];
    let created = false;
    if (!user) {
      const fullName = (identity.user_metadata?.full_name ?? identity.user_metadata?.name ?? "").trim().slice(0, 80) || null;
      try {
        // Continuing with Google on the login page carries the same 18+ confirmation as the signup form.
        const inserted = await pool.query<AuthUser & { deletion_requested_at: Date | null }>(
          `INSERT INTO users (email, full_name, adult_consent_at, email_verified_at) VALUES ($1, $2, now(), now())
           RETURNING id, email, mobile, full_name, college, deletion_requested_at`,
          [email, fullName],
        );
        user = inserted.rows[0];
        created = true;
      } catch (error) {
        if (!(typeof error === "object" && error !== null && "code" in error && error.code === "23505")) throw error;
        user = (await select()).rows[0];
      }
    }
    if (!user || user.deletion_requested_at) return reply.code(403).send({ message: "This account has been deleted." });

    const app = isAppClient(request);
    const token = await createSession(pool, user.id, sessionSecret, app ? appSessionLifetimeMs : sessionLifetimeMs);
    return reply.header("Set-Cookie", sessionCookie(token, environment))
      .send({ user: publicUser(user), created, ...(app ? { token } : {}) });
  });

  // Google sign-in from the Android/iOS app runs in the phone's browser (Google blocks it inside app web views).
  // Supabase returns that browser here, and this hands the one-time code to the app through its own link scheme.
  // The code is useless without the PKCE verifier that stays inside the app, so passing it along is safe.
  app.get<{ Querystring: Record<string, string> }>("/v1/auth/app-callback", async (request, reply) => {
    const forward = new URLSearchParams();
    for (const name of ["code", "error", "error_code", "error_description"]) {
      const value = request.query[name];
      if (typeof value === "string" && value.length <= 2048) forward.set(name, value);
    }
    return reply.redirect(`com.xocrisk.app://sso-callback?${forward.toString()}`, 302);
  });

  // The reset link from Supabase's email lands on /reset-password/ with a short-lived Supabase token that proves
  // the person owns the email. That token plus the new password sets the XOCRISK password.
  app.post<{ Body: { accessToken: string; password: string } }>("/v1/auth/password-reset/link", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["accessToken", "password"],
        properties: {
          accessToken: { type: "string", minLength: 20, maxLength: 4096 },
          password: { type: "string", minLength: 10, maxLength: 128 },
        },
      },
    },
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
  }, async (request, reply) => {
    if (!supabase) return reply.code(503).send({ message: "Email password recovery is not configured." });
    const headers = { apikey: supabase.secretKey, Authorization: `Bearer ${request.body.accessToken}` };
    const response = await fetch(`${supabase.url}/auth/v1/user`, { headers });
    if (!response.ok) return reply.code(401).send({ message: "This reset link has expired. Request a new one." });
    const identity = await response.json() as { email?: string };
    const email = normalizeEmail(identity.email ?? "");
    if (!email) return reply.code(401).send({ message: "This reset link has expired. Request a new one." });

    const passwordHash = await hashPassword(request.body.password);
    const updated = await pool.query<{ id: string }>(
      "UPDATE users SET password_hash = $2 WHERE lower(email) = $1 AND deletion_requested_at IS NULL RETURNING id", [email, passwordHash],
    );
    const user = updated.rows[0];
    if (!user) return reply.code(404).send({ message: "No XOCRISK account uses that email." });
    // Everyone signed in with the old password is signed out, and the reset link can't be used again.
    await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [user.id]);
    await fetch(`${supabase.url}/auth/v1/logout?scope=global`, { method: "POST", headers }).catch(() => undefined);
    return reply.header("Set-Cookie", expiredSessionCookie(environment))
      .send({ message: "Password updated. Log in with your new password." });
  });

  app.put<{ Body: { fullName: string; mobile: string } }>("/v1/auth/profile", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["fullName", "mobile"],
        properties: { fullName: { type: "string", minLength: 1, maxLength: 80 }, mobile: { type: "string", minLength: 1, maxLength: 20 } },
      },
    },
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    const fullName = request.body.fullName.trim().replace(/\s+/g, " ");
    const mobile = normalizeIndianMobile(request.body.mobile);
    if (fullName.length < 2) return reply.code(400).send({ message: "Enter your full name." });
    if (!mobile) return reply.code(400).send({ message: "Enter a valid 10-digit Indian mobile number." });
    try {
      const updated = await pool.query<AuthUser>(
        "UPDATE users SET full_name = $2, mobile = $3 WHERE id = $1 RETURNING id, email, mobile, full_name, college",
        [request.authUser.id, fullName, mobile],
      );
      return { user: publicUser(updated.rows[0]), message: "Profile updated." };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ message: "That mobile number is already used by another account." });
      }
      throw error;
    }
  });

  // Google sign-in gives a name and email only, so the dashboard asks once for the rest: college (with the LPU
  // registration number for LPU students) and, if missing, a mobile number. College can't be changed afterwards.
  app.put<{ Body: { college: string; mobile?: string; lpuRegistrationNumber?: string } }>("/v1/auth/profile/details", {
    schema: {
      body: {
        type: "object", additionalProperties: false, required: ["college"],
        properties: {
          college: { type: "string", minLength: 1, maxLength: 160 },
          mobile: { type: "string", minLength: 1, maxLength: 20 },
          lpuRegistrationNumber: { type: "string", pattern: "^\\d{8}$" },
        },
      },
    },
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    const current = (await pool.query<{ mobile: string | null; college: string | null }>(
      "SELECT mobile, college FROM users WHERE id = $1", [request.authUser.id],
    )).rows[0];
    if (!current) return reply.code(401).send({ message: "Sign in to continue." });
    if (current.college) return reply.code(409).send({ message: "Your college is already saved." });

    const college = request.body.college.trim().replace(/\s+/g, " ");
    if (college.length < 2) return reply.code(400).send({ message: "Enter your college or university." });
    const registrationNumber = request.body.lpuRegistrationNumber?.trim() ?? "";
    const isLpu = college === "Lovely Professional University (LPU)";
    if ((isLpu && !/^\d{8}$/.test(registrationNumber)) || (!isLpu && registrationNumber)) {
      return reply.code(400).send({ message: "Check the LPU registration number and try again." });
    }
    let mobile = current.mobile;
    if (!mobile) {
      mobile = request.body.mobile ? normalizeIndianMobile(request.body.mobile) : null;
      if (!mobile) return reply.code(400).send({ message: "Enter a valid 10-digit Indian mobile number." });
    }
    try {
      const updated = await pool.query<AuthUser>(
        `UPDATE users SET college = $2, lpu_registration_number = $3, mobile = $4
         WHERE id = $1 AND college IS NULL RETURNING id, email, mobile, full_name, college`,
        [request.authUser.id, college, isLpu ? registrationNumber : null, mobile],
      );
      if (!updated.rows[0]) return reply.code(409).send({ message: "Your college is already saved." });
      return { user: publicUser(updated.rows[0]), message: "Profile completed." };
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return reply.code(409).send({ message: "That mobile number or LPU registration number is already used by another account." });
      }
      throw error;
    }
  });

  // Settings that follow the person between the app and the website. Only the fields sent are changed.
  app.put<{ Body: { privacy?: boolean; watchlist?: string[] } }>("/v1/auth/preferences", {
    schema: {
      body: {
        type: "object", additionalProperties: false, minProperties: 1,
        properties: {
          privacy: { type: "boolean" },
          watchlist: { type: "array", maxItems: 100, uniqueItems: true, items: { type: "string", pattern: "^[A-Z0-9&_ .-]{1,24}$" } },
        },
      },
    },
    config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    const updated = await pool.query<{ preferences: Record<string, unknown> }>(
      "UPDATE users SET preferences = preferences || $2::jsonb WHERE id = $1 RETURNING preferences",
      [request.authUser.id, JSON.stringify(request.body)],
    );
    return { preferences: updated.rows[0]?.preferences ?? {} };
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    if (request.sessionHash) {
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [request.sessionHash]);
    }
    return reply.header("Set-Cookie", expiredSessionCookie(environment)).code(204).send();
  });

  app.delete("/v1/auth/account", async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to continue." });
    await pool.query(
      "UPDATE users SET deletion_requested_at = now() WHERE id = $1",
      [request.authUser.id],
    );
    await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [request.authUser.id]);
    return reply
      .header("Set-Cookie", expiredSessionCookie(environment))
      .code(202)
      .send({ message: "Your account deletion request has been recorded." });
  });
}

/**
 * Lists an XOCRISK account under Supabase → Authentication → Users (email, name, mobile, college) so every user is
 * visible there, not only Google ones. No password goes to Supabase; XOCRISK keeps its own hash. Never blocks signup.
 */
export async function mirrorUserToSupabase(
  supabase: SupabaseConfig,
  user: AuthUser,
  log: { warn: (details: object, message: string) => void },
): Promise<void> {
  if (!user.email) return;
  try {
    const response = await fetch(`${supabase.url}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: supabase.secretKey, Authorization: `Bearer ${supabase.secretKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email,
        email_confirm: true,
        user_metadata: { full_name: user.full_name, mobile: user.mobile, college: user.college, xocrisk_user_id: user.id },
      }),
      signal: AbortSignal.timeout(4000),
    });
    // 422: already there (e.g. signed in with Google before).
    if (!response.ok && response.status !== 422) log.warn({ status: response.status }, "Couldn't list the new user in Supabase.");
  } catch (error) {
    log.warn({ reason: error instanceof Error ? error.message : String(error) }, "Couldn't list the new user in Supabase.");
  }
}

export function sessionCookie(token: string, environment: string, rememberMe = true): string {
  return `xocrisk_session=${token}; Path=/; HttpOnly; SameSite=Lax${rememberMe ? `; Max-Age=${sessionLifetimeMs / 1000}` : ""}${environment === "production" ? "; Secure" : ""}`;
}

function cookieValue(cookieHeader: string | undefined, name: string): string | null {
  const match = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]+)(?:;|$)`));
  return match?.[1] ?? null;
}

function oauthLinkCookie(value: string, environment: string, expired = false): string {
  return `xocrisk_oauth_link=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${expired ? 0 : 600}${environment === "production" ? "; Secure" : ""}`;
}

function expiredSessionCookie(environment: string): string {
  return `xocrisk_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${environment === "production" ? "; Secure" : ""}`;
}
