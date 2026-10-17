import type { NextConfig } from "next";

// In production the API serves this static export from the same origin, so API calls use relative URLs
// unless NEXT_PUBLIC_API_URL points somewhere else (the mobile app build sets it to the live site).
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? (process.env.NODE_ENV === "production" ? "" : undefined);

const nextConfig: NextConfig = {
  output: "export",
  ...(apiUrl === undefined ? {} : { env: { NEXT_PUBLIC_API_URL: apiUrl } }),
  trailingSlash: true,
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: false,
  partialPrefetching: false,
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
