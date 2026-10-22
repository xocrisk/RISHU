// Server-only adapter shared by the website deployment.
type Method = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "OPTIONS";

export async function handle(request: Request, background?: (work: Promise<unknown>) => void): Promise<Response> {
  try {
    return await forward(request, background);
  } catch (error) {
    // Without this the platform answers with an empty 500 and the page can't show any message.
    console.error("XOCRISK API failed before it could answer:", error);
    return Response.json({
      message: "XOCRISK is having trouble right now. Try again in a minute.",
    }, { status: 503 });
  }
}

async function forward(request: Request, background?: (work: Promise<unknown>) => void): Promise<Response> {
  // Loaded here, not at the top, so even a failure while loading the API is caught and reported below.
  const { serverlessApp } = await import("./serverless.js");
  const app = await serverlessApp(background);
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
