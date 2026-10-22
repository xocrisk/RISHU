import type { NextConfig } from "next";

// Two builds come from this app:
// - the website (Vercel): pages plus the API itself under /v1 (src/app/v1/[...path]/route.api.ts),
//   so the browser calls the API on the same origin with relative URLs;
// - the mobile app (XOCRISK_STATIC_EXPORT=1): plain static files for Capacitor, which call the live site's API
//   through NEXT_PUBLIC_API_URL. Route files end in ".api.ts" so this build leaves them out.
const staticExport = process.env.XOCRISK_STATIC_EXPORT === "1";
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "" : undefined);
const pageExtensions = ["tsx", "ts", "jsx", "js"];

const nextConfig: NextConfig = {
  ...(staticExport ? { output: "export" as const } : {}),
  pageExtensions: staticExport ? pageExtensions : [...pageExtensions, "api.ts"],
  ...(apiUrl === undefined ? {} : { env: { NEXT_PUBLIC_API_URL: apiUrl } }),
  trailingSlash: true,
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: false,
  partialPrefetching: false,
  // The API (built to backend/dist first by turbo) and its server-only libraries stay plain Node modules.
  transpilePackages: ["@xocrisk/core"],
  serverExternalPackages: ["@xocrisk/api", "fastify", "pg", "nodemailer", "@fastify/cors", "@fastify/rate-limit", "@fastify/formbody", "jose"],
  // Basic hardening for the website: no framing (clickjacking), no MIME sniffing, no referrer leaks off-site,
  // and no camera/mic/location for any page. (Static export has no server, so headers don't apply there.)
  ...(staticExport ? {} : {
    async headers() {
      return [{
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      }];
    },
  }),
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
