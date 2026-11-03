/** Seller side: post offers with inventory, and (opt-in, P1) improve a stalled offer before lock. */
import type { Account } from "near-api-js";
import type { CoopClient } from "./chain.js";
import type { PoolView, Tier, TxRef } from "./types.js";

export interface OfferSpec {
  title: string;
  description: string;
  tiers: Tier[];
  maxUnits: number;
  /** Item token base units per Co-op unit. Default 1 (the demo token has decimals 0). */
  unitAmount?: bigint;
  /** Time from now until the deadline. */
  durationMs: number;
  /** Membership freezes this long before the deadline. */
  lockWindowMs: number;
}

export interface PostedOffer {
  offerId: number;
  deadlineNs: bigint;
  lockAtNs: bigint;
  txs: TxRef[];
}

/** create_offer + inventory deposit (ft_transfer_call). The offer opens when the deposit lands. */
export async function postOffer(client: CoopClient, seller: Account, tokenId: string, spec: OfferSpec): Promise<PostedOffer> {
  const unitAmount = spec.unitAmount ?? 1n;
  const now = await client.chainNowNs();
  const deadlineNs = now + BigInt(spec.durationMs) * 1_000_000n;
  const lockWindowNs = BigInt(spec.lockWindowMs) * 1_000_000n;
  const created = await client.createOffer(seller, {
    itemToken: tokenId,
    title: spec.title,
    description: spec.description,
    tiers: spec.tiers,
    maxUnits: spec.maxUnits,
    unitAmount,
    deadlineNs,
    lockWindowNs,
  });
  const deposit = await client.depositInventory(seller, created.offerId, BigInt(spec.maxUnits) * unitAmount, tokenId);
  return { offerId: created.offerId, deadlineNs, lockAtNs: deadlineNs - lockWindowNs, txs: [created.tx, deposit] };
}

// ------------------------------------------------------------------------------------------------
// Negotiation (P1)
// ------------------------------------------------------------------------------------------------

function priceAt(tiers: Tier[], total: number): bigint | null {
  for (let i = tiers.length - 1; i >= 0; i--) {
    const tier = tiers[i] as Tier;
    if (tier.min_units <= total) return BigInt(tier.unit_price);
  }
  return null;
}

/** Local mirror of the contract's `is_improvement`: no worse for buyers at any total. */
export function isImprovement(oldTiers: Tier[], newTiers: Tier[], maxUnits: number): boolean {
  const totals = [...oldTiers, ...newTiers].map((t) => t.min_units).filter((t) => t <= maxUnits);
  return totals.every((t) => {
    const before = priceAt(oldTiers, t);
    if (before === null) return true;
    const after = priceAt(newTiers, t);
    return after !== null && after <= before;
  });
}

function validLadder(tiers: Tier[], maxUnits: number): boolean {
  if (tiers.length === 0 || tiers.length > 8) return false;
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i] as Tier;
    if (t.min_units < 1 || t.min_units > maxUnits) return false;
    const prev = tiers[i - 1];
    if (prev && (t.min_units <= prev.min_units || BigInt(t.unit_price) >= BigInt(prev.unit_price))) return false;
  }
  return BigInt((tiers[tiers.length - 1] as Tier).unit_price) > 0n;
}

export interface ImprovementOptions {
  /** Only act this close to the lock time. */
  withinMsOfLock: number;
  /** Only act if the gap to the next tier is at most this share of that tier's minimum. */
  maxShortfallRatio?: number;
}

/**
 * Proposes a better ladder for a pool that is short of its next tier near lock time, or null.
 * - Below the first tier: lower the first tier's minimum to the units already committed.
 * - Between tiers: add a tier halfway to the next one, priced halfway between the two prices.
 * The proposal always passes `isImprovement`; the contract re-checks it.
 */
export function proposeImprovement(pool: PoolView, nowNs: bigint, options: ImprovementOptions): Tier[] | null {
  const offer = pool.offer;
  if (pool.status !== "Open") return null;
  const untilLockNs = BigInt(offer.lock_at_ns) - nowNs;
  if (untilLockNs <= 0n || untilLockNs > BigInt(options.withinMsOfLock) * 1_000_000n) return null;
  const tiers = offer.tiers;
  const have = pool.projected.units;
  if (have < 1) return null;

  let proposal: Tier[] | null = null;
  if (pool.projected.tier_index === null) {
    const first = tiers[0] as Tier;
    if (have >= first.min_units) return null;
    proposal = [{ min_units: have, unit_price: first.unit_price }, ...tiers.slice(1)];
  } else {
    const current = tiers[pool.projected.tier_index];
    const next = tiers[pool.projected.tier_index + 1];
    if (!current || !next) return null;
    const shortfall = next.min_units - have;
    if (shortfall < 2 || shortfall > Math.ceil(next.min_units * (options.maxShortfallRatio ?? 0.6))) return null;
    const minUnits = have + Math.ceil(shortfall / 2);
    const price = (BigInt(current.unit_price) + BigInt(next.unit_price)) / 2n;
    if (minUnits <= current.min_units || minUnits >= next.min_units) return null;
    if (price >= BigInt(current.unit_price) || price <= BigInt(next.unit_price)) return null;
    proposal = [
      ...tiers.slice(0, pool.projected.tier_index + 1),
      { min_units: minUnits, unit_price: price.toString() },
      ...tiers.slice(pool.projected.tier_index + 1),
    ];
  }
  if (!validLadder(proposal, offer.max_units) || !isImprovement(tiers, proposal, offer.max_units)) return null;
  return proposal;
}

/** Watches the seller's pools and improves each stalled offer at most once. Opt-in. */
export class SellerAgent {
  private readonly improved = new Set<number>();

  constructor(
    readonly client: CoopClient,
    readonly seller: Account,
    private readonly options: ImprovementOptions,
  ) {}

  /** Returns the improvements made on this pass (offer id, new ladder, tx). */
  async tick(pools: PoolView[], nowNs?: bigint): Promise<Array<{ offerId: number; tiers: Tier[]; tx: TxRef }>> {
    const now = nowNs ?? (await this.client.chainNowNs());
    const done: Array<{ offerId: number; tiers: Tier[]; tx: TxRef }> = [];
    for (const pool of pools) {
      if (pool.offer.seller !== this.seller.accountId || this.improved.has(pool.id)) continue;
      const tiers = proposeImprovement(pool, now, this.options);
      if (!tiers) continue;
      this.improved.add(pool.id);
      done.push({ offerId: pool.id, tiers, tx: await this.client.improveOffer(this.seller, pool.id, tiers) });
    }
    return done;
  }
}
