import type { NextConfig } from "next";

// On Render the API serves this static export from the same origin, so API calls use relative URLs.
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? (process.env.RENDER ? "" : undefined);

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
