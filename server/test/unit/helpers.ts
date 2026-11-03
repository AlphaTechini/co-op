import type { Account } from "near-api-js";
import { parseBriefWithRules } from "@coop/agents/brief";
import { parseNear } from "@coop/agents/money";
import type { RuntimeAgent } from "@coop/agents/runtime";
import type { TxRef } from "@coop/agents/types";
import { ActivityHub } from "../../src/activity.js";
import { buildServer, type AppDeps } from "../../src/app.js";
import type { ServerSettings } from "../../src/settings.js";
import { Spawner, type SpawnChainPort, type SpawnerOptions } from "../../src/spawner.js";
import { MemoryAgentStore } from "../../src/store.js";

export const OPERATOR = "op.test.near";

export const settings: ServerSettings = {
  port: 0,
  host: "127.0.0.1",
  corsOrigin: "*",
  trustProxy: false,
  spawnMaxAgents: 5,
  spawnMaxBudgetNear: 2,
  spawnPerIpPerHour: 3,
  spawnGas: parseNear("0.12"),
  operatorFloor: parseNear("1"),
  rateLimitPerMin: 100,
  maxSseClients: 10,
  settler: true,
  sellerLoop: false,
  priceScale: parseNear("1"),
  offerDurationMs: 100_000,
  offerLockMs: 20_000,
  runtimePollMs: 500,
  dataFile: "/nonexistent/agents.json",
};

const tx = (method: string, signer: string, receiver: string): TxRef => ({
  hash: `hash-${method}-${receiver}`,
  signer,
  receiver,
  method,
  gas_burnt: "1000",
  events: [{ standard: "x", version: "1", event: "e", data: [] }],
});

export class FakeChain implements SpawnChainPort {
  existing = new Set<string>();
  balance = parseNear("100");
  registered = new Map<string, boolean | null>();
  provisioned: Array<{ label: string; budget: bigint }> = [];
  fail = false;
  async accountExists(id: string) {
    return this.existing.has(id);
  }
  async operatorBalance() {
    return this.balance;
  }
  async isRegistered(id: string) {
    return this.registered.get(id) ?? true;
  }
  async provision(o: Parameters<SpawnChainPort["provision"]>[0]) {
    if (this.fail) throw new Error("boom with internal details");
    this.provisioned.push({ label: o.label, budget: o.budget });
    const id = `${o.label}.${OPERATOR}`;
    this.existing.add(id);
    return {
      id,
      fcSecret: "ed25519:FC-SECRET-VALUE",
      fullSecret: "ed25519:FULL-SECRET-VALUE",
      account: { accountId: id } as unknown as Account,
      txs: [tx("create_account", OPERATOR, id), tx("add_key", id, id), tx("register_agent", OPERATOR, "coop.test.near")],
    };
  }
  signer(id: string) {
    return { accountId: id } as unknown as Account;
  }
}

export class FakeRuntime {
  agents = new Map<string, RuntimeAgent>();
  addAgent(a: RuntimeAgent) {
    this.agents.set(a.id, a);
  }
  removeAgent(id: string) {
    return this.agents.delete(id);
  }
}

export async function harness(over: { settings?: Partial<ServerSettings>; spawner?: Partial<SpawnerOptions>; now?: () => number } = {}) {
  const s = { ...settings, ...over.settings };
  const hub = new ActivityHub(50);
  const chain = new FakeChain();
  const runtime = new FakeRuntime();
  const store = new MemoryAgentStore();
  const spawner = new Spawner({
    chain,
    runtime,
    store,
    emit: (e) => void hub.emit(e),
    parseBrief: async (b) => parseBriefWithRules(b),
    operatorId: OPERATOR,
    maxAgents: s.spawnMaxAgents,
    enabled: true,
    perIpPerHour: s.spawnPerIpPerHour,
    spawnGas: s.spawnGas,
    operatorFloor: s.operatorFloor,
    ...(over.now ? { now: over.now } : {}),
    ...over.spawner,
  });
  const deps: AppDeps = {
    settings: s,
    info: {
      network: "sandbox",
      rpcUrl: "http://127.0.0.1:3030",
      contractId: "coop.test.near",
      tokenId: "token.test.near",
      explorerTxBase: "",
      explorerAccountBase: "",
      llm: false,
    },
    hub,
    spawner,
  };
  const app = await buildServer(deps);
  return { app, hub, chain, runtime, store, spawner };
}

export const goodBody = { name: "alice-bot", brief: "buy 3 credits if the price drops below 0.6", budget_near: 2 };
