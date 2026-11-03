// Activity feed model (DESIGN.md 7.11): maps server entries, chain snapshots and client-derived
// events to one renderable shape. Pure so it can be tested.
import { formatNear, plural, splitAccount } from './format';
import type { ActivityEntry, MemberView, PoolView, TxRef } from './models';

export type Part = { t: 'text' | 'b'; v: string } | { t: 'agent'; v: string; title: string };

export type FeedKind =
  | 'joined' | 'joined-conditional' | 'left' | 'decision' | 'settle' | 'settled' | 'refunded'
  | 'spawned' | 'offer' | 'error' | 'tier' | 'tier-lost' | 'flip';

export const FEED_ICON: Record<FeedKind, string> = {
  joined: 'user-plus',
  'joined-conditional': 'dashed',
  left: 'user-minus',
  decision: 'route',
  settle: 'receipt',
  settled: 'check',
  refunded: 'undo',
  spawned: 'bot',
  offer: 'store',
  error: 'alert',
  tier: 'trending-down',
  'tier-lost': 'user-minus',
  flip: 'check-circle'
};

export interface FeedItem {
  key: string;
  ts: number;
  kind: FeedKind;
  parts: Part[];
  reason?: string;
  tx?: TxRef;
  /** where it came from; "chain" and "client" items have no transaction */
  src: 'server' | 'client' | 'chain';
}

const ACCOUNT_RE = /[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.(?:testnet|near)\b/g;

const agent = (id: string): Part => ({ t: 'agent', v: splitAccount(id)[0], title: id });
const text = (v: string): Part => ({ t: 'text', v });
const bold = (v: string): Part => ({ t: 'b', v });

/** Replaces account ids in free text with agent parts (label shown, full id in the title). */
export function partsFromText(message: string, knownIds: readonly string[] = []): Part[] {
  const out: Part[] = [];
  const re = new RegExp(
    [ACCOUNT_RE.source, ...knownIds.filter(Boolean).map((i) => i.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))].join('|'),
    'g'
  );
  let last = 0;
  for (const m of message.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text(message.slice(last, idx)));
    out.push(agent(m[0]));
    last = idx + m[0].length;
  }
  if (last < message.length) out.push(text(message.slice(last)));
  return out;
}

export interface FeedCtx {
  pool: PoolView | null;
  members: ReadonlyMap<string, MemberView>;
}

export function joinParts(m: MemberView, inRightAway = false): { kind: FeedKind; parts: Part[] } {
  if (m.threshold_units === null) {
    return { kind: 'joined', parts: [agent(m.agent_id), text(` joined: ${plural(m.units, 'unit')} at the entry price.`)] };
  }
  return {
    kind: 'joined-conditional',
    parts: [
      agent(m.agent_id),
      text(` joined on a condition: ${plural(m.units, 'unit')} if the group reaches ${m.threshold_units}.${inRightAway ? ' In right away.' : ''}`)
    ]
  };
}

export function fromServer(e: ActivityEntry, ctx: FeedCtx): FeedItem {
  const known = [...ctx.members.keys()];
  const base = { key: `s-${e.id}`, ts: e.ts, tx: e.tx, src: 'server' as const };
  const reason = e.reason?.trim() ? e.reason : undefined;
  const generic = (kind: FeedKind): FeedItem => ({ ...base, kind, parts: partsFromText(e.message, known), reason });

  switch (e.kind) {
    case 'pool_joined': {
      const m = e.agent_id ? ctx.members.get(e.agent_id) : undefined;
      if (m) {
        const j = joinParts(m);
        return { ...base, kind: j.kind, parts: j.parts, reason: reason ?? (m.memo.trim() ? m.memo : undefined) };
      }
      return { ...generic('joined') };
    }
    case 'pool_left': return generic('left');
    case 'decision': return generic('decision');
    case 'settle': return generic('settle');
    case 'pool_settled': return generic('settled');
    case 'pool_refunded': return generic('refunded');
    case 'spawned': return generic('spawned');
    case 'offer_created': return generic('offer');
    default: return generic('error');
  }
}

/** Real chain facts from a member snapshot (used when the server is not reachable). */
export function fromMember(m: MemberView, poolId: number, nsToMs: (s: string) => number): FeedItem {
  const j = joinParts(m);
  return {
    key: `c-join-${poolId}-${m.agent_id}-${m.joined_at_ns}`,
    ts: nsToMs(m.joined_at_ns),
    kind: j.kind,
    parts: j.parts,
    reason: m.memo.trim() ? m.memo : undefined,
    src: 'chain'
  };
}

export function settledFromChain(pool: PoolView, nsToMs: (s: string) => number): FeedItem | null {
  const r = pool.result;
  if (!r) return null;
  const ts = nsToMs(r.resolved_at_ns);
  if (pool.status === 'Refunded') {
    return { key: `c-refund-${pool.id}`, ts, kind: 'refunded', parts: [text('No tier reached. Everyone was refunded in full.')], src: 'chain' };
  }
  if (pool.status === 'Settled' && r.unit_price) {
    return {
      key: `c-settled-${pool.id}`, ts, kind: 'settled', src: 'chain',
      parts: [text(`Settled at ${formatNear(r.unit_price)}. ${plural(r.members_in, 'agent')} filled, seller paid ${formatNear(r.seller_payout)} NEAR.`)]
    };
  }
  return null;
}

export function tierItem(
  pool: PoolView, newIndex: number, newlyIn: string[], ts: number
): FeedItem {
  const tier = pool.offer.tiers[newIndex];
  const parts: Part[] = [
    text('Group reached '), bold(plural(tier.min_units, 'unit')), text('. Projected price drops to '), bold(formatNear(tier.unit_price)), text('.')
  ];
  if (newlyIn.length) {
    parts.push(text(' '));
    newlyIn.forEach((id, i) => {
      if (i > 0) parts.push(text(i === newlyIn.length - 1 ? ' and ' : ', '));
      parts.push(agent(id));
    });
    parts.push(text(newlyIn.length === 1 ? ' is now in.' : ' are now in.'));
  }
  return { key: `k-tier-${pool.id}-${newIndex}-${ts}`, ts, kind: 'tier', parts, src: 'client' };
}

export function tierLostItem(pool: PoolView, fromIndex: number, toIndex: number | null, ts: number): FeedItem {
  const lost = pool.offer.tiers[fromIndex];
  const now = toIndex === null ? 'no tier yet' : formatNear(pool.offer.tiers[toIndex].unit_price);
  return {
    key: `k-lost-${pool.id}-${fromIndex}-${ts}`, ts, kind: 'tier-lost', src: 'client',
    parts: [text(`Group fell below ${plural(lost.min_units, 'unit')}. Projected price is ${toIndex === null ? '' : 'back to '}`), bold(now), text('.')]
  };
}

export function flipItem(m: MemberView, poolId: number, ts: number): FeedItem {
  return {
    key: `k-flip-${poolId}-${m.agent_id}-${ts}`, ts, kind: 'flip', src: 'client',
    parts: [agent(m.agent_id), text(` is now in at ${m.threshold_units ?? 'the entry price'}.`)]
  };
}

export function leftItem(m: MemberView, poolId: number, ts: number): FeedItem {
  return {
    key: `k-left-${poolId}-${m.agent_id}-${ts}`, ts, kind: 'left', src: 'client',
    parts: [agent(m.agent_id), text(' left the pool.')]
  };
}

export function sortFeed(items: FeedItem[]): FeedItem[] {
  return [...items].sort((a, b) => b.ts - a.ts || (a.key < b.key ? 1 : -1));
}
