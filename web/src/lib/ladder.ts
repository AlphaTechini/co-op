// Ladder geometry and copy (DESIGN.md 7.8 / 7.9). Pure; the components only render this.

import { discountLabel, formatNear, plural, MINUS } from './format';
import type { MemberView, PoolView } from './models';
import { unitsToReach, type Entry } from './settlement';

export interface Seg {
  kind: 'below' | 'tier';
  tier: number; // tier index, -1 for the below-minimum segment
  from: number;
  to: number;
  in: number; // 0..1
  pend: number; // 0..1 (fill + hatch)
  color: string; // css value
}

export type RungState = 'passed' | 'current' | 'ahead' | 'far' | 'below-min';

export interface Rung {
  seg: number;
  state: RungState;
  kind: 'below' | 'tier';
  tier: number;
  minUnits: number;
  price: bigint | null;
  priceText: string;
  delta: string;
  fromText: string;
  waiting: { agents: number; units: number } | null;
  /** pledged units away: only for the next tier while the pool is live */
  away: { kind: 'away'; units: number; bringsIn: number } | { kind: 'unreachable' } | null;
  statusText: string | null; // passed / current / final lines
}

export type SummaryModel =
  | { v: 'settled'; tierNo: number; tierCount: number; units: number; pctText: string }
  | { v: 'refunded'; units: number; min: number }
  | { v: 'frozen'; priceText: string | null; units: number }
  | { v: 'notier'; pledged: number; away: number | null; priceText: string; min: number }
  | { v: 'best'; units: number; membersIn: number }
  | { v: 'bringsin'; units: number; membersIn: number; away: number; k: number; nextText: string }
  | { v: 'more'; units: number; membersIn: number; away: number; nextText: string }
  | { v: 'unreachable'; units: number; membersIn: number };

export interface LadderModel {
  segs: Seg[];
  inUnits: number;
  pledged: number;
  /** percent 0..100 for --pos */
  pos: number;
  /** percent positions of threshold ticks */
  notches: number[];
  tierIndex: number | null;
  priceText: string | null; // current/final price, null = none
  final: boolean;
  rungs: Rung[];
  summary: SummaryModel;
  ariaLabel: string;
}

/** tier i of n -> --tier-k (DESIGN.md section 3). */
export function tierColorIndex(i: number, n: number): number {
  if (n <= 1) return 8;
  return Math.round((i * 7) / Math.max(n - 1, 1)) + 1;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const frac = (u: number, s: { from: number; to: number }) => clamp01((u - s.from) / Math.max(s.to - s.from, 1));

export function entriesOf(members: readonly MemberView[]): Entry[] {
  return members.map((m) => ({ units: m.units, threshold: m.threshold_units }));
}

export function ladderModel(pool: PoolView, members: readonly MemberView[]): LadderModel {
  const { tiers, max_units } = pool.offer;
  const n = tiers.length;
  const settled = pool.status === 'Settled';
  const refunded = pool.status === 'Refunded';
  const frozen = pool.status === 'Locked' || pool.status === 'Expired' || pool.status === 'Settling';
  const proj = pool.result ?? pool.projected;
  const pledged = pool.units_unconditional + pool.units_conditional;

  // A refunded pool has result.units == 0; what the group had pledged is the honest number.
  const inUnits = refunded ? pledged : proj.units;
  const pledgedShown = settled ? inUnits : pledged;

  const segs: Seg[] = [];
  const list = tiers.map((t) => BigInt(t.unit_price));
  if (n && tiers[0].min_units > 1) {
    segs.push({ kind: 'below', tier: -1, from: 0, to: tiers[0].min_units, in: 0, pend: 0, color: 'var(--text-disabled)' });
  }
  tiers.forEach((t, i) => {
    segs.push({
      kind: 'tier',
      tier: i,
      from: i === 0 && t.min_units === 1 ? 0 : t.min_units,
      to: tiers[i + 1]?.min_units ?? max_units,
      in: 0,
      pend: 0,
      color: `var(--tier-${tierColorIndex(i, n)})`
    });
  });
  for (const s of segs) {
    s.in = frac(inUnits, s);
    s.pend = frac(pledgedShown, s);
  }

  const posOf = (u: number): number => {
    let k = 0;
    segs.forEach((s, i) => {
      if (s.from <= u) k = i;
    });
    return ((k + frac(u, segs[k])) / segs.length) * 100;
  };
  const pos = segs.length ? posOf(inUnits) : 0;

  const tierMins = new Set(tiers.map((t) => t.min_units));
  const notches = [
    ...new Set(
      members
        .filter((m) => m.threshold_units !== null && !m.projected_in && m.outcome === null)
        .map((m) => m.threshold_units as number)
        .filter((t) => !tierMins.has(t) && t <= max_units)
    )
  ].map(posOf);

  const t = refunded ? null : proj.tier_index;
  const live = !settled && !refunded;
  const nextIdx = t === null ? 0 : t + 1;
  const entries = entriesOf(members);
  const capacity = max_units - pledged;

  const rungs: Rung[] = segs.map((s, si) => {
    if (s.kind === 'below') {
      return {
        seg: si, state: 'below-min', kind: 'below', tier: -1, minUnits: 0, price: null,
        priceText: 'No tier', delta: '', fromText: `fewer than ${tiers[0].min_units} units`,
        waiting: null, away: null, statusText: 'Everyone is refunded if the group stays here'
      } satisfies Rung;
    }
    const i = s.tier;
    const price = list[i];
    let state: RungState = 'far';
    if (t !== null && i < t) state = 'passed';
    else if (t !== null && i === t) state = 'current';
    else if (live && i === nextIdx) state = 'ahead';
    const next = tiers[i + 1]?.min_units ?? Infinity;
    let waiting: Rung['waiting'] = null;
    if (live) {
      const w = members.filter(
        (m) => m.threshold_units !== null && !m.projected_in && m.threshold_units >= tiers[i].min_units && m.threshold_units < next
      );
      if (w.length) waiting = { agents: w.length, units: w.reduce((a, m) => a + m.units, 0) };
    }
    let away: Rung['away'] = null;
    if (state === 'ahead' && !frozen) {
      away = unitsToReach(entries, tiers[i].min_units, capacity);
    }
    return {
      seg: si, state, kind: 'tier', tier: i, minUnits: tiers[i].min_units, price,
      priceText: formatNear(price),
      delta: discountLabel(list[0], price, i === 0),
      fromText: `from ${plural(tiers[i].min_units, 'unit')}`,
      waiting: state === 'ahead' ? waiting : null,
      away,
      statusText: state === 'passed' ? 'Passed' : state === 'current' ? (settled ? 'Final price' : 'Current price') : null
    } satisfies Rung;
  });

  // ---- summary sentence (first that applies) ----
  const priceText = t !== null && proj.unit_price ? formatNear(proj.unit_price) : null;
  let summary: SummaryModel;
  if (settled && t !== null) {
    const pct = list[0] > 0n ? discountLabelPct(list[0], BigInt(proj.unit_price ?? '0')) : '';
    summary = { v: 'settled', tierNo: t + 1, tierCount: n, units: proj.units, pctText: pct };
  } else if (refunded) {
    summary = { v: 'refunded', units: pledged, min: tiers[0]?.min_units ?? 0 };
  } else if (frozen) {
    summary = { v: 'frozen', priceText, units: proj.units };
  } else if (t === null) {
    const r = rungs.find((r) => r.kind === 'tier' && r.tier === 0);
    const a = r?.away && r.away.kind === 'away' ? r.away.units : null;
    summary = { v: 'notier', pledged, away: a, priceText: formatNear(list[0] ?? 0n), min: tiers[0]?.min_units ?? 0 };
  } else if (t >= n - 1) {
    summary = { v: 'best', units: proj.units, membersIn: proj.members_in };
  } else {
    const r = rungs.find((r) => r.kind === 'tier' && r.tier === t + 1);
    const nextText = formatNear(list[t + 1]);
    if (!r?.away || r.away.kind === 'unreachable') {
      summary = { v: 'unreachable', units: proj.units, membersIn: proj.members_in };
    } else if (r.away.bringsIn > 0) {
      summary = { v: 'bringsin', units: proj.units, membersIn: proj.members_in, away: r.away.units, k: r.away.bringsIn, nextText };
    } else {
      summary = { v: 'more', units: proj.units, membersIn: proj.members_in, away: r.away.units, nextText };
    }
  }

  // ---- aria ----
  const parts = rungs.map((r) => {
    if (r.kind === 'below') return `Below the first tier: fewer than ${tiers[0].min_units} units, everyone is refunded.`;
    const base = `Tier ${r.tier + 1}: ${r.priceText} NEAR ${r.fromText}`;
    if (r.state === 'passed') return `${base}, passed.`;
    if (r.state === 'current') return `${base}, ${settled ? 'final price' : 'current'}.`;
    if (r.away?.kind === 'away') return `${base}, ${plural(r.away.units, 'pledged unit')} away.`;
    return `${base}.`;
  });
  const waitingUnits = Math.max(pledgedShown - inUnits, 0);
  const ariaLabel =
    `Price ladder. ${parts.join(' ')} ${plural(inUnits, 'unit')} in the group` +
    (waitingUnits > 0 ? `, ${waitingUnits} more waiting on a condition.` : '.');

  return { segs, inUnits, pledged: pledgedShown, pos, notches, tierIndex: t, priceText, final: settled, rungs, summary, ariaLabel };
}

function discountLabelPct(list: bigint, price: bigint): string {
  const pct = Number(((list - price) * 200n + list) / (2n * list));
  if (pct === 50) return ', half the list price';
  if (pct <= 0) return ', the list price';
  return `, ${pct}% under the list price`;
}

// ---- mini bar (overview rows, receipt) ----

export interface MiniBar {
  n: number;
  segs: Seg[];
  labels: { text: string; current: boolean }[];
  inUnits: number;
  pending: number; // pledged beyond in
  max: number;
}

export function miniBar(pool: PoolView, members: readonly MemberView[] | null = null): MiniBar {
  const m = ladderModel(pool, members ?? []);
  const { tiers } = pool.offer;
  const labels: MiniBar['labels'] = [];
  for (const s of m.segs) {
    if (s.kind === 'below') labels.push({ text: `min ${tiers[0].min_units}`, current: false });
    else labels.push({ text: formatNear(tiers[s.tier].unit_price), current: m.tierIndex === s.tier });
  }
  return {
    n: m.segs.length,
    segs: m.segs,
    labels,
    inUnits: m.inUnits,
    pending: Math.max(m.pledged - m.inUnits, 0),
    max: pool.offer.max_units
  };
}

// ---- derived client events ----

export function minus(s: string): string {
  return s.replace('-', MINUS);
}
