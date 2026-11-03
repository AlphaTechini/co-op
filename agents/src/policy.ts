/**
 * Deterministic buying policy. Every decision an agent makes comes from here, from structured
 * limits and the numbers on chain. No LLM is involved (PRD section 7).
 */
import { STORAGE_RESERVE, formatPrice, parseNear } from "./money.js";
import type { AgentLimits, AgentView, Policy, PoolView, Tier } from "./types.js";

/** Contract constant MAX_MEMBERS (contracts/coop/src/lib.rs). */
export const MAX_POOL_MEMBERS = 100;
export const MAX_MEMO_CHARS = 140;
/**
 * Extra budget an agent must keep free on top of `units * price + STORAGE_RESERVE`: the contract
 * charges the membership's storage (a few hundred bytes) from the same budget at join time.
 */
export const MEMBERSHIP_STORAGE_HEADROOM = parseNear("0.02");

export type Decision =
  | { action: "join"; units: number; threshold_units: number | null; memo: string }
  | { action: "leave"; memo: string }
  | { action: "skip"; memo: string };

export interface DecideOptions {
  /** Chain "now" in ns, for agent expiry. Defaults to wall clock (sandbox and testnet follow it). */
  nowNs?: bigint;
  headroom?: bigint;
}

export function validatePolicy(policy: Policy): void {
  if (!["eager", "bargain", "switcher"].includes(policy.archetype)) {
    throw new Error(`Unknown archetype "${String(policy.archetype)}"`);
  }
  if (!Number.isInteger(policy.units) || policy.units < 1) throw new Error("policy.units must be a positive integer");
  if (!/^\d+$/.test(policy.max_unit_price) || BigInt(policy.max_unit_price) <= 0n) {
    throw new Error("policy.max_unit_price must be a positive yocto string");
  }
  if (policy.target_price !== undefined && (!/^\d+$/.test(policy.target_price) || BigInt(policy.target_price) <= 0n)) {
    throw new Error("policy.target_price must be a positive yocto string");
  }
}

/** On-chain limits that match a policy (the contract enforces them, whatever the runtime does). */
export function limitsFromPolicy(policy: Policy, expiresAtNs?: bigint): AgentLimits {
  return {
    max_unit_price: policy.max_unit_price,
    max_units_per_pool: policy.units,
    allowed_sellers: policy.allowed_sellers ?? null,
    expires_at_ns: expiresAtNs === undefined ? null : expiresAtNs.toString(),
  };
}

/** Single-line memo: collapses whitespace, replaces dashes that read like em-dashes, caps at 140 chars. */
export function clampMemo(text: string): string {
  const clean = text.replace(/[–—]/g, ",").replace(/\s+/g, " ").trim();
  return clean.length <= MAX_MEMO_CHARS ? clean : `${clean.slice(0, MAX_MEMO_CHARS - 1).trimEnd()}.`;
}

const price = (tier: Tier): bigint => BigInt(tier.unit_price);

/** Price the pool projects right now; the entry price if nothing is reached yet. */
export function projectedUnitPrice(pool: PoolView): bigint {
  const p = pool.projected.unit_price;
  const first = pool.offer.tiers[0];
  if (p !== null) return BigInt(p);
  if (!first) throw new Error(`Pool ${pool.id} has no tiers`);
  return price(first);
}

function remainingCapacity(pool: PoolView): number {
  return pool.offer.max_units - pool.units_unconditional - pool.units_conditional;
}

interface Plan {
  units: number;
  threshold: number | null;
  lockPrice: bigint;
  cap: bigint;
  conditional: boolean;
}

/** Why a pool cannot be joined at all right now, or null. */
function blocker(policy: Policy, pool: PoolView, agent: AgentView, nowNs: bigint): string | null {
  if (pool.status !== "Open") return `Pool is ${pool.status}, not open for joining.`;
  if (pool.member_count >= MAX_POOL_MEMBERS) return "Pool is full.";
  if (remainingCapacity(pool) < 1) return "Pool has no units left.";
  const seller = pool.offer.seller;
  if (policy.allowed_sellers && !policy.allowed_sellers.includes(seller)) return `Seller ${seller} is not on my list.`;
  if (agent.limits.allowed_sellers && !agent.limits.allowed_sellers.includes(seller)) {
    return `Seller ${seller} is not allowed by my on-chain limits.`;
  }
  if (agent.limits.expires_at_ns !== null && nowNs >= BigInt(agent.limits.expires_at_ns)) return "My limits have expired.";
  return null;
}

/** Highest unit price this agent will accept: policy limit, on-chain limit, optional target. */
function priceCap(policy: Policy, agent: AgentView, useTarget: boolean): bigint {
  let cap = BigInt(policy.max_unit_price);
  const chain = BigInt(agent.limits.max_unit_price);
  if (chain < cap) cap = chain;
  if (useTarget && policy.target_price !== undefined) {
    const target = BigInt(policy.target_price);
    if (target < cap) cap = target;
  }
  return cap;
}

/** Largest unit count that satisfies units, capacity and budget constraints (0 if none). */
function affordableUnits(policy: Policy, pool: PoolView, agent: AgentView, lockPrice: bigint, headroom: bigint): number {
  let units = Math.min(policy.units, agent.limits.max_units_per_pool, remainingCapacity(pool));
  const budget = BigInt(agent.budget_available);
  while (units > 0 && BigInt(units) * lockPrice + STORAGE_RESERVE + headroom > budget) units--;
  return units;
}

/** Eager plan: unconditional at the entry tier. Null with a reason if the entry price is too high. */
function eagerPlan(policy: Policy, pool: PoolView, agent: AgentView, headroom: bigint): Plan | string {
  const first = pool.offer.tiers[0];
  if (!first) return "Offer has no tiers.";
  const cap = priceCap(policy, agent, false);
  const entry = price(first);
  if (entry > cap) return `Entry price ${formatPrice(entry)} is above my ${formatPrice(cap)} limit.`;
  const units = affordableUnits(policy, pool, agent, entry, headroom);
  if (units < 1) return "Not enough budget left for this pool.";
  return { units, threshold: null, lockPrice: entry, cap, conditional: false };
}

/**
 * Bargain plan: conditional at the smallest group size whose tier price is within the limit
 * (and the target price, if set). That is the first tier in ladder order with price <= cap.
 */
function bargainPlan(policy: Policy, pool: PoolView, agent: AgentView, headroom: bigint): Plan | string {
  const cap = priceCap(policy, agent, true);
  const tiers = pool.offer.tiers;
  const tier = tiers.find((t) => price(t) <= cap);
  if (!tier) {
    const best = tiers[tiers.length - 1];
    return best
      ? `Best tier price ${formatPrice(price(best))} is above my ${formatPrice(cap)} limit.`
      : "Offer has no tiers.";
  }
  const lockPrice = price(tier);
  const units = affordableUnits(policy, pool, agent, lockPrice, headroom);
  if (units < 1) return "Not enough budget left for this pool.";
  // A threshold that my own units already satisfy is no condition at all.
  const threshold = tier.min_units <= units ? null : tier.min_units;
  return { units, threshold, lockPrice, cap, conditional: threshold !== null };
}

function planMemo(plan: Plan, pool: PoolView): string {
  if (plan.conditional && plan.threshold !== null) {
    return clampMemo(
      `In if the group reaches ${plan.threshold}. I only buy at ${formatPrice(plan.cap)} or less.`,
    );
  }
  const entry = formatPrice(plan.lockPrice);
  const tier0 = pool.offer.tiers[0];
  if (tier0 && plan.lockPrice === price(tier0)) {
    return clampMemo(`Entry price ${entry} is within my ${formatPrice(plan.cap)} limit. Joining now.`);
  }
  return clampMemo(`Price ${entry} is within my ${formatPrice(plan.cap)} limit. Joining now.`);
}

/** Open pools for the same item (same token) the agent could still join, other than `pool`. */
function rivals(policy: Policy, pool: PoolView, agent: AgentView, others: PoolView[], nowNs: bigint): PoolView[] {
  return others.filter(
    (q) =>
      q.id !== pool.id &&
      q.offer.item_token === pool.offer.item_token &&
      !agent.active_pools.includes(q.id) &&
      blocker(policy, q, agent, nowNs) === null,
  );
}

function switcherJoin(
  policy: Policy,
  pool: PoolView,
  agent: AgentView,
  others: PoolView[],
  nowNs: bigint,
  headroom: bigint,
): Decision {
  const mine = others.find((q) => agent.active_pools.includes(q.id) && q.offer.item_token === pool.offer.item_token);
  if (mine) return { action: "skip", memo: `Already waiting in pool ${mine.id} for this item.` };
  const here = projectedUnitPrice(pool);
  const better = rivals(policy, pool, agent, others, nowNs).find((q) => projectedUnitPrice(q) < here);
  if (better) {
    return {
      action: "skip",
      memo: `Pool ${better.id} projects ${formatPrice(projectedUnitPrice(better))} vs ${formatPrice(here)} here. Waiting for it.`,
    };
  }
  const eager = eagerPlan(policy, pool, agent, headroom);
  const plan = typeof eager === "string" ? bargainPlan(policy, pool, agent, headroom) : eager;
  if (typeof plan === "string") return { action: "skip", memo: plan };
  return { action: "join", units: plan.units, threshold_units: plan.threshold, memo: planMemo(plan, pool) };
}

/**
 * The decision for one agent about one pool.
 * - eager: join unconditionally if the entry price is within the limit.
 * - bargain: join conditionally at the group size of the first tier within limit and target.
 * - switcher: sit in the pool with the lowest projected price; leave before lock when another open
 *   pool for the same item projects a lower price (and join that one on the next pass).
 */
export function decide(
  policy: Policy,
  pool: PoolView,
  agent: AgentView,
  otherPools: PoolView[] = [],
  options: DecideOptions = {},
): Decision {
  const nowNs = options.nowNs ?? BigInt(Date.now()) * 1_000_000n;
  const headroom = options.headroom ?? MEMBERSHIP_STORAGE_HEADROOM;
  const isMember = agent.active_pools.includes(pool.id);

  if (isMember) {
    if (policy.archetype === "switcher" && pool.status === "Open") {
      const here = projectedUnitPrice(pool);
      const better = rivals(policy, pool, agent, otherPools, nowNs)
        .filter((q) => projectedUnitPrice(q) < here)
        .sort((a, b) => (projectedUnitPrice(a) < projectedUnitPrice(b) ? -1 : 1))[0];
      if (better) {
        return {
          action: "leave",
          memo: clampMemo(
            `Pool ${better.id} projects ${formatPrice(projectedUnitPrice(better))} vs ${formatPrice(here)} here. Moving before lock.`,
          ),
        };
      }
    }
    return { action: "skip", memo: "Already in this pool." };
  }

  const blocked = blocker(policy, pool, agent, nowNs);
  if (blocked) return { action: "skip", memo: blocked };

  if (policy.archetype === "switcher") return switcherJoin(policy, pool, agent, otherPools, nowNs, headroom);

  const plan = policy.archetype === "eager" ? eagerPlan(policy, pool, agent, headroom) : bargainPlan(policy, pool, agent, headroom);
  if (typeof plan === "string") return { action: "skip", memo: plan };
  return { action: "join", units: plan.units, threshold_units: plan.threshold, memo: planMemo(plan, pool) };
}
