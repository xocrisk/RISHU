import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await pool.query("SELECT 1");
  const directory = resolve(process.cwd(), "migrations");
  const migrations = (await readdir(directory))
    .filter((name) => name.endsWith(".sql"))
    .sort();

  for (const name of migrations) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
      );
      const existing = await client.query(
        "SELECT 1 FROM schema_migrations WHERE name = $1",
        [name],
      );
      if (existing.rowCount === 0) {
        await client.query(await readFile(resolve(directory, name), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [name]);
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

try {
  await migrate();
  console.info("Database migrations are up to date.");
} catch (error) {
  console.error("Database migration failed.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
