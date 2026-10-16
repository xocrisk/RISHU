import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

// Serves the Next.js static export for any GET/HEAD request that no API route handled.
export function registerStaticWeb(app: FastifyInstance, webRoot: string): void {
  const root = normalize(webRoot);

  app.setNotFoundHandler(async (request, reply) => {
    const pathname = decodeURIComponent(request.url.split("?")[0] ?? "/");
    if ((request.method !== "GET" && request.method !== "HEAD") || pathname.startsWith("/v1/")) {
      return reply.code(404).send({ message: "Not found." });
    }

    const target = normalize(join(root, pathname));
    if (target !== root && !target.startsWith(root + sep)) {
      return reply.code(404).send({ message: "Not found." });
    }

    const candidates = [target, join(target, "index.html"), `${target}.html`];
    for (const candidate of candidates) {
      if (await isFile(candidate)) {
        const type = contentTypes[extname(candidate).toLowerCase()] ?? "application/octet-stream";
        const cache = candidate.includes(`${sep}_next${sep}static${sep}`) ? "public, max-age=31536000, immutable" : "no-cache";
        return reply.code(200).header("content-type", type).header("cache-control", cache).send(await readFile(candidate));
      }
    }

    const notFoundPage = join(root, "404.html");
    if (await isFile(notFoundPage)) {
      return reply.code(404).header("content-type", contentTypes[".html"]).send(await readFile(notFoundPage));
    }
    return reply.code(404).send({ message: "Not found." });
  });
}
