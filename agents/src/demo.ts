/**
 * `make demo`: a long-lived local sandbox with Co-op deployed, and a new 12-agent offer roughly every
 * two minutes so the dashboard always has something moving. Connection info for server and web is
 * written to the git-ignored `.sandbox/env`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { SANDBOX_DIR, SANDBOX_ENV_FILE, REPO_ROOT, loadEnv } from "./config.js";
import { formatNear, parseNear } from "./money.js";
import { defaultOptions, runScenario } from "./scenario.js";
import { buildRoster } from "./roster.js";
import { sleep } from "./chain.js";
import { createSandboxWorld, type ProvisionedAgent, type World } from "./world.js";

const CYCLE_MS = 120_000;

function writeEnvFile(world: World): void {
  const rpc = world.sandbox?.rpcUrl ?? "";
  const lines = [
    "# Written by `make demo`. Local sandbox only: the key below is the public near-sandbox default.",
    "NEAR_NETWORK=sandbox",
    `NEAR_RPC_URL=${rpc}`,
    `COOP_CONTRACT_ID=${world.coopId}`,
    `CREDITS_TOKEN_ID=${world.tokenId}`,
    `OPERATOR_ACCOUNT_ID=${world.operator.accountId}`,
    `OPERATOR_PRIVATE_KEY=${world.operatorSecret}`,
    "PUBLIC_NETWORK=sandbox",
    `PUBLIC_RPC_URL=${rpc}`,
    `PUBLIC_COOP_CONTRACT_ID=${world.coopId}`,
    "",
  ];
  mkdirSync(SANDBOX_DIR, { recursive: true });
  writeFileSync(SANDBOX_ENV_FILE, lines.join("\n"));
}

async function main(): Promise<void> {
  loadEnv();
  const port = Number(process.env.DEMO_RPC_PORT ?? 3030);
  const world = await createSandboxWorld({ rpcPort: port, log: (l) => console.log(l) });
  writeEnvFile(world);
  console.log(`\nSandbox ready at ${world.sandbox?.rpcUrl}`);
  console.log(`Co-op ${world.coopId}, token ${world.tokenId}. Connection info: ${SANDBOX_ENV_FILE.replace(`${REPO_ROOT}/`, "")}`);

  const options = defaultOptions("sandbox");
  const top = parseNear("1");
  const roster = buildRoster(12, top, "demo");
  // Agents persist across rounds; runScenario tops their budgets up when they run low.
  const provisioned = new Map<string, ProvisionedAgent>();
  for (let round = 1; ; round++) {
    const started = Date.now();
    try {
      console.log(`\n=== round ${round}: new offer, ${roster.length} agents ===`);
      const result = await runScenario(world, {
        ...options,
        agents: roster.length,
        topPrice: top,
        prefix: "demo",
        title: `Demo API credits, round ${round}`,
        durationMs: 100_000,
        lockWindowMs: 20_000,
        staggerMs: 3_000,
        withdraw: false,
        provisioned,
        log: (line) => console.log(line),
      });
      const pool = result.verification.pool;
      console.log(
        `round ${round}: pool ${result.offerId} ${pool.status}, ${pool.result?.units ?? 0} units, invariants ${result.ok ? "hold" : "VIOLATED"}, seller payout ${formatNear(BigInt(pool.result?.seller_payout ?? "0"), 2)} NEAR`,
      );
    } catch (e) {
      console.error(`round ${round} failed:`, e instanceof Error ? e.message : e);
    }
    const wait = Math.max(10_000, CYCLE_MS - (Date.now() - started));
    console.log(`next offer in ${Math.round(wait / 1000)}s`);
    await sleep(wait);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
