// Builds the website as plain static files for the Capacitor mobile app (no /v1 API routes inside).
// The app talks to the live site's API. This overrides frontend/.env.local (which points at a local dev API);
// set XOCRISK_APP_API_URL to build an app against another server.
import { execSync } from "node:child_process";

const apiUrl = process.env.XOCRISK_APP_API_URL || "https://xocrisk.dpdns.org";
execSync("npm run build --workspace web", {
  stdio: "inherit",
  env: { ...process.env, XOCRISK_STATIC_EXPORT: "1", NEXT_PUBLIC_API_URL: apiUrl },
});
