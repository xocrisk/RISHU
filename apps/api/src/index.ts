import "dotenv/config";
import pg from "pg";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl });

const app = await buildApp({
  pool,
  config,
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
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
} catch (error) {
  app.log.error("API startup failed.");
  console.error(error);
  await pool.end();
  process.exitCode = 1;
}
