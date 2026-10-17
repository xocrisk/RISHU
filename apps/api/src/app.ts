import Fastify from "fastify";
import type { Pool } from "pg";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import type { ApiConfig } from "./config.js";
import { registerAuthRoutes } from "./auth.js";
import { registerOAuthRoutes } from "./oauth.js";
import { registerPracticeRoutes } from "./practice.js";
import { MarketFeed } from "./market/feed.js";
import { registerMarketRoutes } from "./market/routes.js";
import { registerCommunityRoutes } from "./community.js";
import { registerStaticWeb } from "./static.js";

function isValidationError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "validation" in error;
}

function isRateLimitError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "statusCode" in error && error.statusCode === 429;
}

type AppDependencies = {
  pool: Pool;
  config: ApiConfig;
  market?: MarketFeed;
};

export async function buildApp(dependencies: AppDependencies) {
  const app = Fastify({
    logger: {
      redact: ["req.headers.cookie", "req.headers.authorization"],
    },
    bodyLimit: 16 * 1024,
  });
  app.setErrorHandler((error, request, reply) => {
    if (isValidationError(error)) {
      return reply.code(400).send({ message: "Invalid request." });
    }
    if (isRateLimitError(error)) {
      return reply.code(429).send({ message: "Too many attempts. Wait a while before trying again." });
    }
    // Malformed requests (bad JSON, empty JSON body…) are the caller's mistake, not a server failure.
    const status = typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 500;
    if (status >= 400 && status < 500) return reply.code(status).send({ message: "Invalid request." });
    request.log.error("Request failed.");
    return reply.code(500).send({ message: "The request could not be completed." });
  });
  const allowedOrigins = [...new Set([
    ...dependencies.config.webOrigin.split(",").map((origin) => origin.trim()).filter(Boolean),
    // The Android and iOS apps serve the web build from these origins.
    "https://localhost",
    "capacitor://localhost",
  ])];
  // @fastify/cors only allows GET, HEAD and POST by default; cancelling orders and settings use DELETE and PUT.
  await app.register(cors, { origin: allowedOrigins, credentials: true, methods: ["GET", "HEAD", "POST", "PUT", "DELETE"] });
  await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
  app.get("/health", async () => ({ status: "ok" }));
  // What's configured on this deployment, as yes/no only (never values), for checking a live site from outside.
  app.get("/v1/health", async () => {
    const { config } = dependencies;
    let database: "ok" | "missing" | "unreachable" = config.databaseUrl ? "ok" : "missing";
    if (config.databaseUrl) {
      try { await dependencies.pool.query("SELECT 1 FROM users LIMIT 1"); } catch { database = "unreachable"; }
    }
    return {
      status: database === "ok" && !config.problems.length ? "ok" : "degraded",
      database,
      sessionSecret: Boolean(process.env.AUTH_SESSION_SECRET && Buffer.byteLength(process.env.AUTH_SESSION_SECRET.trim()) >= 32),
      supabase: Boolean(config.supabase),
      webOrigin: config.webOrigin,
      problems: config.problems,
    };
  });
  await registerAuthRoutes(app, {
    pool: dependencies.pool,
    sessionSecret: dependencies.config.sessionSecret,
    environment: dependencies.config.environment,
    smtp: dependencies.config.smtp,
    supabase: dependencies.config.supabase,
    webOrigins: allowedOrigins,
  });
  await registerOAuthRoutes(app, { pool: dependencies.pool, config: dependencies.config });
  const market = dependencies.market ?? new MarketFeed(dependencies.pool);
  await registerPracticeRoutes(app, dependencies.pool, market);
  await registerMarketRoutes(app);
  await registerCommunityRoutes(app, dependencies.pool, market, dependencies.config.razorpay);
  if (dependencies.config.webRoot) registerStaticWeb(app, dependencies.config.webRoot);
  return app;
}
