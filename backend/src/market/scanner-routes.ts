import type { FastifyInstance } from "fastify";
import type { ScanRequest } from "@xocrisk/core";
import { MarketScanner, ScannerError } from "./scanner.js";

export async function registerScannerRoutes(app: FastifyInstance, scanner = new MarketScanner()): Promise<void> {
  app.get<{ Querystring: ScanRequest }>("/v1/market/scan", {
    config: { rateLimit: { max: 8, timeWindow: "1 minute" } },
    schema: { querystring: { type: "object", additionalProperties: false, properties: {
      mode: { type: "string", enum: ["daily", "orb"], default: "daily" },
      scope: { type: "string", enum: ["nifty50", "nifty500"] },
      symbol: { type: "string", minLength: 1, maxLength: 30, pattern: "^[A-Z0-9&-]+$" },
    } } },
  }, async (request, reply) => {
    if (!request.authUser) return reply.code(401).send({ message: "Sign in to scan the market." });
    reply.header("Cache-Control", "private, no-store");
    try { return await scanner.scan(request.query); }
    catch (error) {
      if (error instanceof ScannerError) return reply.code(error.statusCode).send({ message: error.message });
      request.log.warn("Market scanner unavailable.");
      return reply.code(502).send({ message: "Market analysis is temporarily unavailable. Please try again." });
    }
  });
}
