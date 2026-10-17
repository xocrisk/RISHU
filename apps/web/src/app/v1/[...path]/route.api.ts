// On Vercel the XOCRISK API runs inside the website: every /v1/... request is handed to the same Fastify app
// the standalone server uses, so cookies, rate limits and validation behave identically.
// (The ".api.ts" name keeps this file out of the static export used for the mobile app.)
import { waitUntil } from "@vercel/functions";
import { serverlessApp } from "@xocrisk/api/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Method = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "OPTIONS";

async function handle(request: Request): Promise<Response> {
  try {
    return await forward(request);
  } catch (error) {
    // Without this the platform answers with an empty 500 and the page can't show any message.
    console.error("XOCRISK API failed before it could answer:", error);
    const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return Response.json({
      message: "XOCRISK is having trouble right now. Try again in a minute.",
      // Short, credential-free reason to make a broken deployment diagnosable from outside.
      detail: /:\/\/|@|password/i.test(text) ? "hidden" : text.slice(0, 200),
    }, { status: 503 });
  }
}

async function forward(request: Request): Promise<Response> {
  const app = await serverlessApp(waitUntil);
  const url = new URL(request.url);
  // Pages use trailing slashes; API routes don't.
  const path = `${url.pathname.replace(/\/+$/, "")}${url.search}`;
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : Buffer.from(await request.arrayBuffer());
  const result = await app.inject({
    method: request.method as Method,
    url: path,
    headers: Object.fromEntries(request.headers),
    payload: body && body.length ? body : undefined,
    remoteAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1",
  });

  const headers = new Headers();
  for (const [name, value] of Object.entries(result.headers)) {
    if (value === undefined || ["content-length", "transfer-encoding", "connection"].includes(name)) continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, String(item));
    else headers.set(name, String(value));
  }
  const empty = request.method === "HEAD" || result.statusCode === 204 || result.statusCode === 304 || result.rawPayload.length === 0;
  return new Response(empty ? null : new Uint8Array(result.rawPayload), { status: result.statusCode, headers });
}

export { handle as DELETE, handle as GET, handle as HEAD, handle as OPTIONS, handle as POST, handle as PUT };
