/**
 * Recomputes the Co-op invariants from chain views after a pool has resolved:
 * no member paid more than its limit, paid + refunded + storage == locked, sum paid == seller payout,
 * token balances match the units delivered. Nothing here trusts what the runtime logged.
 */
import type { CoopClient } from "./chain.js";
import { STORAGE_RESERVE, formatNear, parseNear, sumBig } from "./money.js";
import type { AgentView, ChainEvent, MemberView, PoolView, TxRef } from "./types.js";

export interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Snapshot {
  /** Token balance (base units) per agent before the pool. */
  tokenBalances: Map<string, bigint>;
  /** budget_available per agent before the pool. */
  budgets: Map<string, bigint>;
  sellerTokens: bigint;
  coopTokens: bigint;
}

export async function takeSnapshot(client: CoopClient, agentIds: string[], seller: string): Promise<Snapshot> {
  const tokenBalances = new Map<string, bigint>();
  const budgets = new Map<string, bigint>();
  await Promise.all(
    agentIds.map(async (id) => {
      tokenBalances.set(id, await client.ftBalanceOf(id));
      const view = await client.getAgent(id);
      if (view) budgets.set(id, BigInt(view.budget_available));
    }),
  );
  return {
    tokenBalances,
    budgets,
    sellerTokens: await client.ftBalanceOf(seller),
    coopTokens: await client.ftBalanceOf(client.coopId),
  };
}

export interface MemberRow {
  member: MemberView;
  agent: AgentView;
  limit: bigint;
  paid: bigint;
  refunded: bigint;
  locked: bigint;
  tokens: bigint;
  /** Membership storage spent, derived from the budget movement (null if no snapshot). */
  storageFee: bigint | null;
}

export interface Verification {
  pool: PoolView;
  rows: MemberRow[];
  checks: Check[];
  ok: boolean;
}

const MAX_MEMBERSHIP_FEE = parseNear("0.02");

export async function verifyPool(
  client: CoopClient,
  poolId: number,
  snapshot: Snapshot,
  settleTxs: TxRef[],
): Promise<Verification> {
  const pool = await client.getPool(poolId);
  if (!pool) throw new Error(`Pool ${poolId} not found`);
  const members = await client.getAllPoolMembers(poolId);
  const agents = new Map<string, AgentView>();
  for (const a of await client.listAllAgents()) agents.set(a.agent_id, a);
  const unitAmount = BigInt(pool.offer.unit_amount);
  const result = pool.result;
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => checks.push({ name, pass, detail });

  add(
    "pool is finished",
    (pool.status === "Settled" || pool.status === "Refunded") && result !== null,
    `status ${pool.status}, ${members.length} members`,
  );

  const rows: MemberRow[] = [];
  for (const member of members) {
    const agent = agents.get(member.agent_id);
    if (!agent) throw new Error(`Agent ${member.agent_id} missing from list_agents`);
    const paid = BigInt(member.paid ?? "0");
    const refunded = BigInt(member.refunded ?? "0");
    const before = snapshot.budgets.get(member.agent_id);
    const filled = member.outcome === "Filled";
    const storageFee =
      before === undefined ? null : before - BigInt(agent.budget_available) - paid - (filled ? STORAGE_RESERVE : 0n);
    rows.push({
      member,
      agent,
      limit: BigInt(agent.limits.max_unit_price),
      paid,
      refunded,
      locked: BigInt(member.locked),
      tokens: await client.ftBalanceOf(member.agent_id),
      storageFee,
    });
  }

  const over = rows.filter((r) => r.paid > BigInt(r.member.units) * r.limit);
  add("every member paid <= units x its own limit", over.length === 0, over.length === 0 ? `${rows.length} members checked` : `over limit: ${over.map((r) => r.member.agent_id).join(", ")}`);

  const unbalanced = rows.filter((r) => r.paid + r.refunded + (r.member.outcome === "Filled" ? STORAGE_RESERVE : 0n) !== r.locked);
  add("paid + refunded + storage == locked, per member", unbalanced.length === 0, unbalanced.length === 0 ? `${rows.length} members balance to the yocto` : `unbalanced: ${unbalanced.map((r) => r.member.agent_id).join(", ")}`);

  const price = result?.unit_price ? BigInt(result.unit_price) : null;
  const wrongPrice = rows.filter((r) =>
    r.member.outcome === "Filled" ? price === null || r.paid !== BigInt(r.member.units) * price : r.paid !== 0n,
  );
  add("filled members paid units x tier price, the rest paid nothing", wrongPrice.length === 0, price === null ? "no tier reached" : `tier price ${formatNear(price, 4, 2)}`);

  const totalPaid = sumBig(rows.map((r) => r.paid));
  const payout = BigInt(result?.seller_payout ?? "0");
  add("sum of member payments == seller payout", totalPaid === payout, `${formatNear(totalPaid, 6)} vs ${formatNear(payout, 6)} NEAR`);

  const sellerPaidEvents = settleTxs.flatMap((t) => t.events).filter((e: ChainEvent) => e.event === "seller_paid");
  const paidOut = sumBig(sellerPaidEvents.flatMap((e) => e.data.map((d) => BigInt(String(d.amount)))));
  add("seller_paid event matches payout", paidOut === payout, `${formatNear(paidOut, 6)} NEAR in events`);

  const filledRows = rows.filter((r) => r.member.outcome === "Filled");
  const filledUnits = filledRows.reduce((n, r) => n + r.member.units, 0);
  add(
    "group size matches the resolved result",
    result !== null && filledUnits === result.units && filledRows.length === result.members_in,
    `${filledUnits} units from ${filledRows.length} members`,
  );
  add("seller paid only if a tier was reached", result === null || result.tier_index !== null || (payout === 0n && filledRows.length === 0), result?.tier_index === null ? "no tier: payout 0, nobody filled" : `tier ${result?.tier_index}`);

  const deliveryProblems: string[] = [];
  const deliveredUnits = filledRows.reduce((n, r) => n + (r.member.delivery === "Delivered" ? r.member.units : 0), 0);
  for (const r of rows) {
    const id = r.member.agent_id;
    const before = snapshot.tokenBalances.get(id);
    const expectedGain = r.member.outcome === "Filled" && r.member.delivery === "Delivered" ? BigInt(r.member.units) * unitAmount : 0n;
    if (before !== undefined && r.tokens !== before + expectedGain) deliveryProblems.push(`${id} has ${r.tokens}, expected ${before + expectedGain}`);
    if (before === undefined && r.tokens < expectedGain) deliveryProblems.push(`${id} has ${r.tokens}, expected at least ${expectedGain}`);
    if (r.member.outcome === "Filled" && r.member.delivery !== "Delivered") deliveryProblems.push(`${id} delivery is ${String(r.member.delivery)}`);
  }
  add("token balances match units delivered", deliveryProblems.length === 0, deliveryProblems.length === 0 ? `${deliveredUnits} units delivered` : deliveryProblems.join("; "));

  const sellerNow = await client.ftBalanceOf(pool.offer.seller);
  const coopNow = await client.ftBalanceOf(client.coopId);
  add("inventory fully accounted for (seller kept the unsold units)", sellerNow === snapshot.sellerTokens - BigInt(deliveredUnits) * unitAmount && coopNow === snapshot.coopTokens, `seller ${snapshot.sellerTokens} -> ${sellerNow}, escrow ${snapshot.coopTokens} -> ${coopNow}`);

  const stuck = rows.filter((r) => BigInt(r.agent.budget_locked) !== 0n);
  add("no budget left locked", stuck.length === 0, stuck.length === 0 ? "budget_locked is 0 for every member" : stuck.map((r) => r.member.agent_id).join(", "));

  const fees = rows.map((r) => r.storageFee).filter((f): f is bigint => f !== null);
  const badFee = fees.filter((f) => f < 0n || f > MAX_MEMBERSHIP_FEE);
  add("membership storage cost is small and non-negative", badFee.length === 0, fees.length === 0 ? "no snapshot" : `${fees.length} members, ${formatNear(fees.reduce((a, b) => (a < b ? a : b)), 5)} to ${formatNear(fees.reduce((a, b) => (a > b ? a : b)), 5)} NEAR each`);

  return { pool, rows, checks, ok: checks.every((c) => c.pass) };
}
