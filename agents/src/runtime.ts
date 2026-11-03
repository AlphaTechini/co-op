/**
 * AgentRuntime: the swarm loop. Holds agents (function-call-key signer + policy), polls list_pools,
 * runs the deterministic policy per agent per pool, executes joins and leaves, settles expired pools
 * and emits ActivityEntry objects (SPEC 3.1). Errors become `error` entries and never stop the loop.
 */
import { EventEmitter } from "node:events";
import type { Account } from "near-api-js";
import { CoopTxError, sleep, type CoopClient } from "./chain.js";
import { formatNear, formatPrice } from "./money.js";
import { decide, type Decision } from "./policy.js";
import type { SellerAgent } from "./seller.js";
import type { ActivityEntry, ActivityKind, ActivityTx, AgentView, Policy, PoolView, TxRef } from "./types.js";

export interface RuntimeAgent {
  id: string;
  /** Signs with the agent's function-call key. */
  account: Account;
  policy: Policy;
  /** Free-form label for the UI. */
  label?: string;
}

export interface RuntimeOptions {
  client: CoopClient;
  /** Poll interval. Sandbox: 500 ms; testnet: 3000 ms. */
  pollMs?: number;
  /** Account that pays for settle calls. Without one this runtime never settles. */
  settler?: Account | null;
  settleGas?: bigint;
  /** Max entries kept in memory. */
  maxLog?: number;
  /** Max concurrent agent transactions per pass. */
  concurrency?: number;
  /** After a failed action for (agent, pool), wait this long before trying again. */
  retryCooldownMs?: number;
  /** Optional seller negotiation (P1). */
  seller?: SellerAgent;
  /** Called with the full TxRef (including events) of every transaction the runtime sends. */
  onTx?: (tx: TxRef) => void;
}

export type ActivityListener = (entry: ActivityEntry) => void;

const stripTx = (tx: TxRef): ActivityTx => {
  const { events: _events, ...rest } = tx;
  return rest;
};

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
}

function errorMessage(e: unknown): string {
  if (e instanceof CoopTxError) return e.message;
  return e instanceof Error ? e.message : String(e);
}

/** Extracts the contract panic text from near-api-js error messages for readable feed entries. */
function panicText(message: string): string {
  const m = /Smart contract panicked: ([^"\n]+)/.exec(message);
  return m?.[1]?.trim() ?? message.split("\n")[0] ?? message;
}

export class AgentRuntime {
  private readonly emitter = new EventEmitter();
  private readonly agentMap = new Map<string, RuntimeAgent>();
  private readonly log: ActivityEntry[] = [];
  private readonly seenPools = new Set<number>();
  private readonly inflight = new Set<string>();
  private readonly cooldown = new Map<string, number>();
  private readonly lastDecision = new Map<string, string>();
  private readonly settling = new Map<number, Promise<void>>();
  private readonly settled = new Set<number>();
  private readonly stamp = Date.now().toString(36);
  private seq = 0;
  private running = false;
  private loop: Promise<void> | null = null;
  private wake: (() => void) | null = null;

  readonly client: CoopClient;
  private readonly pollMs: number;
  private readonly settler: Account | null;
  private readonly settleGas: bigint | undefined;
  private readonly maxLog: number;
  private readonly concurrency: number;
  private readonly retryCooldownMs: number;
  private readonly seller: SellerAgent | undefined;
  private readonly onTx: ((tx: TxRef) => void) | undefined;

  constructor(options: RuntimeOptions) {
    this.client = options.client;
    this.pollMs = options.pollMs ?? 1000;
    this.settler = options.settler ?? null;
    this.settleGas = options.settleGas;
    this.maxLog = options.maxLog ?? 2000;
    this.concurrency = options.concurrency ?? 12;
    this.retryCooldownMs = options.retryCooldownMs ?? 10_000;
    this.seller = options.seller;
    this.onTx = options.onTx;
    this.emitter.setMaxListeners(0);
  }

  // ---- agents ----------------------------------------------------------------------------------

  addAgent(agent: RuntimeAgent): void {
    this.agentMap.set(agent.id, agent);
    this.wake?.();
  }

  removeAgent(agentId: string): boolean {
    return this.agentMap.delete(agentId);
  }

  agents(): RuntimeAgent[] {
    return [...this.agentMap.values()];
  }

  // ---- activity --------------------------------------------------------------------------------

  /** Subscribe to new entries. Returns an unsubscribe function. */
  onActivity(listener: ActivityListener): () => void {
    this.emitter.on("activity", listener);
    return () => this.emitter.off("activity", listener);
  }

  /** Newest first. */
  getLog(filter: { poolId?: number; limit?: number } = {}): ActivityEntry[] {
    const out: ActivityEntry[] = [];
    const limit = filter.limit ?? 200;
    for (let i = this.log.length - 1; i >= 0 && out.length < limit; i--) {
      const entry = this.log[i] as ActivityEntry;
      if (filter.poolId === undefined || entry.pool_id === filter.poolId) out.push(entry);
    }
    return out;
  }

  /** Records and broadcasts an entry (the server also uses this for `spawned`). */
  emitActivity(entry: Omit<ActivityEntry, "id" | "ts"> & { ts?: number }): ActivityEntry {
    const full: ActivityEntry = { ...entry, id: `${this.stamp}-${++this.seq}`, ts: entry.ts ?? Date.now() };
    this.log.push(full);
    if (this.log.length > this.maxLog) this.log.splice(0, this.log.length - this.maxLog);
    this.emitter.emit("activity", full);
    return full;
  }

  private entry(
    kind: ActivityKind,
    message: string,
    extra: { pool_id?: number; agent_id?: string; reason?: string; tx?: TxRef } = {},
  ): void {
    const { tx, ...rest } = extra;
    if (tx) this.onTx?.(tx);
    this.emitActivity({ kind, message, ...rest, ...(tx ? { tx: stripTx(tx) } : {}) });
  }

  private error(message: string, extra: { pool_id?: number; agent_id?: string } = {}): void {
    this.entry("error", message, extra);
  }

  // ---- loop ------------------------------------------------------------------------------------

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = this.run();
  }

  /** Stops polling and waits for in-flight settlement to finish. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
    await this.idle();
  }

  /** Resolves when no settlement is in flight. */
  async idle(): Promise<void> {
    while (this.settling.size > 0) await Promise.allSettled([...this.settling.values()]);
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        await this.tick();
      } catch (e) {
        this.error(`Runtime pass failed: ${panicText(errorMessage(e))}`);
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, this.pollMs);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.wake = null;
    }
  }

  /** One pass: read pools, decide, act, kick off settlement. Public so tests can drive it. */
  async tick(): Promise<void> {
    const pools = await this.client.listPools(0, 50);
    for (const pool of [...pools].reverse()) this.noticePool(pool);

    if (this.agentMap.size > 0) {
      const views = new Map<string, AgentView>();
      for (const view of await this.client.listAllAgents()) views.set(view.agent_id, view);
      const actions: Array<() => Promise<void>> = [];
      for (const agent of this.agentMap.values()) {
        const view = views.get(agent.id);
        if (!view) continue;
        for (const pool of pools) {
          if (pool.status !== "Open") continue;
          const action = this.plan(agent, view, pool, pools);
          if (action) actions.push(action);
        }
      }
      await mapLimit(actions, this.concurrency, (run) => run());
    }

    if (this.seller) {
      try {
        for (const done of await this.seller.tick(pools)) {
          this.entry("decision", `Seller improved offer ${done.offerId}: ${done.tiers.length} tiers`, {
            pool_id: done.offerId,
            reason: "Pool was short of the next tier near lock, so the seller added a better tier.",
            tx: done.tx,
          });
        }
      } catch (e) {
        this.error(`Seller improvement failed: ${panicText(errorMessage(e))}`);
      }
    }

    if (this.settler) {
      for (const pool of pools) {
        if ((pool.status === "Expired" || pool.status === "Settling") && !this.settling.has(pool.id) && !this.settled.has(pool.id)) {
          this.startSettle(pool.id);
        }
      }
    }
  }

  private noticePool(pool: PoolView): void {
    if (this.seenPools.has(pool.id)) return;
    this.seenPools.add(pool.id);
    const tiers = pool.offer.tiers
      .map((t) => `${t.min_units}+ at ${formatPrice(BigInt(t.unit_price))}`)
      .join(", ");
    this.entry("offer_created", `Offer ${pool.id}: ${pool.offer.title} (${tiers}; up to ${pool.offer.max_units} units)`, {
      pool_id: pool.id,
    });
  }

  // ---- per-agent actions -----------------------------------------------------------------------

  private plan(agent: RuntimeAgent, view: AgentView, pool: PoolView, pools: PoolView[]): (() => Promise<void>) | null {
    const key = `${agent.id}:${pool.id}`;
    if (this.inflight.has(key)) return null;
    if ((this.cooldown.get(key) ?? 0) > Date.now()) return null;
    const decision = decide(agent.policy, pool, view, pools);
    const signature = decision.action === "join" ? `join|${decision.units}|${decision.threshold_units}|${decision.memo}` : `${decision.action}|${decision.memo}`;
    const known = this.lastDecision.get(key);
    const changed = known !== signature;
    if (changed) this.lastDecision.set(key, signature);
    if (decision.action === "skip") {
      if (changed && decision.memo !== "Already in this pool.") {
        this.entry("decision", `${agent.id} skips pool ${pool.id}`, { pool_id: pool.id, agent_id: agent.id, reason: decision.memo });
      }
      return null;
    }
    if (changed) this.entry("decision", this.describe(agent, pool, decision), { pool_id: pool.id, agent_id: agent.id, reason: decision.memo });
    this.inflight.add(key);
    return async () => {
      try {
        await this.execute(agent, pool, decision);
      } finally {
        this.inflight.delete(key);
      }
    };
  }

  private describe(agent: RuntimeAgent, pool: PoolView, decision: Decision): string {
    if (decision.action === "join") {
      const how = decision.threshold_units === null ? "unconditionally" : `if the group reaches ${decision.threshold_units}`;
      return `${agent.id} decides to join pool ${pool.id} with ${decision.units} units ${how}`;
    }
    return `${agent.id} decides to leave pool ${pool.id}`;
  }

  private async execute(agent: RuntimeAgent, pool: PoolView, decision: Decision): Promise<void> {
    const key = `${agent.id}:${pool.id}`;
    try {
      if (decision.action === "join") {
        const tx = await this.client.joinPool(agent.account, pool.id, decision.units, decision.threshold_units, decision.memo);
        const how = decision.threshold_units === null ? "unconditional" : `conditional on ${decision.threshold_units}`;
        this.entry("pool_joined", `${agent.id} joined pool ${pool.id}: ${decision.units} units, ${how}`, {
          pool_id: pool.id,
          agent_id: agent.id,
          reason: decision.memo,
          tx,
        });
      } else if (decision.action === "leave") {
        const tx = await this.client.leavePool(agent.account, pool.id);
        this.entry("pool_left", `${agent.id} left pool ${pool.id}`, { pool_id: pool.id, agent_id: agent.id, reason: decision.memo, tx });
        this.lastDecision.delete(key);
      }
    } catch (e) {
      this.cooldown.set(key, Date.now() + this.retryCooldownMs);
      this.lastDecision.delete(key);
      const action = decision.action === "join" ? "join_pool" : "leave_pool";
      this.error(`${agent.id}: ${action} on pool ${pool.id} failed: ${panicText(errorMessage(e))}`, {
        pool_id: pool.id,
        agent_id: agent.id,
      });
    }
  }

  // ---- settlement ------------------------------------------------------------------------------

  private startSettle(poolId: number): void {
    const job = this.settlePool(poolId)
      .catch((e: unknown) => {
        this.error(`Settling pool ${poolId} failed: ${panicText(errorMessage(e))}`, { pool_id: poolId });
        // Let a later pass retry after a pause.
        this.cooldown.set(`settle:${poolId}`, Date.now() + this.retryCooldownMs);
      })
      .finally(() => this.settling.delete(poolId));
    this.settling.set(poolId, job);
  }

  private async settlePool(poolId: number): Promise<void> {
    const settler = this.settler;
    if (!settler) return;
    if ((this.cooldown.get(`settle:${poolId}`) ?? 0) > Date.now()) return;
    const opts: Parameters<CoopClient["settle"]>[2] = {
      waitForDeadline: true,
      onTx: (tx, progress) => {
        this.entry(
          "settle",
          `settle(pool ${poolId}): ${progress.processed} of ${progress.processed + progress.remaining} members processed, status ${progress.status}`,
          { pool_id: poolId, tx },
        );
      },
    };
    if (this.settleGas !== undefined) opts.gas = this.settleGas;
    const { progress } = await this.client.settle(settler, poolId, opts);
    this.settled.add(poolId);
    const pool = await this.client.getPool(poolId);
    const result = pool?.result;
    if (progress.status === "Settled" && result?.unit_price) {
      this.entry(
        "pool_settled",
        `Pool ${poolId} settled: ${result.units} units from ${result.members_in} agents at ${formatPrice(BigInt(result.unit_price))} each, seller paid ${formatNear(BigInt(result.seller_payout), 4)} NEAR`,
        { pool_id: poolId },
      );
    } else {
      this.entry("pool_refunded", `Pool ${poolId} refunded: no tier was reached, every agent got its full lock back`, { pool_id: poolId });
    }
  }
}

export { sleep };
