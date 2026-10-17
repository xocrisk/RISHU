// Builds the website as plain static files for the Capacitor mobile app (no /v1 API routes inside).
// Set NEXT_PUBLIC_API_URL to the live site (e.g. https://xocrisk.dpdns.org) so the app can reach the API.
import { execSync } from "node:child_process";

execSync("npm run build --workspace web", { stdio: "inherit", env: { ...process.env, XOCRISK_STATIC_EXPORT: "1" } });
