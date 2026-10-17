import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type ApiConfig = {
  environment: string;
  host: string;
  port: number;
  webOrigin: string;
  databaseUrl?: string;
  sessionSecret: string;
  googleOAuth?: OAuthProviderConfig;
  microsoftOAuth?: OAuthProviderConfig & { tenantId: string };
  smtp?: SmtpConfig;
  razorpay?: RazorpayConfig;
  supabase?: SupabaseConfig;
  webRoot?: string;
  /** Settings that were filled in incompletely (feature turned off). Names only, never values. */
  problems: string[];
};

// A half-filled optional setting (e.g. a Google client ID without its secret) switches that feature off
// and is reported by /v1/health, instead of stopping the whole API from starting.
const problems: string[] = [];
function misconfigured(problem: string): undefined {
  console.error(`Configuration problem: ${problem}. That feature is turned off.`);
  problems.push(problem);
  return undefined;
}

export type RazorpayConfig = { keyId: string; keySecret: string };
export type SupabaseConfig = { url: string; secretKey: string };

function optionalSupabase(): SupabaseConfig | undefined {
  const url = process.env.SUPABASE_URL?.trim().replace(/\/$/, "");
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url && !secretKey) return undefined;
  if (!url || !secretKey) return misconfigured("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured together");
  return { url, secretKey };
}

function optionalRazorpay(): RazorpayConfig | undefined {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim();
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();
  if (!keyId && !keySecret) return undefined;
  if (!keyId || !keySecret) return misconfigured("RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET must be configured together");
  return { keyId, keySecret };
}

export type OAuthProviderConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
};

function optionalProvider(prefix: string): OAuthProviderConfig | undefined {
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim();
  const redirectUri = process.env[`${prefix}_REDIRECT_URI`]?.trim();
  if (!clientId && !clientSecret && !redirectUri) return undefined;
  if (!clientId || !clientSecret || !redirectUri) {
    return misconfigured(`${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET, and ${prefix}_REDIRECT_URI must be configured together`);
  }
  return { clientId, clientSecret, redirectUri };
}

function optionalSmtp(): SmtpConfig | undefined {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const values = keys.map((key) => process.env[key]?.trim());
  if (values.every((value, index) => index === 1 || !value)) return undefined;
  if (values.some((value) => !value)) {
    return misconfigured(`${keys.join(", ")} must be configured together`);
  }
  const port = Number(values[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return misconfigured("SMTP_PORT must be a valid TCP port");
  }
  return {
    host: values[0]!,
    port,
    secure: process.env.SMTP_SECURE === "true",
    user: values[2]!,
    password: values[3]!,
    from: values[4]!,
  };
}

function resolveWebRoot(): string | undefined {
  // Built with path.resolve (not new URL(...)) so bundlers don't mistake the folder for a file to bundle.
  const webRoot = process.env.WEB_ROOT?.trim() || resolve(dirname(fileURLToPath(import.meta.url)), "../../web/out");
  return existsSync(webRoot) ? webRoot : undefined;
}

export function loadConfig(): ApiConfig {
  problems.length = 0;
  const port = Number(process.env.PORT ?? "4000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port");
  }
  let sessionSecret = process.env.AUTH_SESSION_SECRET?.trim();
  if (!sessionSecret || Buffer.byteLength(sessionSecret, "utf8") < 32) {
    console.warn(
      "AUTH_SESSION_SECRET is missing or shorter than 32 bytes; using a random secret. Sessions will reset on every restart.",
    );
    sessionSecret = randomBytes(32).toString("hex");
  }
  const webOrigin = process.env.WEB_ORIGIN?.trim() || "http://localhost:3000";
  if (!process.env.WEB_ORIGIN?.trim()) console.warn(`WEB_ORIGIN is not set; allowing CORS from ${webOrigin}.`);
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  if (!databaseUrl) console.warn("DATABASE_URL is not set; database-backed routes will fail until it is configured.");

  return {
    environment: process.env.NODE_ENV ?? "development",
    // Production hosts need every interface; locally "localhost" covers both 127.0.0.1 and ::1.
    host: process.env.HOST ?? (process.env.NODE_ENV === "production" ? "0.0.0.0" : "localhost"),
    port,
    webOrigin,
    databaseUrl,
    sessionSecret,
    googleOAuth: optionalProvider("GOOGLE_OAUTH"),
    microsoftOAuth: (() => {
      const provider = optionalProvider("MICROSOFT_OAUTH");
      return provider ? { ...provider, tenantId: process.env.MICROSOFT_TENANT_ID?.trim() || "common" } : undefined;
    })(),
    smtp: optionalSmtp(),
    razorpay: optionalRazorpay(),
    supabase: optionalSupabase(),
    webRoot: resolveWebRoot(),
    problems,
  };
}
