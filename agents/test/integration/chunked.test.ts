import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseNear } from "../../src/money.js";
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
