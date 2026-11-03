/**
 * `make demo`: one process with a local sandbox (Co-op deployed), this server with the seller loop and
 * settler on, and 12 scripted agents that join each new offer a few seconds apart so the dashboard is
 * always moving. Visitors spawn their own agents into the same live pool through the API.
 *
 * Connection info for the web dev server is written to the git-ignored `.sandbox/env`.
 * The sandbox operator key is the public near-sandbox default; it is worthless outside this machine.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { SANDBOX_DIR, SANDBOX_ENV_FILE, loadEnv } from "@coop/agents/config";
import { buildRoster } from "@coop/agents/roster";
import { provisionRoster } from "@coop/agents/scenario";
import { createSandboxWorld, type ProvisionedAgent, type World } from "@coop/agents/world";
import type { TxRef } from "@coop/agents/types";
import { chainFromWorld, createCoop } from "./node.js";
import { loadSettings } from "./settings.js";
import { MemoryAgentStore } from "./store.js";

const STAGGER_MS = 3000;

function writeEnvFile(world: World, apiPort: number): void {
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
    `PUBLIC_API_URL=http://localhost:${apiPort}`,
    "",
  ];
  mkdirSync(SANDBOX_DIR, { recursive: true });
  writeFileSync(SANDBOX_ENV_FILE, lines.join("\n"));
}

async function main(): Promise<void> {
  loadEnv();
  const log = (line: string) => console.log(line);
  const world = await createSandboxWorld({ rpcPort: Number(process.env.DEMO_RPC_PORT ?? 3030), log });
  const settings = loadSettings({ ...process.env, NEAR_NETWORK: "sandbox", SELLER_LOOP: "1", SETTLER: "1" }, "sandbox");
  writeEnvFile(world, settings.port);
  console.log(`\nSandbox ready at ${world.sandbox?.rpcUrl}`);
  console.log(`Co-op ${world.coopId}, token ${world.tokenId}`);

  const chain = chainFromWorld(world);
  const roster = buildRoster(12, settings.priceScale, "demo");
  const provisioned = new Map<string, ProvisionedAgent>();
  const timers = new Set<NodeJS.Timeout>();
  const setupTxs: Array<TxRef & { phase: string }> = [];

  const coop = await createCoop({
    env: { ...process.env, PUBLIC_RPC_URL: world.sandbox?.rpcUrl ?? "" },
    settings,
    chain,
    store: new MemoryAgentStore(),
    logger: false,
    log,
    sellerHooks: {
      // Between offers: drop last round's scripted agents and top up the ones that spent their budget.
      beforePost: async () => {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        for (const agent of provisioned.values()) coop.runtime.removeAgent(agent.id);
        await provisionRoster(world, roster, provisioned, setupTxs, 6);
      },
      afterPost: (offerId) => {
        console.log(`offer ${offerId} is open; ${roster.length} scripted agents arrive over the next ${(roster.length * STAGGER_MS) / 1000}s`);
        roster.forEach((entry, i) => {
          const agent = provisioned.get(entry.label);
          if (!agent) return;
          const timer = setTimeout(() => {
            timers.delete(timer);
            coop.runtime.addAgent({ id: agent.id, account: agent.account, policy: entry.policy, label: entry.label });
          }, 1000 + i * STAGGER_MS);
          timers.add(timer);
        });
      },
    },
  });

  await coop.app.listen({ port: settings.port, host: settings.host });
  coop.start();
  console.log(`Co-op server on http://localhost:${settings.port} (spawn ${coop.spawner.status().enabled ? "on" : "off"}, seller loop on)`);

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`${signal}: stopping`);
    for (const timer of timers) clearTimeout(timer);
    void coop
      .stop()
      .catch((e: unknown) => console.error(e))
      .finally(() => world.stop().finally(() => process.exit(0)));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  process.exit(1);
});
