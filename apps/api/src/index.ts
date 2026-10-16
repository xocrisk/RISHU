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

try {
  await pool.query("SELECT 1");
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error("API startup failed.");
  console.error(error);
  await pool.end();
  process.exitCode = 1;
}
