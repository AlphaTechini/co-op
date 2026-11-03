/** Wires the real chain, the embedded AgentRuntime, persistence and the HTTP app together. */
import type { FastifyInstance } from "fastify";
import type { Account } from "near-api-js";
import { parseBrief, llmConfigFromEnv } from "@coop/agents/brief";
import { CoopClient, accountFromKey, agentSigner, createProvider } from "@coop/agents/chain";
import { explorerTxUrl, networkConfig, parseNetwork, requireEnv, type NetworkConfig, type NetworkName } from "@coop/agents/config";
import { AgentRuntime } from "@coop/agents/runtime";
import { createSandboxWorld, provisionAgent, worldFromEnv, type World } from "@coop/agents/world";
import { ActivityHub } from "./activity.js";
import { buildServer, type ServerInfo } from "./app.js";
import { SellerLoop, type SellerLoopOptions } from "./seller-loop.js";
import type { ServerSettings } from "./settings.js";
import { Spawner, type SpawnChainPort } from "./spawner.js";
import { FileAgentStore, type AgentStore } from "./store.js";
import type { Provider } from "near-api-js";

/** What the server needs from the chain. `operator` is null when no operator key is configured (read-only mode). */
export interface Chain {
  network: NetworkName;
  netConfig: NetworkConfig;
  provider: Provider;
  client: CoopClient;
  coopId: string;
  tokenId: string;
  operatorId: string;
  operator: Account | null;
  world: World | null;
}

export function chainFromWorld(world: World): Chain {
  return {
    network: world.network,
    netConfig: world.netConfig,
    provider: world.provider,
    client: world.client,
    coopId: world.coopId,
    tokenId: world.tokenId,
    operatorId: world.operator.accountId,
    operator: world.operator,
    world,
  };
}

/** From env. Without OPERATOR_PRIVATE_KEY the server still serves the feed and config, with spawning disabled. */
export function chainFromEnv(env: NodeJS.ProcessEnv): Chain {
  if (env.OPERATOR_PRIVATE_KEY) return chainFromWorld(worldFromEnv(env));
  const network = parseNetwork(env.NEAR_NETWORK, "testnet");
  const netConfig = networkConfig(network, env);
  if (netConfig.rpcUrls.length === 0) throw new Error("NEAR_RPC_URL is required for the sandbox network");
  const provider = createProvider(netConfig.rpcUrls);
  const coopId = requireEnv("COOP_CONTRACT_ID", env);
  const tokenId = requireEnv("CREDITS_TOKEN_ID", env);
  const client = new CoopClient(provider, coopId, { tokenId, explorerTx: (h) => explorerTxUrl(netConfig, h) });
  const operatorId = env.OPERATOR_ACCOUNT_ID || coopId.split(".").slice(1).join(".") || coopId;
  return { network, netConfig, provider, client, coopId, tokenId, operatorId, operator: null, world: null };
}

const MISSING = /does not exist|UnknownAccount|AccountDoesNotExist|doesn't exist/i;

export function spawnPort(chain: Chain): SpawnChainPort {
  const { world, provider, client } = chain;
  const need = (): World => {
    if (!world) throw new Error("No operator key configured");
    return world;
  };
  return {
    async accountExists(accountId) {
      try {
        await provider.viewAccount({ accountId, blockQuery: { finality: "optimistic" } });
        return true;
      } catch (e) {
        const text = `${e instanceof Error ? `${e.name} ${e.message}` : String(e)}`;
        if (MISSING.test(text)) return false;
        throw e;
      }
    },
    operatorBalance: () => client.accountBalance(chain.operatorId),
    async isRegistered(agentId) {
      try {
        return (await client.getAgent(agentId)) !== null;
      } catch {
        return null;
      }
    },
    async provision(options) {
      const p = await provisionAgent(need(), options);
      return { id: p.id, fcSecret: p.fcSecret, fullSecret: p.fullSecret, account: p.account, txs: p.txs };
    },
    signer: (agentId, fcSecret) => agentSigner(agentId, provider, fcSecret),
  };
}

export interface Coop {
  app: FastifyInstance;
  hub: ActivityHub;
  runtime: AgentRuntime;
  spawner: Spawner;
  sellerLoop: SellerLoop | null;
  /** Starts the runtime (and the seller loop, if enabled). The HTTP listener is the caller's. */
  start(): void;
  /** Stops HTTP, the loops and the runtime. Does not stop a sandbox the caller started. */
  stop(): Promise<void>;
}

export interface CreateCoopOptions {
  env: NodeJS.ProcessEnv;
  settings: ServerSettings;
  chain: Chain;
  store?: AgentStore;
  logger?: boolean;
  log?: (line: string) => void;
  /** Extra hooks around the seller loop's offers (the demo's scripted agents). */
  sellerHooks?: Pick<SellerLoopOptions, "beforePost" | "afterPost">;
}

export async function createCoop(o: CreateCoopOptions): Promise<Coop> {
  const { chain, settings, env } = o;
  const log = o.log ?? (() => undefined);
  const hub = new ActivityHub(2000);
  const runtime = new AgentRuntime({
    client: chain.client,
    pollMs: settings.runtimePollMs,
    settler: settings.settler ? chain.operator : null,
  });
  runtime.onActivity((entry) => hub.publish(entry));

  const spawner = new Spawner({
    chain: spawnPort(chain),
    runtime,
    store: o.store ?? new FileAgentStore(settings.dataFile, { network: chain.network, contractId: chain.coopId }),
    emit: (entry) => void hub.emit(entry),
    parseBrief: (brief) => parseBrief(brief, { env }),
    operatorId: chain.operatorId,
    maxAgents: settings.spawnMaxAgents,
    enabled: chain.operator !== null,
    disabledReason: "Spawning is disabled: this server has no operator key.",
    perIpPerHour: settings.spawnPerIpPerHour,
    spawnGas: settings.spawnGas,
    operatorFloor: settings.operatorFloor,
    log,
  });

  const info: ServerInfo = {
    network: chain.network,
    rpcUrl: env.PUBLIC_RPC_URL || chain.netConfig.rpcUrls[0] || "",
    contractId: chain.coopId,
    tokenId: chain.tokenId,
    explorerTxBase: chain.netConfig.explorerTxBase ?? "",
    explorerAccountBase: chain.netConfig.explorerAccountBase ?? "",
    llm: llmConfigFromEnv(env) !== null,
  };
  const app = await buildServer({ settings, info, hub, spawner, logger: o.logger ?? false });

  const sellerLoop =
    settings.sellerLoop && chain.operator
      ? new SellerLoop({
          client: chain.client,
          seller: chain.operator,
          tokenId: chain.tokenId,
          entryPrice: settings.priceScale,
          durationMs: settings.offerDurationMs,
          lockWindowMs: settings.offerLockMs,
          intervalMs: Math.max(1000, settings.runtimePollMs * 2),
          balanceFloor: settings.operatorFloor,
          emit: (entry) => void hub.emit(entry),
          ...o.sellerHooks,
        })
      : null;

  let started = false;
  return {
    app,
    hub,
    runtime,
    spawner,
    sellerLoop,
    start() {
      if (started) return;
      started = true;
      runtime.start();
      sellerLoop?.start();
    },
    async stop() {
      await app.close();
      await sellerLoop?.stop();
      await runtime.stop();
    },
  };
}

export { createSandboxWorld, accountFromKey };
