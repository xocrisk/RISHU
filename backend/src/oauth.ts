import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Pool } from "pg";
import type { ApiConfig, OAuthProviderConfig } from "./config.js";
import { createSession, sessionCookie } from "./auth.js";
import { hashSessionToken } from "./security.js";

type Provider = "google" | "microsoft";
type OAuthClaims = { sub?: string; nonce?: string; iss?: string; tid?: string };

const googleJwks = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const microsoftJwks = createRemoteJWKSet(new URL("https://login.microsoftonline.com/common/discovery/v2.0/keys"));
const flowCookieName = "xocrisk_oauth_state";
const linkCookieName = "xocrisk_oauth_link";
const flowLifetimeSeconds = 10 * 60;
const oauthSessionLifetimeMs = 12 * 60 * 60 * 1000;

function providerConfig(provider: Provider, config: ApiConfig): (OAuthProviderConfig & { tenantId?: string }) | undefined {
  return provider === "google" ? config.googleOAuth : config.microsoftOAuth;
}

function providerEndpoints(provider: Provider, tenantId = "common") {
  if (provider === "google") {
    return {
      authorization: "https://accounts.google.com/o/oauth2/v2/auth",
      token: "https://oauth2.googleapis.com/token",
    };
  }
  const authority = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0`;
  return { authorization: `${authority}/authorize`, token: `${authority}/token` };
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function cookieValue(request: { headers: { cookie?: string } }, name: string): string | null {
  const match = request.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([A-Za-z0-9_-]+)(?:;|$)`));
  return match?.[1] ?? null;
}

function stateCookie(state: string, environment: string): string {
  return `${flowCookieName}=${state}; Path=/v1/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=${flowLifetimeSeconds}${environment === "production" ? "; Secure" : ""}`;
}

function clearStateCookie(environment: string): string {
  return `${flowCookieName}=; Path=/v1/auth/oauth; HttpOnly; SameSite=Lax; Max-Age=0${environment === "production" ? "; Secure" : ""}`;
}

function linkCookie(token: string, environment: string): string {
  return `${linkCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${flowLifetimeSeconds}${environment === "production" ? "; Secure" : ""}`;
}

function clearLinkCookie(environment: string): string {
  return `${linkCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${environment === "production" ? "; Secure" : ""}`;
}

function allowedReturnOrigin(value: string | undefined, config: ApiConfig): string {
  const allowlist = config.webOrigin.split(",").map((origin) => origin.trim().replace(/\/$/, ""));
  const selected = value?.trim().replace(/\/$/, "");
  return selected && allowlist.includes(selected) ? selected : allowlist[0];
}

function loginRedirect(origin: string, reason: string): string {
  return `${origin}/login?oauth=${encodeURIComponent(reason)}`;
}

async function verifiedSubject(
  provider: Provider,
  idToken: string,
  expectedNonce: string,
  oauthConfig: OAuthProviderConfig & { tenantId?: string },
): Promise<string> {
  const verified = provider === "google"
    ? await jwtVerify(idToken, googleJwks, {
      audience: oauthConfig.clientId,
      issuer: ["https://accounts.google.com", "accounts.google.com"],
    })
    : await jwtVerify(idToken, microsoftJwks, { audience: oauthConfig.clientId });
  const claims = verified.payload as OAuthClaims;
  if (!claims.sub || claims.nonce !== expectedNonce) {
    throw new Error("OAuth identity token did not match the login transaction.");
  }
  if (provider === "microsoft") {
    const issuer = `https://login.microsoftonline.com/${claims.tid}/v2.0`;
    if (!claims.tid || claims.iss !== issuer || !/^[0-9a-f-]{36}$/i.test(claims.tid)) {
      throw new Error("Microsoft identity token has an invalid tenant issuer.");
    }
    if (oauthConfig.tenantId && oauthConfig.tenantId !== "common" && claims.tid.toLowerCase() !== oauthConfig.tenantId.toLowerCase()) {
      throw new Error("Microsoft identity token belongs to an unexpected tenant.");
    }
  }
  return claims.sub;
}

export async function registerOAuthRoutes(
  app: FastifyInstance,
  { pool, config }: { pool: Pool; config: ApiConfig },
): Promise<void> {
  app.get<{ Params: { provider: string }; Querystring: { returnOrigin?: string } }>(
    "/v1/auth/oauth/:provider/start",
    async (request, reply) => {
      const provider = request.params.provider;
      if (provider !== "google" && provider !== "microsoft") {
        return reply.code(404).send({ message: "This sign-in provider is not supported." });
      }
      const oauthConfig = providerConfig(provider, config);
      const returnOrigin = allowedReturnOrigin(request.query.returnOrigin, config);
      if (!oauthConfig) {
        return reply
          .header("Set-Cookie", clearLinkCookie(config.environment))
          .redirect(loginRedirect(returnOrigin, "unavailable"));
      }

      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      const expiresAt = new Date(Date.now() + flowLifetimeSeconds * 1000);
      await pool.query("DELETE FROM oauth_transactions WHERE expires_at <= now()");
      await pool.query("DELETE FROM oauth_link_attempts WHERE expires_at <= now()");
      await pool.query(
        `INSERT INTO oauth_transactions (state_hash, provider, nonce, code_verifier, expires_at, return_origin)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [hashState(state), provider, nonce, verifier, expiresAt, returnOrigin],
      );

      const endpoints = providerEndpoints(provider, oauthConfig.tenantId);
      const authorization = new URL(endpoints.authorization);
      authorization.search = new URLSearchParams({
        client_id: oauthConfig.clientId,
        redirect_uri: oauthConfig.redirectUri,
        response_type: "code",
        scope: "openid profile email",
        state,
        nonce,
        code_challenge: challenge,
        code_challenge_method: "S256",
      }).toString();
      return reply
        .header("Set-Cookie", [stateCookie(state, config.environment), clearLinkCookie(config.environment)])
        .redirect(authorization.toString());
    },
  );

  app.get<{ Params: { provider: string }; Querystring: { code?: string; state?: string; error?: string } }>(
    "/v1/auth/oauth/:provider/callback",
    async (request, reply) => {
      const provider = request.params.provider;
      const returnOrigin = allowedReturnOrigin(undefined, config);
      if (provider !== "google" && provider !== "microsoft") {
        return reply.code(404).send({ message: "This sign-in provider is not supported." });
      }
      const oauthConfig = providerConfig(provider, config);
      if (!oauthConfig) return reply.redirect(loginRedirect(returnOrigin, "unavailable"));

      const state = request.query.state;
      const flowCookie = cookieValue(request, flowCookieName);
      if (request.query.error || !state || state !== flowCookie || !request.query.code) {
        return reply
          .header("Set-Cookie", [clearStateCookie(config.environment), clearLinkCookie(config.environment)])
          .redirect(loginRedirect(returnOrigin, request.query.error ? "cancelled" : "failed"));
      }

      try {
        const transaction = await pool.query<{
          nonce: string;
          code_verifier: string;
          return_origin: string;
        }>(
          `DELETE FROM oauth_transactions
           WHERE state_hash = $1 AND provider = $2 AND expires_at > now()
           RETURNING nonce, code_verifier, return_origin`,
          [hashState(state), provider],
        );
        const flow = transaction.rows[0];
        if (!flow?.return_origin) {
          return reply
            .header("Set-Cookie", [clearStateCookie(config.environment), clearLinkCookie(config.environment)])
            .redirect(loginRedirect(returnOrigin, "expired"));
        }

        const endpoints = providerEndpoints(provider, oauthConfig.tenantId);
        const tokenResponse = await fetch(endpoints.token, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: oauthConfig.clientId,
            client_secret: oauthConfig.clientSecret,
            code: request.query.code,
            code_verifier: flow.code_verifier,
            grant_type: "authorization_code",
            redirect_uri: oauthConfig.redirectUri,
          }),
        });
        const tokenPayload = await tokenResponse.json() as { id_token?: string };
        if (!tokenResponse.ok || !tokenPayload.id_token) {
          throw new Error("OAuth provider did not return an identity token.");
        }
        const subject = await verifiedSubject(provider, tokenPayload.id_token, flow.nonce, oauthConfig);
        const linked = await pool.query<{ id: string }>(
          `SELECT u.id FROM oauth_accounts o
           JOIN users u ON u.id = o.user_id
           WHERE o.provider = $1 AND o.provider_subject = $2 AND u.deletion_requested_at IS NULL`,
          [provider, subject],
        );
        if (linked.rows[0]) {
          const token = await createSession(pool, linked.rows[0].id, config.sessionSecret, oauthSessionLifetimeMs);
          return reply
            .header("Set-Cookie", [clearStateCookie(config.environment), sessionCookie(token, config.environment, false), clearLinkCookie(config.environment)])
            .redirect(`${flow.return_origin}/account`);
        }

        const linkToken = randomBytes(32).toString("base64url");
        await pool.query(
          `INSERT INTO oauth_link_attempts (token_hash, provider, provider_subject, expires_at)
           VALUES ($1, $2, $3, $4)`,
          [hashSessionToken(linkToken, config.sessionSecret), provider, subject, new Date(Date.now() + flowLifetimeSeconds * 1000)],
        );
        return reply
          .header("Set-Cookie", [clearStateCookie(config.environment), linkCookie(linkToken, config.environment)])
          .redirect(loginRedirect(flow.return_origin, "link"));
      } catch (error) {
        request.log.error({ err: error }, "OAuth sign-in failed.");
        return reply
          .header("Set-Cookie", [clearStateCookie(config.environment), clearLinkCookie(config.environment)])
          .redirect(loginRedirect(returnOrigin, "failed"));
      }
    },
  );
}
