// Pure mirror of the contract's resolve + price logic (SPEC 1.5).
// Used for "N more pledged units" simulations; the chain stays the source of truth.

export interface TierLike {
  min_units: number;
  unit_price: string | bigint;
}

export interface Entry {
  units: number;
  /** null = unconditional */
  threshold: number | null;
}

export interface Resolution {
  /** Total units of the surviving group. */
  units: number;
  /** included[i] tells whether entries[i] is in the group. */
  included: boolean[];
  membersIn: number;
}

/**
 * Greatest fixed point: start with everyone, repeatedly drop the member with the highest
 * threshold while that threshold exceeds the group's total units.
 * Two 25-unit members with threshold 50 therefore both stay (total 50 >= 50).
 */
export function resolve(entries: readonly Entry[]): Resolution {
  const included = entries.map(() => true);
  let total = 0;
  for (const e of entries) total += e.units;
  const conditional = entries
    .map((e, i) => ({ i, t: e.threshold }))
    .filter((x): x is { i: number; t: number } => x.t !== null)
    .sort((a, b) => b.t - a.t);
  for (const { i, t } of conditional) {
    if (t <= total) break;
    included[i] = false;
    total -= entries[i].units;
  }
  return { units: total, included, membersIn: included.filter(Boolean).length };
}

export interface PricePoint {
  index: number;
  price: bigint;
}

/** Best tier with min_units <= units, or null when the first tier is out of reach. */
export function priceFor(tiers: readonly TierLike[], units: number): PricePoint | null {
  let best: PricePoint | null = null;
  tiers.forEach((t, index) => {
    if (t.min_units <= units) best = { index, price: BigInt(t.unit_price) };
  });
  return best;
}

export interface GroupOutcome extends Resolution {
  tier: PricePoint | null;
}

export function evaluate(entries: readonly Entry[], tiers: readonly TierLike[]): GroupOutcome {
  const r = resolve(entries);
  return { ...r, tier: priceFor(tiers, r.units) };
}

export type AwayResult = { kind: 'away'; units: number; bringsIn: number } | { kind: 'unreachable' };

/**
 * Smallest x >= 1 of extra unconditional units such that the resolved group reaches
 * `targetMinUnits`. Simulated, not subtracted: extra units can pull waiting conditional
 * members in, so the answer is often smaller than the plain gap.
 * `bringsIn` is how many existing members join the group at that point (beyond those already in).
 */
export function unitsToReach(
  entries: readonly Entry[],
  targetMinUnits: number,
  capacity: number
): AwayResult {
  if (capacity < 1) return { kind: 'unreachable' };
  const base = resolve(entries);
  const reached = (x: number) => resolve([...entries, { units: x, threshold: null }]);
  if (reached(capacity).units < targetMinUnits) return { kind: 'unreachable' };
  // resolve(...).units is non-decreasing in x, so binary search is exact.
  let lo = 1;
  let hi = capacity;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reached(mid).units >= targetMinUnits) hi = mid;
    else lo = mid + 1;
  }
  const r = reached(lo);
  // the synthetic joiner is last and always included
  const bringsIn = r.included.slice(0, entries.length).filter(Boolean).length - base.membersIn;
  return { kind: 'away', units: lo, bringsIn };
}
