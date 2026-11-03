import { getAgent, getPoolMembers, getStats, listPoolsUpTo } from '../chain';
import type { AgentView, PoolView, StatsView } from '../models';
import { buildReceipt, type Receipt } from '../proof';
import { Poller } from './poller.svelte';

export interface OverviewData {
  pools: PoolView[];
  stats: StatsView;
  /** true when list_pools returned a full page, so there may be more */
  full: boolean;
}

export interface LastProof {
  poolId: number;
  receipt: Receipt;
}

/** Settled pools are immutable, so their receipts are computed once per page load. */
const proofCache = new Map<number, Receipt>();

export class OverviewStore {
  count = $state(20);
  lastProof = $state.raw<LastProof | null>(null);
  proofState = $state<'idle' | 'loading' | 'done' | 'error'>('idle');

  readonly poller = new Poller<OverviewData>(
    async () => {
      const [pools, stats] = await Promise.all([listPoolsUpTo(this.count), getStats()]);
      return { pools, stats, full: pools.length >= this.count };
    },
    { interval: 5000, onData: (d) => void this.#proof(d.pools) }
  );

  start() {
    this.poller.start();
  }
  stop() {
    this.poller.stop();
  }
  more() {
    this.count += 20;
    void this.poller.refresh();
  }

  async #proof(pools: PoolView[]) {
    const settled = pools.find((p) => p.status === 'Settled');
    if (!settled) {
      this.lastProof = null;
      this.proofState = 'done';
      return;
    }
    if (this.lastProof?.poolId === settled.id || this.proofState === 'loading') return;
    const cached = proofCache.get(settled.id);
    if (cached) {
      this.lastProof = { poolId: settled.id, receipt: cached };
      this.proofState = 'done';
      return;
    }
    this.proofState = 'loading';
    try {
      const members = await getPoolMembers(settled.id);
      const agents = new Map<string, AgentView>();
      for (let i = 0; i < members.length; i += 10) {
        const batch = await Promise.all(members.slice(i, i + 10).map((m) => getAgent(m.agent_id)));
        for (const a of batch) if (a) agents.set(a.agent_id, a);
      }
      const receipt = buildReceipt(settled, members, agents);
      proofCache.set(settled.id, receipt);
      this.lastProof = { poolId: settled.id, receipt };
      this.proofState = 'done';
    } catch {
      this.proofState = 'error';
    }
  }
}
