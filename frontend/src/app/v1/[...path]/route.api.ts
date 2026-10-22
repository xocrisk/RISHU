// Server-only deployment bridge. All API logic and configuration live in backend/.
// The .api.ts suffix excludes this route from the mobile static export.
import { waitUntil } from "@vercel/functions";
import { handle } from "@xocrisk/api/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const preferredRegion = "hnd1";

function forward(request: Request): Promise<Response> {
  return handle(request, waitUntil);
}

export { forward as DELETE, forward as GET, forward as HEAD, forward as OPTIONS, forward as POST, forward as PUT };
