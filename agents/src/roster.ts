/**
 * The demo cast: a deterministic mix of buyers against one offer with tiers
 * [1 unit: top, 20 units: 70% of top, 50 units: 50% of top].
 *
 * The story (PRD section 14): eager agents bring the group to 15-19 units, bargain agents with a
 * threshold of 20 flip in as they arrive, and the 50-unit tier is NOT reached, so the bargain agents
 * who waited for it are excluded and refunded in full.
 */
import { parseNear, pct } from "./money.js";
import { limitsFromPolicy } from "./policy.js";
import type { Archetype, Policy, Tier } from "./types.js";

export interface RosterEntry {
  label: string;
  kind: "eager" | "bargain-20" | "bargain-50";
  archetype: Archetype;
  units: number;
  policy: Policy;
  /** Budget deposited into the contract at registration (yocto). */
  budget: bigint;
}

export function storyTiers(top: bigint): Tier[] {
  return [
    { min_units: 1, unit_price: top.toString() },
    { min_units: 20, unit_price: pct(top, 70).toString() },
    { min_units: 50, unit_price: pct(top, 50).toString() },
  ];
}

const EAGER_UNITS = [4, 4, 3, 4, 4];
const B20_UNITS = [2, 2, 3, 2, 2];
const B50_UNITS = [4, 4, 5];
/** Budget on top of the maximum lock: NEP-145 reserve, membership storage, rounding. */
const BUDGET_SLACK = parseNear("0.03");

/** Keeps the whole roster below the 50-unit tier by trimming the largest orders. */
function trimUnits(entries: { units: number }[], ceiling: number): void {
  for (;;) {
    const total = entries.reduce((n, e) => n + e.units, 0);
    if (total <= ceiling) return;
    const largest = entries.reduce((a, b) => (b.units > a.units ? b : a));
    if (largest.units <= 1) return;
    largest.units -= 1;
  }
}

/** Order in which agents arrive: eager first, a waiting bargain agent early, the rest staggered in. */
function arrivalOrder<T>(eager: T[], b20: T[], b50: T[]): T[] {
  const half = Math.ceil(eager.length / 2);
  return [...eager.slice(0, half), ...b50.slice(0, 1), ...eager.slice(half), ...b20, ...b50.slice(1)];
}

/**
 * Roster for `count` agents (6 to 60). Labels are unique per `prefix`, so a demo can run many rounds.
 * Returned in arrival order.
 */
export function buildRoster(count: number, top: bigint, prefix = "buyer"): RosterEntry[] {
  if (!Number.isInteger(count) || count < 6 || count > 60) throw new Error("agents must be between 6 and 60");
  const b50Count = Math.max(1, Math.round(count * 0.17));
  const eagerCount = Math.round(count * 0.42);
  const b20Count = count - eagerCount - b50Count;

  const make = (kind: RosterEntry["kind"], n: number, units: number[]) =>
    Array.from({ length: n }, (_, i) => ({ kind, index: i, units: units[i % units.length] as number }));
  const eager = make("eager", eagerCount, EAGER_UNITS);
  const b20 = make("bargain-20", b20Count, B20_UNITS);
  const b50 = make("bargain-50", b50Count, B50_UNITS);
  trimUnits([...eager, ...b20, ...b50], 49);

  const entry = (kind: RosterEntry["kind"], index: number, units: number): RosterEntry => {
    const label = `${prefix}-${kind === "eager" ? "e" : kind === "bargain-20" ? "b20" : "b50"}${index + 1}`;
    if (kind === "eager") {
      // Alternate between a limit equal to the entry price and one 10% above it.
      const limit = index % 2 === 0 ? top : pct(top, 110);
      const policy: Policy = { archetype: "eager", units, max_unit_price: limit.toString() };
      return { label, kind, archetype: "eager", units, policy, budget: BigInt(units) * top + BUDGET_SLACK };
    }
    const tierPrice = kind === "bargain-20" ? pct(top, 70) : pct(top, 50);
    const limit = kind === "bargain-20" ? pct(top, 90) : pct(top, 55);
    const policy: Policy = { archetype: "bargain", units, max_unit_price: limit.toString(), target_price: tierPrice.toString() };
    return { label, kind, archetype: "bargain", units, policy, budget: BigInt(units) * tierPrice + BUDGET_SLACK };
  };

  const ordered = arrivalOrder(eager, b20, b50);
  return ordered.map((e) => entry(e.kind, e.index, e.units));
}

export { limitsFromPolicy };
