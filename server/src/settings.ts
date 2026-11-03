/** Server settings from env, validated once at boot. Money is BigInt yoctoNEAR; decimals are parsed exactly. */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseNear } from "@coop/agents/money";
import { z } from "zod";

export const SERVER_DIR = fileURLToPath(new URL("..", import.meta.url));

export interface ServerSettings {
  port: number;
  host: string;
  corsOrigin: string;
  /** Believe X-Forwarded-For (set only behind a reverse proxy you control, such as Render). */
  trustProxy: boolean;
  spawnMaxAgents: number;
  /** Per-agent budget cap in NEAR (display/validation). */
  spawnMaxBudgetNear: number;
  spawnPerIpPerHour: number;
  /** NEAR the new agent account keeps for join/leave gas. */
  spawnGas: bigint;
  /** Spawning pauses (503) when the operator would drop below this after funding the agent. */
  operatorFloor: bigint;
  rateLimitPerMin: number;
  maxSseClients: number;
  /** Operator settles expired pools through the embedded runtime. */
  settler: boolean;
  sellerLoop: boolean;
  /** Decimal multiplier for the entry price (1 NEAR * scale). */
  priceScale: bigint;
  offerDurationMs: number;
  offerLockMs: number;
  runtimePollMs: number;
  dataFile: string;
}

const bool = (fallback: boolean) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === "") return fallback;
      if (["1", "true", "yes", "on"].includes(v.toLowerCase())) return true;
      if (["0", "false", "no", "off"].includes(v.toLowerCase())) return false;
      ctx.addIssue({ code: "custom", message: `expected 1/0, got "${v}"` });
      return z.NEVER;
    });

const num = (fallback: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().min(min).max(max));

const nearAmount = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v, ctx) => {
      try {
        return parseNear(v === undefined || v === "" ? fallback : v);
      } catch (e) {
        ctx.addIssue({ code: "custom", message: e instanceof Error ? e.message : String(e) });
        return z.NEVER;
      }
    });

export function loadSettings(env: NodeJS.ProcessEnv, network: "sandbox" | "testnet"): ServerSettings {
  const sandbox = network === "sandbox";
  const schema = z.object({
    PORT: num(8787, 0, 65535),
    HOST: z.string().optional().default("0.0.0.0"),
    CORS_ORIGIN: z.string().optional().default("*"),
    TRUST_PROXY: bool(false),
    SPAWN_MAX_AGENTS: num(40, 0, 10_000),
    SPAWN_MAX_BUDGET_NEAR: num(2, 0.000001, 1_000_000),
    SPAWN_PER_IP_PER_HOUR: num(3, 1, 10_000),
    SPAWN_GAS_NEAR: nearAmount("0.12"),
    SPAWN_MIN_OPERATOR_NEAR: nearAmount("1"),
    RATE_LIMIT_PER_MIN: num(60, 1, 100_000),
    MAX_SSE_CLIENTS: num(500, 1, 100_000),
    SETTLER: bool(true),
    SELLER_LOOP: bool(sandbox),
    PRICE_SCALE: nearAmount(sandbox ? "1" : "0.05"),
    OFFER_DURATION_SEC: num(sandbox ? 100 : 600, 20),
    OFFER_LOCK_SEC: num(sandbox ? 20 : 60, 1),
    RUNTIME_POLL_MS: num(sandbox ? 500 : 3000, 100),
    DATA_FILE: z.string().optional(),
  });
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server configuration: ${issues}`);
  }
  const p = parsed.data;
  if (p.OFFER_LOCK_SEC * 2 >= p.OFFER_DURATION_SEC) {
    throw new Error("Invalid server configuration: OFFER_LOCK_SEC must be well below OFFER_DURATION_SEC");
  }
  if (p.PRICE_SCALE <= 0n) throw new Error("Invalid server configuration: PRICE_SCALE must be above zero");
  return {
    port: p.PORT,
    host: p.HOST,
    corsOrigin: p.CORS_ORIGIN,
    trustProxy: p.TRUST_PROXY,
    spawnMaxAgents: p.SPAWN_MAX_AGENTS,
    spawnMaxBudgetNear: p.SPAWN_MAX_BUDGET_NEAR,
    spawnPerIpPerHour: p.SPAWN_PER_IP_PER_HOUR,
    spawnGas: p.SPAWN_GAS_NEAR,
    operatorFloor: p.SPAWN_MIN_OPERATOR_NEAR,
    rateLimitPerMin: p.RATE_LIMIT_PER_MIN,
    maxSseClients: p.MAX_SSE_CLIENTS,
    settler: p.SETTLER,
    sellerLoop: p.SELLER_LOOP,
    priceScale: p.PRICE_SCALE,
    offerDurationMs: p.OFFER_DURATION_SEC * 1000,
    offerLockMs: p.OFFER_LOCK_SEC * 1000,
    runtimePollMs: p.RUNTIME_POLL_MS,
    dataFile: p.DATA_FILE ?? join(SERVER_DIR, ".data", "agents.json"),
  };
}
