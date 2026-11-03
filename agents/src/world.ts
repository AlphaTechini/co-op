/** A World bundles everything a run needs: network, provider, client, operator and deployed contracts. */
import { Account, KeyPair } from "near-api-js";
import {
  AGENT_METHODS,
  CoopClient,
  addFunctionCallKey,
  agentSigner,
  accountFromKey,
  createProvider,
  createSubAccount,
  type AddedKey,
} from "./chain.js";
import {
  SANDBOX_VERSION,
  explorerTxUrl,
  networkConfig,
  parseNetwork,
  requireEnv,
  type NetworkConfig,
  type NetworkName,
} from "./config.js";
import { deployStack, publicKeyOf, type Deployment } from "./deploy.js";
import { parseNear } from "./money.js";
import { startSandbox, type SandboxHandle } from "./sandbox.js";
import type { AgentLimits, TxRef } from "./types.js";
import type { Provider } from "near-api-js";

export interface World {
  network: NetworkName;
  netConfig: NetworkConfig;
  provider: Provider;
  client: CoopClient;
  operator: Account;
  operatorSecret: string;
  coopId: string;
  tokenId: string;
  /** Present when this process deployed the contracts. */
  deployment?: Deployment;
  sandbox?: SandboxHandle;
  /** Transactions sent while setting the world up (deploys, registrations). */
  setupTxs: TxRef[];
  stop(): Promise<void>;
}

export interface SandboxWorldOptions {
  log?: (line: string) => void;
  rpcPort?: number;
  version?: string;
  tokenSupply?: bigint;
}

/** Starts a fresh sandbox (nearcore 2.14.0), deploys the committed wasm and registers Co-op on the token. */
export async function createSandboxWorld(options: SandboxWorldOptions = {}): Promise<World> {
  const log = options.log ?? (() => undefined);
  const startOptions: { version?: string; rpcPort?: number } = { version: options.version ?? SANDBOX_VERSION };
  if (options.rpcPort !== undefined) startOptions.rpcPort = options.rpcPort;
  const sandbox = await startSandbox(startOptions);
  try {
    log(`sandbox nearcore ${sandbox.version} at ${sandbox.rpcUrl}`);
    const netConfig = networkConfig("sandbox", { NEAR_RPC_URL: sandbox.rpcUrl });
    const provider = createProvider(netConfig.rpcUrls);
    const operator = accountFromKey(sandbox.rootAccountId, provider, sandbox.rootSecretKey);
    // Contract ids are known only after deploy; the client for setup uses the operator as a placeholder.
    const setupClient = new CoopClient(provider, sandbox.rootAccountId);
    const deployOptions: Parameters<typeof deployStack>[0] = {
      client: setupClient,
      operator,
      operatorPublicKey: publicKeyOf(sandbox.rootSecretKey),
      operatorSecretKey: sandbox.rootSecretKey,
      log,
    };
    if (options.tokenSupply !== undefined) deployOptions.tokenSupply = options.tokenSupply;
    const deployment = await deployStack(deployOptions);
    const client = new CoopClient(provider, deployment.coopId, { tokenId: deployment.tokenId });
    return {
      network: "sandbox",
      netConfig,
      provider,
      client,
      operator,
      operatorSecret: sandbox.rootSecretKey,
      coopId: deployment.coopId,
      tokenId: deployment.tokenId,
      deployment,
      sandbox,
      setupTxs: deployment.txs,
      stop: () => sandbox.stop(),
    };
  } catch (e) {
    await sandbox.stop();
    throw e;
  }
}

/**
 * World for already-deployed contracts, from env: NEAR_NETWORK, NEAR_RPC_URL, COOP_CONTRACT_ID,
 * CREDITS_TOKEN_ID, OPERATOR_ACCOUNT_ID, OPERATOR_PRIVATE_KEY.
 */
export function worldFromEnv(env: NodeJS.ProcessEnv = process.env, networkOverride?: NetworkName): World {
  const network = networkOverride ?? parseNetwork(env.NEAR_NETWORK, "testnet");
  const netConfig = networkConfig(network, env);
  if (netConfig.rpcUrls.length === 0) throw new Error("NEAR_RPC_URL is required for the sandbox network");
  const provider = createProvider(netConfig.rpcUrls);
  const operatorId = requireEnv("OPERATOR_ACCOUNT_ID", env);
  const operatorSecret = requireEnv("OPERATOR_PRIVATE_KEY", env);
  const coopId = requireEnv("COOP_CONTRACT_ID", env);
  const tokenId = requireEnv("CREDITS_TOKEN_ID", env);
  const client = new CoopClient(provider, coopId, { tokenId, explorerTx: (h) => explorerTxUrl(netConfig, h) });
  return {
    network,
    netConfig,
    provider,
    client,
    operator: accountFromKey(operatorId, provider, operatorSecret),
    operatorSecret,
    coopId,
    tokenId,
    setupTxs: [],
    stop: async () => undefined,
  };
}

// ------------------------------------------------------------------------------------------------
// Agent provisioning
// ------------------------------------------------------------------------------------------------

export interface ProvisionedAgent {
  id: string;
  label: string;
  owner: string;
  /** Held by the owner side only: full access to the agent's own account (receives the delivered tokens). */
  fullSecret: string;
  /** What the runtime gets: function-call key limited to join_pool / leave_pool on the Co-op contract. */
  fcSecret: string;
  /** Signs with the function-call key only. */
  account: Account;
  txs: TxRef[];
}

export interface ProvisionOptions {
  label: string;
  limits: AgentLimits;
  /** Budget deposited into the contract (yocto). */
  budget: bigint;
  /** NEAR on the agent account itself, which pays gas for join/leave (default 0.25). */
  gasBalance?: bigint;
  /** Function-call key allowance; omitted = unlimited, the account balance is then the cap. */
  allowance?: bigint;
}

/**
 * Sub-account of the operator + function-call key + register_agent. Three transactions; the key and
 * the registration run in parallel once the account exists.
 */
export async function provisionAgent(world: World, options: ProvisionOptions): Promise<ProvisionedAgent> {
  const { client, operator } = world;
  const created = await createSubAccount(client, operator, options.label, options.gasBalance ?? parseNear("0.25"));
  const fullKey = created.keyPair as KeyPair;
  const agentFull = accountFromKey(created.accountId, world.provider, fullKey.toString());
  const [added, registered]: [AddedKey, TxRef] = await Promise.all([
    addFunctionCallKey(client, agentFull, world.coopId, [...AGENT_METHODS], options.allowance),
    client.registerAgent(operator, created.accountId, options.limits, options.budget),
  ]);
  const fcSecret = added.keyPair.toString();
  return {
    id: created.accountId,
    label: options.label,
    owner: operator.accountId,
    fullSecret: fullKey.toString(),
    fcSecret,
    account: agentSigner(created.accountId, world.provider, fcSecret),
    txs: [created.tx, added.tx, registered],
  };
}
