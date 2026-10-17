import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

// Supabase signs its Postgres certificates with its own root CA (certs/supabase-ca.crt, from Supabase's
// dashboard), so the connection is verified against that instead of switching verification off.
const supabaseCa = new URL("../certs/supabase-ca.crt", import.meta.url);

export function databaseConfig(connectionString?: string): PoolConfig {
  if (!connectionString) return {};
  const url = new URL(connectionString);
  if (!/\.supabase\.(com|co)$/.test(url.hostname)) return { connectionString };
  // An sslmode in the URL would override the CA below.
  url.searchParams.delete("sslmode");
  return { connectionString: url.toString(), ssl: { ca: readFileSync(supabaseCa, "utf8"), rejectUnauthorized: true } };
}
