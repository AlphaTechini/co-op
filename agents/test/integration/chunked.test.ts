import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accountFromKey } from "../../src/chain.js";
import { parseNear } from "../../src/money.js";
import { limitsFromPolicy } from "../../src/policy.js";
import { takeSnapshot, verifyPool } from "../../src/verify.js";
import { createSandboxWorld, type World } from "../../src/world.js";
import { agent, eagerPolicy, near, offer } from "./fixture.js";

let world: World;
beforeAll(async () => {
  world = await createSandboxWorld();
});
afterAll(async () => {
  await world?.stop();
});

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

describe("chunked settlement", () => {
  it("settles 21 members over several settle transactions and every invariant holds", async () => {
    const flat = [{ min_units: 1, unit_price: near("1") }, { min_units: 10, unit_price: near("0.8") }];
    const labels = Array.from({ length: 21 }, (_, i) => i);
    const agents: Awaited<ReturnType<typeof agent>>[] = [];
    await inBatches(labels, 9, async (i) => {
      agents.push(await agent(world, `ch${i}-`, eagerPolicy(1), "3"));
    });
    const snapshot = await takeSnapshot(world.client, agents.map((a) => a.id), world.operator.accountId);
    const posted = await offer(world, { tiers: flat, maxUnits: 30, durationMs: 30_000, lockWindowMs: 6_000 });
    await inBatches(agents, 9, (a) => world.client.joinPool(a.account, posted.offerId, 1, null, "chunk test"));
    expect((await world.client.getPool(posted.offerId))?.member_count).toBe(21);

    const progressSeen: number[] = [];
    const { txs, progress } = await world.client.settle(world.operator, posted.offerId, {
      waitForDeadline: true,
      onTx: (_tx, p) => progressSeen.push(p.processed),
    });
    expect(progress.status).toBe("Settled");
    expect(txs.length).toBeGreaterThanOrEqual(3); // DEFAULT_CHUNK=10 per call: 21 members need 3 calls
    expect(progressSeen[progressSeen.length - 1]).toBe(21);
    expect([...progressSeen].sort((a, b) => a - b)).toEqual(progressSeen); // cursor only moves forward

    const v = await verifyPool(world.client, posted.offerId, snapshot, txs);
    expect(v.checks.filter((c) => !c.pass)).toEqual([]);
    expect(v.pool.result).toMatchObject({ units: 21, members_in: 21, tier_index: 1 });
    expect(v.rows.every((r) => r.paid === parseNear("0.8"))).toBe(true);
  });
});

describe("failed delivery becomes a claimable balance", () => {
  it("never loses the units when ft_transfer fails", async () => {
    // The Co-op contract account registers itself as an agent. At settlement the contract would call
    // ft_transfer(coop -> coop), which the token rejects ("Sender and receiver should be different"):
    // a genuine delivery failure.
    const policy = eagerPolicy(2);
    const selfId = `coop.${world.operator.accountId}`;
    await world.client.registerAgent(world.operator, selfId, limitsFromPolicy(policy), parseNear("5"));
    const selfAgent = accountFromKey(selfId, world.provider, world.operatorSecret); // contract account shares the operator key
    const normal = await agent(world, "ok-", policy);

    const coopBefore = await world.client.ftBalanceOf(world.coopId);
    const posted = await offer(world, { tiers: [{ min_units: 1, unit_price: near("1") }], maxUnits: 10, durationMs: 14_000, lockWindowMs: 4_000 });
    await world.client.joinPool(selfAgent, posted.offerId, 2, null, "delivery will fail");
    await world.client.joinPool(normal.account, posted.offerId, 2, null, "delivery works");

    const { txs } = await world.client.settle(world.operator, posted.offerId, { waitForDeadline: true });
    const members = await world.client.getAllPoolMembers(posted.offerId);
    const byId = new Map(members.map((m) => [m.agent_id, m]));
    expect(byId.get(selfId)).toMatchObject({ outcome: "Filled", delivery: "Claimable" });
    expect(byId.get(normal.id)).toMatchObject({ outcome: "Filled", delivery: "Delivered" });
    expect(txs.flatMap((t) => t.events.map((e) => e.event))).toContain("delivery_failed");

    // The units are still held by the contract and recorded as claimable.
    expect(await world.client.getClaimable(selfId)).toEqual([{ token: world.tokenId, amount: "2" }]);
    // coop holds: what it held before + the two claimable units (the unsold 6 went back to the seller)
    expect(await world.client.ftBalanceOf(world.coopId)).toBe(coopBefore + 2n);
    expect(await world.client.ftBalanceOf(normal.id)).toBe(2n);

    // Retrying the delivery fails again for the same reason and the balance survives the retry.
    const claim = await world.client.claim(selfAgent, selfId, world.tokenId);
    expect(claim.events.map((e) => e.event)).toContain("delivery_failed");
    expect(await world.client.getClaimable(selfId)).toEqual([{ token: world.tokenId, amount: "2" }]);
    expect(await world.client.ftBalanceOf(world.coopId)).toBe(coopBefore + 2n);
  });
});
