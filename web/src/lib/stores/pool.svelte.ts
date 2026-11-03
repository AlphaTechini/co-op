// Everything the pool page needs: chain state polled every ~2s, the activity feed (server when
// reachable, otherwise derived from chain snapshots), flip / tier detection and announcements.
import { apiEnabled, fetchActivity, fetchAgents, openStream } from '../api';
import { getAgent, getPool, getPoolMembers } from '../chain';
import { config } from '../config.svelte';
import {
  flipItem, fromMember, fromServer, leftItem, settledFromChain, sortFeed, tierItem, tierLostItem, type FeedItem
} from '../feed';
import { formatNear, nsToMs, plural } from '../format';
import type { ActivityEntry, AgentView, MemberView, PoolView } from '../models';
import { effectiveStatus } from '../status';
import { clock } from './clock.svelte';
import { Poller } from './poller.svelte';
import { toasts } from './toasts.svelte';

export interface PoolSnapshot {
  pool: PoolView | null;
  members: MemberView[];
}

const FLASH_MS = 1200;

export class PoolPage {
  readonly id: number;
  readonly poller: Poller<PoolSnapshot>;

  agents = $state.raw<ReadonlyMap<string, AgentView>>(new Map());
  limitsState = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  archetypes = $state.raw<Record<string, string>>({});
  flipped = $state.raw<ReadonlySet<string>>(new Set());
  justReached = $state<number | null>(null);
  priceTick = $state(0);
  announcements = $state<string[]>([]);

  // feed
  serverEntries = $state.raw<ActivityEntry[]>([]);
  clientItems = $state.raw<FeedItem[]>([]);
  live = $state(false);
  loadingFeed = $state(true);
  feedReady = $state(false);
  visible = $state(8);
  activityHasMore = $state(false);
  newKeys = $state.raw<ReadonlySet<string>>(new Set());
  #feedLimit = 100;
  #stopStream: (() => void) | null = null;
  #seen = new Set<string>();
  #started = false;

  constructor(id: number) {
    this.id = id;
    this.poller = new Poller<PoolSnapshot>(
      async () => {
        const pool = await getPool(this.id);
        if (!pool) return { pool: null, members: [] };
        const members = await getPoolMembers(this.id);
        return { pool, members };
      },
      { interval: 2000, onData: (next, prev) => this.#onData(next, prev) }
    );
  }

  // ---- derived views ----------------------------------------------------

  get pool(): PoolView | null {
    return this.poller.data?.pool ?? null;
  }
  get members(): MemberView[] {
    return this.poller.data?.members ?? [];
  }
  get status() {
    const p = this.pool;
    return p ? effectiveStatus(p, clock.now) : null;
  }
  get notFound(): boolean {
    return this.poller.loaded && this.poller.data !== null && this.poller.data.pool === null;
  }
  /** 'server' when the Co-op server feeds the activity list, otherwise it is read from the chain. */
  get feedMode(): 'server' | 'chain' {
    return config.server === 'up' && !this.loadingFeed ? 'server' : 'chain';
  }

  get feedItems(): FeedItem[] {
    const pool = this.pool;
    const memberMap = new Map(this.members.map((m) => [m.agent_id, m]));
    const out: FeedItem[] = [...this.clientItems];
    if (this.feedMode === 'server') {
      for (const e of this.serverEntries) out.push(fromServer(e, { pool, members: memberMap }));
    } else {
      for (const m of this.members) out.push(fromMember(m, this.id, nsToMs));
      if (pool) {
        const s = settledFromChain(pool, nsToMs);
        if (s) out.push(s);
      }
    }
    // in server mode only the two client-derived tier entries apply
    const filtered = this.feedMode === 'server' ? out.filter((i) => i.src !== 'client' || i.kind === 'tier' || i.kind === 'tier-lost') : out;
    const seen = new Set<string>();
    return sortFeed(filtered).filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
  }

  // ---- lifecycle ----------------------------------------------------------

  start() {
    if (this.#started) return;
    this.#started = true;
    this.poller.start();
    if (apiEnabled()) {
      void this.#loadActivity();
      void fetchAgents()
        .then((rows) => {
          const map: Record<string, string> = {};
          for (const r of rows) map[r.agent_id] = r.archetype;
          this.archetypes = map;
        })
        .catch(() => {});
      this.#stopStream = openStream(
        (e) => this.#onStream(e),
        (up) => {
          const was = this.live;
          this.live = up;
          if (up && !was) {
            config.server = 'up';
            void this.#loadActivity();
          }
        }
      );
    } else {
      this.loadingFeed = false;
    }
  }

  stop() {
    this.poller.stop();
    this.#stopStream?.();
    this.#started = false;
  }

  async retryServer() {
    await config.recheck();
    this.#stopStream?.();
    this.#stopStream = openStream((e) => this.#onStream(e), (up) => (this.live = up));
    await this.#loadActivity();
  }

  showEarlier() {
    this.visible += 20;
  }

  // ---- feed ---------------------------------------------------------------

  async #loadActivity() {
    try {
      let rows: ActivityEntry[];
      try {
        rows = await fetchActivity(this.id, this.#feedLimit);
      } catch {
        rows = await fetchActivity(this.id, 20);
        this.#feedLimit = 20;
      }
      this.serverEntries = rows.filter((r) => r.pool_id === undefined || r.pool_id === this.id);
      this.activityHasMore = rows.length >= this.#feedLimit;
      for (const r of this.serverEntries) this.#seen.add(String(r.id));
      this.live = true;
    } catch {
      this.live = false;
    } finally {
      this.loadingFeed = false;
      queueMicrotask(() => (this.feedReady = true));
    }
  }

  #onStream(e: ActivityEntry) {
    if (e.pool_id !== this.id) return;
    const id = String(e.id);
    if (this.#seen.has(id)) return;
    this.#seen.add(id);
    this.serverEntries = [e, ...this.serverEntries];
    this.#markNew(`s-${e.id}`);
    this.live = true;
    if (e.kind === 'pool_settled' || e.kind === 'settle') void this.#maybeLoadLimits();
  }

  #markNew(key: string) {
    this.newKeys = new Set([...this.newKeys, key]);
  }

  #pushClient(item: FeedItem) {
    this.clientItems = [item, ...this.clientItems];
    this.#markNew(item.key);
  }

  #announce(msg: string) {
    this.announcements = [...this.announcements.slice(-2), msg];
  }

  #flash(kind: 'flip' | 'tier', value: string | number) {
    if (kind === 'flip') {
      this.flipped = new Set([...this.flipped, String(value)]);
      setTimeout(() => {
        const n = new Set(this.flipped);
        n.delete(String(value));
        this.flipped = n;
      }, FLASH_MS);
    } else {
      this.justReached = Number(value);
      setTimeout(() => {
        if (this.justReached === Number(value)) this.justReached = null;
      }, FLASH_MS);
    }
  }

  // ---- diffing successive snapshots --------------------------------------------

  #onData(next: PoolSnapshot, prev: PoolSnapshot | null) {
    const p1 = next.pool;
    if (p1 && (p1.status === 'Settled' || p1.status === 'Refunded' || p1.status === 'Settling')) void this.#maybeLoadLimits();
    if (!prev?.pool || !p1) return;
    const p0 = prev.pool;
    const now = Date.now();
    const tier0 = p0.result ? p0.result.tier_index : p0.projected.tier_index;
    const tier1 = p1.result ? p1.result.tier_index : p1.projected.tier_index;
    const price0 = (p0.result ?? p0.projected).unit_price;
    const price1 = (p1.result ?? p1.projected).unit_price;

    // status transitions
    if (p0.status !== p1.status) {
      if (p1.status === 'Locked') this.#announce('Pool locked. Membership is frozen.');
      else if (p1.status === 'Expired') this.#announce('Deadline passed. Awaiting settlement.');
      else if (p1.status === 'Settled' && price1) {
        const t = `Pool #${p1.id} settled at ${formatNear(price1)}.`;
        this.#announce(t);
        toasts.push('positive', t);
        void this.#loadActivity();
      } else if (p1.status === 'Refunded') {
        const t = `Pool #${p1.id} refunded.`;
        this.#announce(t);
        toasts.push('positive', t);
        void this.#loadActivity();
      }
    }

    const live = p1.status === 'Open' || p1.status === 'AwaitingInventory';
    if (!live) return;

    const before = new Map(prev.members.map((m) => [m.agent_id, m]));
    // "now in" means a member that was already waiting and just got pulled in, not a brand-new joiner
    const nowIn = next.members.filter((m) => m.projected_in && before.has(m.agent_id) && !before.get(m.agent_id)!.projected_in).map((m) => m.agent_id);
    const flips = next.members.filter((m) => m.threshold_units !== null && m.projected_in && before.get(m.agent_id) && !before.get(m.agent_id)!.projected_in);
    for (const m of flips) this.#flash('flip', m.agent_id);
    if (flips.length) {
      const names = flips.map((m) => m.agent_id.split('.')[0]);
      const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      this.#announce(`${list} ${names.length === 1 ? 'is' : 'are'} now in.`);
    }

    if (tier1 !== tier0) {
      if (tier1 !== null && (tier0 === null || tier1 > tier0)) {
        const item = tierItem(p1, tier1, nowIn, now);
        this.#pushClient(item);
        this.#flash('tier', tier1);
        const t = p1.offer.tiers[tier1];
        this.#announce(`Group reached ${plural(t.min_units, 'unit')}. Price is now ${formatNear(t.unit_price)}.`);
      } else if (tier0 !== null) {
        this.#pushClient(tierLostItem(p1, tier0, tier1, now));
        this.#announce(`Group fell below ${plural(p1.offer.tiers[tier0].min_units, 'unit')}. Price is ${price1 ? formatNear(price1) : 'not set'}.`);
      }
    } else if (this.feedMode === 'chain') {
      // flips without a tier change are worth a line when the server is not telling us
      for (const m of flips) this.#pushClient(flipItem(m, this.id, now));
    }

    if (this.feedMode === 'chain') {
      const gone = prev.members.filter((m) => !next.members.some((n) => n.agent_id === m.agent_id));
      for (const m of gone) this.#pushClient(leftItem(m, this.id, now));
      const joined = next.members.filter((m) => !before.has(m.agent_id));
      for (const m of joined) this.#markNew(fromMember(m, this.id, nsToMs).key);
    }

    if (price0 !== price1) this.priceTick += 1;
  }

  // ---- limits for the receipt ------------------------------------------------------

  async #maybeLoadLimits() {
    const pool = this.pool;
    if (!pool || pool.status === 'Refunded' || this.limitsState === 'loading') return;
    const missing = this.members.filter((m) => !this.agents.has(m.agent_id)).map((m) => m.agent_id);
    if (!missing.length) {
      if (this.members.length) this.limitsState = 'ready';
      return;
    }
    this.limitsState = 'loading';
    try {
      const got = new Map(this.agents);
      for (let i = 0; i < missing.length; i += 10) {
        const batch = await Promise.all(missing.slice(i, i + 10).map((id) => getAgent(id)));
        for (const a of batch) if (a) got.set(a.agent_id, a);
      }
      this.agents = got;
      this.limitsState = missing.every((id) => got.has(id)) ? 'ready' : 'error';
    } catch (e) {
      void e;
      this.limitsState = 'error';
    }
  }

  retryLimits() {
    this.limitsState = 'idle';
    void this.#maybeLoadLimits();
  }
}
