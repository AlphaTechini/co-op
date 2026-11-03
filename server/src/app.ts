/** Fastify app factory. All side effects (chain, runtime, persistence) arrive through `AppDeps`, so tests need no chain. */
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import type { ActivityHub } from "./activity.js";
import type { ServerSettings } from "./settings.js";
import { SpawnError, type Spawner } from "./spawner.js";

export interface ServerInfo {
  network: string;
  /** RPC URL browsers should use (may differ from the server's own, e.g. a local sandbox). */
  rpcUrl: string;
  contractId: string;
  tokenId: string;
  explorerTxBase: string;
  explorerAccountBase: string;
  llm: boolean;
}

export interface AppDeps {
  settings: Pick<ServerSettings, "corsOrigin" | "trustProxy" | "rateLimitPerMin" | "spawnMaxBudgetNear" | "maxSseClients">;
  info: ServerInfo;
  hub: ActivityHub;
  spawner: Pick<Spawner, "spawn" | "list" | "status" | "remaining">;
  logger?: boolean;
}

const NAME = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

export function spawnBodySchema(maxBudgetNear: number) {
  return z.object({
    name: z
      .string({ error: "name is required" })
      .min(2, "name needs 2 to 24 characters")
      .max(24, "name needs 2 to 24 characters")
      .regex(NAME, "name may only use lowercase letters, digits and hyphens, and must start and end with a letter or digit")
      .refine((v) => !v.includes("--"), "name cannot contain two hyphens in a row"),
    brief: z
      .string({ error: "brief is required" })
      .trim()
      .min(3, "brief needs 3 to 200 characters")
      .max(200, "brief needs 3 to 200 characters"),
    budget_near: z
      .number({ error: "budget_near must be a number" })
      .refine((v) => Number.isFinite(v) && v > 0, "budget_near must be above 0")
      .refine((v) => v <= maxBudgetNear, `budget_near can be at most ${maxBudgetNear} NEAR`),
  });
}

const activityQuery = z.object({
  pool_id: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export async function buildServer(deps: AppDeps): Promise<FastifyInstance> {
  const { settings, info, hub, spawner } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: settings.trustProxy,
    bodyLimit: 4096,
  });

  app.addHook("onRequest", async (_req, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("x-frame-options", "DENY");
    reply.header("cross-origin-resource-policy", "cross-origin");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    reply.header("cache-control", "no-store");
  });

  await app.register(cors, {
    origin: settings.corsOrigin === "*" ? "*" : settings.corsOrigin.split(",").map((o) => o.trim()),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type"],
    exposedHeaders: ["Retry-After"],
    maxAge: 600,
  });

  await app.register(rateLimit, {
    global: true,
    max: settings.rateLimitPerMin,
    timeWindow: "1 minute",
    errorResponseBuilder: (_req, context) => ({
      statusCode: 429,
      error: "Too Many Requests",
      message: `Too many requests. Try again in ${Math.ceil(context.ttl / 1000)} seconds.`,
    }),
  });

  app.setErrorHandler((err: { statusCode?: number; message?: unknown; code?: string }, req, reply) => {
    const status = typeof err.statusCode === "number" && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) {
      req.log.error({ err }, "unhandled error");
      return reply.code(500).send({ error: "Internal error." });
    }
    const message =
      err.code === "FST_ERR_CTP_BODY_TOO_LARGE"
        ? "Request body is too large."
        : err.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
          ? "Send the body as application/json."
          : typeof err.message === "string"
            ? err.message
            : "Bad request.";
    return reply.code(status).send({ error: message });
  });

  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: "Not found." }));

  app.get("/api/health", async () => ({
    ok: true,
    network: info.network,
    contractId: info.contractId,
    llm: info.llm ? "on" : "off",
  }));

  app.get("/api/config", async () => {
    const status = spawner.status();
    return {
      network: info.network,
      rpcUrl: info.rpcUrl,
      contractId: info.contractId,
      tokenId: info.tokenId,
      explorerTxBase: info.explorerTxBase,
      explorerAccountBase: info.explorerAccountBase,
      spawn: {
        enabled: status.enabled,
        maxBudgetNear: settings.spawnMaxBudgetNear,
        remaining: spawner.remaining(),
        ...(status.reason ? { reason: status.reason } : {}),
      },
    };
  });

  app.get("/api/activity", async (req, reply) => {
    const q = activityQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ error: q.error.issues[0]?.message ?? "Invalid query." });
    const filter: { poolId?: number; limit: number } = { limit: q.data.limit };
    if (q.data.pool_id !== undefined) filter.poolId = q.data.pool_id;
    return hub.list(filter);
  });

  app.get("/api/stream", { config: { rateLimit: false } }, (_req, reply) => {
    if (hub.clientCount >= settings.maxSseClients) {
      return reply.code(503).send({ error: "Too many live connections. Try again shortly." });
    }
    reply.hijack();
    const inherited: Record<string, string | number | string[]> = {};
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) inherited[name] = value;
    reply.raw.writeHead(200, {
      ...inherited,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write("retry: 3000\n");
    hub.attach(reply.raw);
  });

  app.addHook("preClose", async () => hub.closeAll());

  app.get("/api/agents", async () => spawner.list());

  app.post(
    "/api/agents",
    { config: { rateLimit: { max: Math.min(settings.rateLimitPerMin, 20), timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = spawnBodySchema(settings.spawnMaxBudgetNear).safeParse(req.body);
      if (!body.success) {
        const issue = body.error.issues[0];
        const field = typeof issue?.path[0] === "string" ? issue.path[0] : undefined;
        return reply.code(400).send({ error: issue?.message ?? "Invalid request.", ...(field ? { field } : {}) });
      }
      try {
        const out = await spawner.spawn({
          name: body.data.name,
          brief: body.data.brief,
          budgetNear: body.data.budget_near,
          ip: req.ip,
        });
        return reply.code(200).send(out);
      } catch (e) {
        if (e instanceof SpawnError) {
          if (e.extra.retryAfterSec !== undefined) reply.header("retry-after", String(e.extra.retryAfterSec));
          return reply.code(e.status).send({ error: e.message, ...(e.extra.field ? { field: e.extra.field } : {}) });
        }
        throw e;
      }
    },
  );

  return app;
}
