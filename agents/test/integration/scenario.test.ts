import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { takeSnapshot, verifyPool } from "../../src/verify.js";
import { runScenario } from "../../src/scenario.js";
import { createSandboxWorld, type World } from "../../src/world.js";
import { agent, eagerPolicy, near, offer } from "./fixture.js";

let world: World;
beforeAll(async () => {
  world = await createSandboxWorld();
});
afterAll(async () => {
  await world?.stop();
});

describe("scenario through the real runtime", () => {
  it("12 agents: tier 2 is reached, tier 3 is not, and every invariant holds", async () => {
    const result = await runScenario(world, { agents: 12, durationMs: 40_000, lockWindowMs: 8_000, log: () => undefined });
    expect(result.checks.filter((c) => !c.pass)).toEqual([]);
    expect(result.ok).toBe(true);
    const pool = result.verification.pool;
    expect(pool.status).toBe("Settled");
    expect(pool.result?.tier_index).toBe(1);
    expect(pool.member_count).toBe(12);
    const outcomes = result.verification.rows.map((r) => r.member.outcome);
    expect(outcomes.filter((o) => o === "Excluded")).toHaveLength(2); // the two bargain-50 agents
    // Every member is charged the same tier price and no more than its limit.
    for (const r of result.verification.rows) {
      if (r.member.outcome === "Filled") expect(r.paid).toBe(BigInt(r.member.units) * BigInt(pool.result?.unit_price ?? "0"));
      else expect(r.refunded).toBe(r.locked);
    }
    expect(result.receipt).toContain("ALL INVARIANTS HOLD");
  });

  it("refund path: no tier reached means every lock comes back and the seller is not paid", async () => {
    const ladder = [
      { min_units: 10, unit_price: near("1") },
      { min_units: 20, unit_price: near("0.7") },
    ];
    const agents = await Promise.all([1, 2, 3].map((i) => agent(world, `rf${i}-`, eagerPolicy(2))));
    const snapshot = await takeSnapshot(world.client, agents.map((a) => a.id), world.operator.accountId);
    const posted = await offer(world, { tiers: ladder, maxUnits: 30, durationMs: 14_000, lockWindowMs: 4_000 });
    await Promise.all(agents.map((a) => world.client.joinPool(a.account, posted.offerId, 2, null, "refund test")));
    const pool = await world.client.getPool(posted.offerId);
    expect(pool?.projected.tier_index).toBeNull();

    const { txs, progress } = await world.client.settle(world.operator, posted.offerId, { waitForDeadline: true });
    expect(progress.status).toBe("Refunded");
    const v = await verifyPool(world.client, posted.offerId, snapshot, txs);
    expect(v.checks.filter((c) => !c.pass)).toEqual([]);
    expect(v.pool.result).toMatchObject({ units: 0, members_in: 0, tier_index: null, seller_payout: "0" });
    for (const r of v.rows) {
      expect(r.member.outcome).toBe("Refunded");
      expect(r.paid).toBe(0n);
      expect(r.refunded).toBe(r.locked);
      expect(r.tokens).toBe(0n);
    }
    const events = txs.flatMap((t) => t.events.map((e) => e.event));
    expect(events).toContain("pool_refunded");
    expect(events).not.toContain("seller_paid");
  });
});
