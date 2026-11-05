/**
 * Wallet spawn: the visitor's own wallet creates and funds the agents, the server only runs them.
 *
 * 1. prepare: the server parses the brief, generates one function-call key per agent, stores it (key
 *    first, as in spawner.ts) and returns the public keys plus the exact deposits.
 * 2. The browser asks the wallet to sign, per agent, a sub-account of the visitor (CreateAccount,
 *    Transfer for gas, AddKey for that function-call key, AddKey for a full key the browser keeps) and
 *    register_agent on the Co-op contract with the budget. The visitor is the agent's owner on chain, so
 *    refunds and withdrawals go to their wallet.
 * 3. activate (and a periodic sweep, in case the tab closed): once the chain shows the agent registered
 *    to that owner with the stored key, the agent starts, limited to the room's pool.
 */
import { KeyPair, type KeyPairString } from "near-api-js";
import { BriefError, type ParsedBrief } from "@coop/agents/brief";
import { AGENT_METHODS } from "@coop/agents/chain";
import { STORAGE_RESERVE, formatNear } from "@coop/agents/money";
import { MEMBERSHIP_STORAGE_HEADROOM, limitsFromPolicy } from "@coop/agents/policy";
import type { AgentLimits, Policy, PoolView } from "@coop/agents/types";
import type { NewEntry } from "./activity.js";
import type { RoomService } from "./rooms.js";
import { SpawnError, budgetToYocto, type Spawner } from "./spawner.js";
import type { AgentRecord } from "./store.js";

export const MAX_BATCH = 5;
export const REGISTER_GAS = "30000000000000";
const HOUR_MS = 3_600_000;
const PENDING_TTL_MS = HOUR_MS;

/** Named accounts only: implicit (64 hex) and 0x accounts cannot have sub-accounts. */
const OWNER_RE = /^(?=.{2,56}$)([a-z\d]+[-_])*[a-z\d]+(\.([a-z\d]+[-_])*[a-z\d]+)+$/;

export interface WalletChainPort {
  accountExists(accountId: string): Promise<boolean>;
  /** Owner recorded by the contract; null when not registered; undefined when the view failed. */
  agentOwner(agentId: string): Promise<string | null | undefined>;
  /** True when the account has this public key as a function-call key for the Co-op contract. */
  hasAgentKey(agentId: string, publicKey: string): Promise<boolean>;
  getPool(poolId: number): Promise<PoolView | null>;
}

export interface WalletSpawnerOptions {
  chain: WalletChainPort;
  spawner: Pick<Spawner, "record" | "isTaken" | "put" | "drop" | "run" | "count">;
  rooms: Pick<RoomService, "byCode">;
  emit: (entry: NewEntry) => void;
  parseBrief: (brief: string) => Promise<ParsedBrief>;
  contractId: string;
  /** NEAR moved onto each agent account: its storage plus the gas a join_pool call prepays (about 0.05). */
  gasPerAgent: bigint;
  maxAgents: number;
  perIpPerHour: number;
  now?: () => number;
  log?: (line: string) => void;
}

export interface PrepareInput {
  owner: string;
  roomCode: string;
  name: string;
  count: number;
  brief: string;
  totalNear: number;
  ip: string;
}

export interface PrepareOutput {
  contract_id: string;
  pool_id: number;
  policy: Policy;
  parser: "llm" | "rules";
  limits: AgentLimits;
  methods: string[];
  /** Per agent, yoctoNEAR as decimal strings. */
  budget_yocto: string;
  gas_yocto: string;
  register_gas: string;
  agents: Array<{ agent_id: string; fc_public_key: string }>;
}

export type ActivationState = "running" | "waiting" | "rejected";

export class WalletSpawner {
  private readonly hits = new Map<string, number[]>();
  private readonly pendingIds = new Set<string>();
  private readonly now: () => number;
  private sweeping = false;

  constructor(private readonly o: WalletSpawnerOptions) {
    this.now = o.now ?? Date.now;
  }

  async prepare(input: PrepareInput): Promise<PrepareOutput> {
    const owner = input.owner.trim().toLowerCase();
    if (!OWNER_RE.test(owner)) {
      throw new SpawnError(400, "Connect a named NEAR account (like you.testnet). Implicit and 0x accounts cannot own sub-accounts.", { field: "owner" });
    }
    const room = this.o.rooms.byCode(input.roomCode);
    if (!room) throw new SpawnError(400, "No room has that code.", { field: "room_code" });
    if (input.count < 1 || input.count > MAX_BATCH) {
      throw new SpawnError(400, `Spawn 1 to ${MAX_BATCH} agents at a time.`, { field: "count" });
    }
    const ids = Array.from({ length: input.count }, (_, i) => `${input.name}-${i + 1}.${owner}`);
    if (ids.some((id) => id.length > 64)) {
      throw new SpawnError(400, "Agent names would be longer than 64 characters with your account name. Use a shorter name.", { field: "name" });
    }
    if (this.o.spawner.count + input.count > this.o.maxAgents) {
      throw new SpawnError(503, `This server runs at most ${this.o.maxAgents} agents and is nearly full.`);
    }
    this.checkIpLimit(input.ip);

    const pool = await this.o.chain.getPool(room.pool_id);
    if (!pool || pool.status !== "Open") throw new SpawnError(409, "This room's pool is no longer taking agents.", { field: "room_code" });
    if (!(await this.o.chain.accountExists(owner))) throw new SpawnError(400, `${owner} does not exist on chain.`, { field: "owner" });

    let parsed: ParsedBrief;
    try {
      parsed = await this.o.parseBrief(input.brief);
    } catch (e) {
      if (e instanceof BriefError) throw new SpawnError(400, e.message, { field: "brief" });
      throw new SpawnError(400, e instanceof Error ? e.message : "The brief could not be parsed.", { field: "brief" });
    }
    const policy = parsed.policy;
    const total = budgetToYocto(input.totalNear);
    const each = total / BigInt(input.count);
    const needed = BigInt(policy.units) * BigInt(policy.max_unit_price) + STORAGE_RESERVE + MEMBERSHIP_STORAGE_HEADROOM;
    if (each < needed) {
      throw new SpawnError(
        400,
        `Each agent needs at least ${formatNear(needed, 4, 2)} NEAR for this brief (${policy.units} units at up to ${formatNear(BigInt(policy.max_unit_price), 4, 2)}); ${input.count} agents need ${formatNear(needed * BigInt(input.count), 4, 2)}.`,
        { field: "total_near" },
      );
    }

    for (const id of ids) {
      if (this.o.spawner.isTaken(id) || (await this.o.chain.accountExists(id))) {
        throw new SpawnError(409, `${id} already exists. Pick another name.`, { field: "name" });
      }
    }

    const records: AgentRecord[] = ids.map((id) => ({
      agent_id: id,
      archetype: policy.archetype,
      brief: input.brief,
      policy,
      created_at: this.now(),
      fc_secret: KeyPair.fromRandom("ed25519").toString(),
      full_secret: "",
      owner,
      pool_id: room.pool_id,
      status: "pending",
    }));
    try {
      this.o.spawner.put(records);
    } catch (e) {
      this.o.log?.(`wallet spawn for ${owner} stopped: key store not writable: ${e instanceof Error ? e.message : String(e)}`);
      throw new SpawnError(503, "Spawning is paused: the server cannot store agent keys right now.");
    }
    this.hits.set(input.ip, [...(this.hits.get(input.ip) ?? []), this.now()]);
    for (const r of records) this.pendingIds.add(r.agent_id);

    return {
      contract_id: this.o.contractId,
      pool_id: room.pool_id,
      policy,
      parser: parsed.parser,
      limits: limitsFromPolicy(policy),
      methods: [...AGENT_METHODS],
      budget_yocto: each.toString(),
      gas_yocto: this.o.gasPerAgent.toString(),
      register_gas: REGISTER_GAS,
      agents: records.map((r) => ({ agent_id: r.agent_id, fc_public_key: publicKey(r.fc_secret) })),
    };
  }

  /** Starts the owner's pending agents the chain already shows as registered. */
  async activate(owner: string, agentIds: string[]): Promise<Array<{ agent_id: string; state: ActivationState }>> {
    const out: Array<{ agent_id: string; state: ActivationState }> = [];
    for (const id of agentIds.slice(0, MAX_BATCH)) {
      const record = this.o.spawner.record(id);
      if (!record || record.owner !== owner.trim().toLowerCase()) {
        out.push({ agent_id: id, state: "rejected" });
        continue;
      }
      out.push({ agent_id: id, state: record.status === "pending" ? await this.tryStart(record) : "running" });
    }
    return out;
  }

  /** Periodic pass over every pending record: starts the ready ones, retires the abandoned ones. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      const pending = this.pendingRecords();
      const stale: AgentRecord[] = [];
      for (const record of pending) {
        const state = await this.tryStart(record);
        if (state === "waiting" && this.now() - record.created_at > PENDING_TTL_MS) stale.push(record);
      }
      if (stale.length > 0) this.o.spawner.drop(stale);
    } finally {
      this.sweeping = false;
    }
  }

  /** Pending agents still in the store (ids come from prepare and from track at startup). */
  private pendingRecords(): AgentRecord[] {
    const out: AgentRecord[] = [];
    for (const id of this.pendingIds) {
      const r = this.o.spawner.record(id);
      if (r?.status === "pending") out.push(r);
      else this.pendingIds.delete(id);
    }
    return out;
  }

  private async tryStart(record: AgentRecord): Promise<ActivationState> {
    this.pendingIds.add(record.agent_id);
    const owner = await this.o.chain.agentOwner(record.agent_id);
    if (owner === undefined || owner === null) return "waiting";
    if (owner !== record.owner) return "rejected";
    if (!(await this.o.chain.hasAgentKey(record.agent_id, publicKey(record.fc_secret)))) return "waiting";
    const active: AgentRecord = { ...record, status: "active" };
    try {
      this.o.spawner.put([active]);
    } catch (e) {
      this.o.log?.(`could not mark ${record.agent_id} active: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.pendingIds.delete(record.agent_id);
    this.o.spawner.run(active);
    const entry: NewEntry = {
      kind: "spawned",
      agent_id: record.agent_id,
      message: `${record.agent_id} was spawned by ${record.owner} (${record.policy.archetype}, ${record.policy.units} units)`,
      reason: record.brief,
    };
    if (record.pool_id !== undefined) entry.pool_id = record.pool_id;
    this.o.emit(entry);
    return "running";
  }

  /** Pending records loaded from disk at startup join the sweep. */
  track(records: AgentRecord[]): void {
    for (const r of records) if (r.status === "pending") this.pendingIds.add(r.agent_id);
  }

  private checkIpLimit(ip: string): void {
    const now = this.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
    this.hits.set(ip, recent);
    if (recent.length >= this.o.perIpPerHour) {
      const retry = Math.max(1, Math.ceil(((recent[0] as number) + HOUR_MS - now) / 1000));
      throw new SpawnError(429, `Too many spawn requests from this network. Try again in ${Math.ceil(retry / 60)} minutes.`, { retryAfterSec: retry });
    }
  }
}

function publicKey(secret: string): string {
  return KeyPair.fromString(secret as KeyPairString).getPublicKey().toString();
}
