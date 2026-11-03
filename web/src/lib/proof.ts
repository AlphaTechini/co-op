// The invariant made visible (DESIGN.md 7.13 / 7.14). Everything is computed from chain data in BigInt.
import { STORAGE_RESERVE, sumBig } from './format';
import type { AgentView, MemberView, PoolView } from './models';

export interface LedgerRow {
  member: MemberView;
  filled: boolean;
  units: number;
  paid: bigint;
  refunded: bigint;
  locked: bigint;
  /** null while the agent's limit has not been loaded */
  limit: bigint | null;
  perUnit: bigint | null;
  /** paid per unit <= limit (null = unknown) */
  withinLimit: boolean | null;
  /** paid / (units * limit) as a 0..1000 permille, clamped at 1000; null when unknown */
  permille: number | null;
}

export interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface Receipt {
  refundedPool: boolean;
  rows: LedgerRow[];
  filledCount: number;
  excludedCount: number;
  withinCount: number;
  missingLimits: number;
  totals: { units: number; locked: bigint; paid: bigint; refunded: bigint; storage: bigint };
  tightestLimit: bigint | null;
  unitPrice: bigint | null;
  checks: Check[];
  /** the first failing check that is a real inconsistency (not just missing data) */
  failure: string | null;
  verified: boolean;
}

export function buildReceipt(pool: PoolView, members: readonly MemberView[], agents: ReadonlyMap<string, AgentView>): Receipt {
  const result = pool.result;
  const refundedPool = pool.status === 'Refunded';
  const price = result?.unit_price ? BigInt(result.unit_price) : null;

  const rows: LedgerRow[] = members.map((m) => {
    const filled = m.outcome === 'Filled';
    const paid = m.paid ? BigInt(m.paid) : 0n;
    const refunded = m.refunded ? BigInt(m.refunded) : 0n;
    const a = agents.get(m.agent_id);
    const limit = a ? BigInt(a.limits.max_unit_price) : null;
    const perUnit = filled && m.units > 0 ? paid / BigInt(m.units) : null;
    const withinLimit = !filled ? null : limit === null || perUnit === null ? null : perUnit <= limit && paid === BigInt(m.units) * perUnit;
    let permille: number | null = null;
    if (filled && limit !== null && limit > 0n && perUnit !== null) {
      permille = Number((perUnit * 1000n) / limit);
      if (permille > 1000) throw new Error(`Receipt invariant broken for ${m.agent_id}: paid per unit exceeds its limit`);
    }
    return { member: m, filled, units: m.units, paid, refunded, locked: BigInt(m.locked), limit, perUnit, withinLimit, permille };
  });

  const filled = rows.filter((r) => r.filled);
  const excluded = rows.filter((r) => !r.filled);
  const paid = sumBig(rows.map((r) => r.paid));
  const totals = {
    units: filled.reduce((a, r) => a + r.units, 0),
    locked: sumBig(rows.map((r) => r.locked)),
    paid,
    refunded: sumBig(rows.map((r) => r.refunded)),
    storage: BigInt(filled.length) * STORAGE_RESERVE
  };

  const limits = filled.map((r) => r.limit).filter((l): l is bigint => l !== null);
  const tightest = limits.length ? limits.reduce((a, b) => (a < b ? a : b)) : null;
  const missingLimits = filled.filter((r) => r.limit === null).length;
  const withinCount = filled.filter((r) => r.withinLimit === true).length;

  const checks: Check[] = [];
  let failure: string | null = null;
  const fail = (msg: string) => {
    failure ??= msg;
  };

  if (refundedPool) {
    const sellerNotPaid = !result || BigInt(result.seller_payout) === 0n;
    const allBack = rows.every((r) => r.member.outcome === 'Refunded' && r.refunded === r.locked && r.paid === 0n);
    checks.push({ label: 'Seller was not paid', ok: sellerNotPaid });
    checks.push({ label: 'Every lock returned', ok: allBack });
    if (!sellerNotPaid) fail('the seller was paid in a refunded pool');
    if (!allBack) fail('a lock was not returned in full');
  } else {
    const tierReached = !!result && result.tier_index !== null && price !== null && BigInt(result.seller_payout) > 0n;
    const noMoreThanLocked = filled.every((r) => r.paid <= r.locked);
    const sumMatches = !!result && paid === BigInt(result.seller_payout);
    const priceMatches = price === null || filled.every((r) => r.paid === BigInt(r.units) * price);
    const reconciles = rows.every((r) =>
      r.filled ? r.locked === r.paid + r.refunded + STORAGE_RESERVE : r.locked === r.refunded && r.paid === 0n
    );
    checks.push({ label: 'Seller paid because the group reached a tier', ok: tierReached });
    checks.push({ label: 'No agent paid more than it locked', ok: noMoreThanLocked });
    checks.push({ label: 'Sum of payments equals the seller payout', ok: sumMatches });
    if (!tierReached) fail('the seller was paid without a tier being reached');
    if (!noMoreThanLocked) fail('an agent paid more than it locked');
    if (!sumMatches) fail('the sum of payments is not the seller payout');
    if (!priceMatches) fail('an agent did not pay the group price');
    if (!reconciles) fail('locked is not paid plus refunded plus storage');
    if (filled.some((r) => r.withinLimit === false)) fail('an agent paid above its limit');
  }

  const verified = failure === null && missingLimits === 0 && checks.every((c) => c.ok);
  return {
    refundedPool,
    rows,
    filledCount: filled.length,
    excludedCount: excluded.length,
    withinCount,
    missingLimits,
    totals,
    tightestLimit: tightest,
    unitPrice: price,
    checks,
    failure,
    verified
  };
}
