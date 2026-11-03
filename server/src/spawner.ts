/**
 * Spawn-your-agent service (PRD 6.6): validates, checks every cap, provisions the sub-account with a
 * function-call key, registers the agent with its budget and hands it to the running runtime.
 */
import type { Account } from "near-api-js";
import { BriefError, type ParsedBrief } from "@coop/agents/brief";
import { STORAGE_RESERVE, formatNear, parseNear } from "@coop/agents/money";
import { MEMBERSHIP_STORAGE_HEADROOM, limitsFromPolicy } from "@coop/agents/policy";
import type { RuntimeAgent } from "@coop/agents/runtime";
import type { ActivityTx, AgentLimits, Policy, TxRef } from "@coop/agents/types";
import type { NewEntry } from "./activity.js";
import type { AgentRecord, AgentStore } from "./store.js";

export class SpawnError extends Error {
  constructor(
    readonly status: 400 | 409 | 429 | 502 | 503,
    message: string,
    readonly extra: { field?: string; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = "SpawnError";
  }
}

export interface ProvisionedPort {
  id: string;
  fcSecret: string;
  fullSecret: string;
  account: Account;
  txs: TxRef[];
}

/** The chain operations the spawner needs. Real implementation: node.ts; tests pass a fake. */
export interface SpawnChainPort {
  accountExists(accountId: string): Promise<boolean>;
  operatorBalance(): Promise<bigint>;
  /** Null when the view failed (RPC trouble): the caller keeps the agent. */
  isRegistered(agentId: string): Promise<boolean | null>;
  provision(options: { label: string; limits: AgentLimits; budget: bigint; gasBalance: bigint }): Promise<ProvisionedPort>;
  signer(agentId: string, fcSecret: string): Account;
}

export interface RuntimePort {
  addAgent(agent: RuntimeAgent): void;
  removeAgent(agentId: string): boolean;
}

export interface SpawnerOptions {
  chain: SpawnChainPort;
  runtime: RuntimePort;
  store: AgentStore;
  emit: (entry: NewEntry) => void;
  parseBrief: (brief: string) => Promise<ParsedBrief>;
  operatorId: string;
  maxAgents: number;
  /** Operator-side spawn switch: false when there is no operator key. */
  enabled: boolean;
  disabledReason?: string;
  perIpPerHour: number;
  spawnGas: bigint;
  operatorFloor: bigint;
  now?: () => number;
  log?: (line: string) => void;
}

export interface SpawnInput {
  name: string;
  brief: string;
  budgetNear: number;
  ip: string;
}

export interface SpawnOutput {
  agent_id: string;
  policy: Policy;
  parser: "llm" | "rules";
  txs: ActivityTx[];
}

export interface SpawnedAgentView {
  agent_id: string;
  archetype: string;
  brief: string;
  policy: Policy;
  created_at: number;
  status: "running";
}

const HOUR_MS = 3_600_000;

export const stripEvents = (tx: TxRef): ActivityTx => {
  const { events: _events, ...rest } = tx;
  return rest;
};

/** JSON number -> yocto, exactly. At most 6 decimals so binary floats cannot smuggle in noise. */
export function budgetToYocto(value: number): bigint {
  const text = value.toFixed(6);
  if (Number(text) !== value) throw new SpawnError(400, "budget_near can have at most 6 decimal places.", { field: "budget_near" });
  return parseNear(text);
}

export class Spawner {
  private readonly records = new Map<string, AgentRecord>();
  private readonly pending = new Set<string>();
  private readonly hits = new Map<string, number[]>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly o: SpawnerOptions) {
    this.now = o.now ?? Date.now;
  }

  /** Re-adds persisted agents to the runtime. Records the chain no longer knows are retired, not deleted. */
  async resume(): Promise<{ resumed: number; retired: number }> {
    const loaded = this.o.store.load();
    const retired: AgentRecord[] = [];
    for (const record of loaded) {
      const registered = await this.o.chain.isRegistered(record.agent_id);
      if (registered === false) {
        retired.push(record);
        continue;
      }
      this.records.set(record.agent_id, record);
      this.o.runtime.addAgent({
        id: record.agent_id,
        account: this.o.chain.signer(record.agent_id, record.fc_secret),
        policy: record.policy,
        label: record.agent_id,
      });
    }
    if (retired.length > 0) {
      this.o.store.retire(retired);
      this.o.store.save([...this.records.values()]);
    }
    return { resumed: this.records.size, retired: retired.length };
  }

  get count(): number {
    return this.records.size + this.pending.size;
  }

  remaining(): number {
    return Math.max(0, this.o.maxAgents - this.count);
  }

  /** Cheap, chain-free check used by /api/config. */
  status(): { enabled: boolean; reason?: string } {
    if (!this.o.enabled) return { enabled: false, reason: this.o.disabledReason ?? "Spawning is not configured on this server." };
    if (this.remaining() === 0) return { enabled: false, reason: `The limit of ${this.o.maxAgents} spawned agents has been reached.` };
    return { enabled: true };
  }

  list(): SpawnedAgentView[] {
    return [...this.records.values()].map((r) => ({
      agent_id: r.agent_id,
      archetype: r.archetype,
      brief: r.brief,
      policy: r.policy,
      created_at: r.created_at,
      status: "running",
    }));
  }

  private checkIpLimit(ip: string): void {
    const now = this.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
    this.hits.set(ip, recent);
    if (recent.length >= this.o.perIpPerHour) {
      const retry = Math.max(1, Math.ceil(((recent[0] as number) + HOUR_MS - now) / 1000));
      throw new SpawnError(429, `Spawn limit reached: ${this.o.perIpPerHour} agents per hour per visitor. Try again later.`, {
        retryAfterSec: retry,
      });
    }
  }

  async spawn(input: SpawnInput): Promise<SpawnOutput> {
    const { chain } = this.o;
    const status = this.status();
    if (!status.enabled) throw new SpawnError(503, status.reason ?? "Spawning is disabled.");
    this.checkIpLimit(input.ip);

    const agentId = `${input.name}.${this.o.operatorId}`;
    if (this.records.has(agentId) || this.pending.has(agentId)) {
      throw new SpawnError(409, `The name "${input.name}" is already taken.`, { field: "name" });
    }

    let parsed: ParsedBrief;
    try {
      parsed = await this.o.parseBrief(input.brief);
    } catch (e) {
      if (e instanceof BriefError) throw new SpawnError(400, e.message, { field: "brief" });
      throw new SpawnError(400, e instanceof Error ? e.message : "The brief could not be parsed.", { field: "brief" });
    }
    const policy = parsed.policy;
    const budget = budgetToYocto(input.budgetNear);
    const needed = BigInt(policy.units) * BigInt(policy.max_unit_price) + STORAGE_RESERVE + MEMBERSHIP_STORAGE_HEADROOM;
    if (budget < needed) {
      throw new SpawnError(
        400,
        `The budget is too small for this brief: ${policy.units} units at up to ${formatNear(BigInt(policy.max_unit_price), 4, 2)} NEAR need at least ${formatNear(needed, 4, 2)} NEAR.`,
        { field: "budget_near" },
      );
    }

    // Reserve the name before the first await on the chain so two requests cannot both pass.
    if (this.count >= this.o.maxAgents) throw new SpawnError(503, `The limit of ${this.o.maxAgents} spawned agents has been reached.`);
    this.pending.add(agentId);
    try {
      if (await chain.accountExists(agentId)) {
        throw new SpawnError(409, `The name "${input.name}" is already taken.`, { field: "name" });
      }
      // Provisioning signs with the one operator key: run spawns one at a time.
      return await this.serial(async () => {
        const balance = await chain.operatorBalance();
        if (balance < budget + this.o.spawnGas + this.o.operatorFloor) {
          throw new SpawnError(503, "Spawning is paused: the operator account is running low on funds.");
        }
        // The attempt counts against the visitor from here on, successful or not.
        this.hits.set(input.ip, [...(this.hits.get(input.ip) ?? []), this.now()]);
        let provisioned: ProvisionedPort;
        try {
          provisioned = await chain.provision({ label: input.name, limits: limitsFromPolicy(policy), budget, gasBalance: this.o.spawnGas });
        } catch (e) {
          this.o.log?.(`spawn of ${agentId} failed: ${e instanceof Error ? e.message : String(e)}`);
          throw new SpawnError(502, "The chain rejected the spawn. Nothing was charged to you; try another name in a minute.");
        }
        const record: AgentRecord = {
          agent_id: provisioned.id,
          archetype: policy.archetype,
          brief: input.brief,
          policy,
          created_at: this.now(),
          fc_secret: provisioned.fcSecret,
          full_secret: provisioned.fullSecret,
        };
        this.records.set(record.agent_id, record);
        this.o.store.save([...this.records.values()]);
        this.o.runtime.addAgent({ id: record.agent_id, account: provisioned.account, policy, label: record.agent_id });
        const txs = provisioned.txs.map(stripEvents);
        const registration = provisioned.txs.find((t) => t.method === "register_agent");
        const entry: NewEntry = {
          kind: "spawned",
          agent_id: record.agent_id,
          message: `${record.agent_id} was spawned (${policy.archetype}, ${policy.units} units, budget ${formatNear(budget, 4, 2)} NEAR)`,
          reason: input.brief,
        };
        if (registration) entry.tx = stripEvents(registration);
        this.o.emit(entry);
        return { agent_id: record.agent_id, policy, parser: parsed.parser, txs };
      });
    } finally {
      this.pending.delete(agentId);
    }
  }

  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
