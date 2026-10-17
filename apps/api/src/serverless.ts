import type { FastifyInstance } from "fastify";
import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { databaseConfig } from "./db.js";
import { MarketFeed } from "./market/feed.js";

// The API as a serverless function (Vercel): one Fastify app per warm instance, fed requests with inject().
// There's no timer here; prices refresh when a request finds them stale, kept alive by `background`.
let ready: Promise<FastifyInstance> | null = null;

export function serverlessApp(background?: (work: Promise<unknown>) => void): Promise<FastifyInstance> {
  ready ??= (async () => {
    // The website is served by the platform, not by this app.
    const config = { ...loadConfig(), webRoot: undefined };
    const pool = new pg.Pool({ ...databaseConfig(config.databaseUrl, { serverless: true }), max: 3, idleTimeoutMillis: 30_000 });
    const market = new MarketFeed(pool, console, () => new Date(), background);
    const app = await buildApp({ pool, config, market });
    await app.ready();
    return app;
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}
