import "dotenv/config";
import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { databaseConfig } from "./db.js";
import { MarketFeed } from "./market/feed.js";

const config = loadConfig();
// Keep connections open between requests: opening a new TLS connection to the database costs far more than a query.
const pool = new pg.Pool({ ...databaseConfig(config.databaseUrl), idleTimeoutMillis: 5 * 60_000, keepAlive: true });

const market = new MarketFeed(pool);
const app = await buildApp({
  pool,
  config,
  market,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    market.stop();
    await app.close();
    await pool.end();
  });
}

if (config.databaseUrl) {
  try {
    await pool.query("SELECT 1");
  } catch (error) {
    app.log.error("Database connection check failed; starting anyway.");
    console.error(error);
  }
}

try {
  await app.listen({ host: config.host, port: config.port });
  if (config.databaseUrl) market.start();
} catch (error) {
  app.log.error("API startup failed.");
  console.error(error);
  await pool.end();
  process.exitCode = 1;
}
