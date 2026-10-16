import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
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
  webRoot?: string;
};

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
    throw new Error(`${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET, and ${prefix}_REDIRECT_URI must be configured together`);
  }
  return { clientId, clientSecret, redirectUri };
}

function optionalSmtp(): SmtpConfig | undefined {
  const keys = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const values = keys.map((key) => process.env[key]?.trim());
  if (values.every((value, index) => index === 1 || !value)) return undefined;
  if (values.some((value) => !value)) {
    throw new Error(`${keys.join(", ")} must be configured together`);
  }
  const port = Number(values[1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SMTP_PORT must be a valid TCP port");
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
  const webRoot = process.env.WEB_ROOT?.trim() || fileURLToPath(new URL("../../web/out", import.meta.url));
  return existsSync(webRoot) ? webRoot : undefined;
}

export function loadConfig(): ApiConfig {
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
  const webOrigin = process.env.WEB_ORIGIN?.trim() || process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  if (!process.env.WEB_ORIGIN?.trim()) console.warn(`WEB_ORIGIN is not set; allowing CORS from ${webOrigin}.`);
  const databaseUrl = process.env.DATABASE_URL?.trim() || undefined;
  if (!databaseUrl) console.warn("DATABASE_URL is not set; database-backed routes will fail until it is configured.");

  return {
    environment: process.env.NODE_ENV ?? "development",
    host: process.env.HOST ?? (process.env.RENDER ? "0.0.0.0" : "127.0.0.1"),
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
    webRoot: resolveWebRoot(),
  };
}
