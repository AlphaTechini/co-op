import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CoopTxError } from "../../src/chain.js";
import { SellerAgent, isImprovement, proposeImprovement } from "../../src/seller.js";
import { createSandboxWorld, type World } from "../../src/world.js";
import { agent, eagerPolicy, LADDER, near, offer } from "./fixture.js";

let world: World;
beforeAll(async () => {
  world = await createSandboxWorld();
});
afterAll(async () => {
  await world?.stop();
});

describe("improve_offer", () => {
  it("accepts a better ladder, rejects a worse one, and the seller agent proposes valid improvements", async () => {
    const a = await agent(world, "ng-", eagerPolicy(10), "30");
    const b = await agent(world, "nh-", eagerPolicy(4), "30");
    const posted = await offer(world, { durationMs: 40_000, lockWindowMs: 20_000 });
    await world.client.joinPool(a.account, posted.offerId, 10, null, "x");
    await world.client.joinPool(b.account, posted.offerId, 4, null, "y");

    const pool = await world.client.getPool(posted.offerId);
    expect(pool?.projected).toMatchObject({ units: 14, tier_index: 0 });

    // worse for buyers (higher tier-0 price) is refused on chain
    const worse = LADDER.map((t, i) => (i === 0 ? { ...t, unit_price: near("1.1") } : t));
    await expect(world.client.improveOffer(world.operator, posted.offerId, worse)).rejects.toBeInstanceOf(CoopTxError);
    // dropping the 20-unit tier is also worse at totals of 20 to 49
    await expect(world.client.improveOffer(world.operator, posted.offerId, [LADDER[0]!, LADDER[2]!])).rejects.toThrow(/not be worse/);

    // the seller agent notices the pool is 6 units short of the 20 tier near lock and adds a tier
    const seller = new SellerAgent(world.client, world.operator, { withinMsOfLock: 60_000 });
    const proposal = proposeImprovement(pool!, BigInt(pool!.offer.lock_at_ns) - 5_000_000_000n, { withinMsOfLock: 60_000 });
    expect(proposal).not.toBeNull();
    expect(isImprovement(LADDER, proposal!, 60)).toBe(true);
    const done = await seller.tick([pool!]);
    expect(done).toHaveLength(1);
    const after = await world.client.getOffer(posted.offerId);
    expect(after?.tiers).toHaveLength(4);
    expect(after?.tiers.map((t) => t.min_units)).toEqual([1, 17, 20, 50]);
    expect(done[0]?.tx.events.map((e) => e.event)).toEqual(["offer_improved"]);
    // once per offer
    expect(await seller.tick([pool!])).toHaveLength(0);
  });
});

