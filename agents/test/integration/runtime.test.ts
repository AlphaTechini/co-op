import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentRuntime } from "../../src/runtime.js";
import type { Policy } from "../../src/types.js";
import { createSandboxWorld, type World } from "../../src/world.js";
import { agent, agentWithKeyMethods, eagerPolicy, near, offer } from "./fixture.js";

// The runtime watches every open pool, so each test gets a fresh chain.
let world: World;
beforeEach(async () => {
  world = await createSandboxWorld();
});
afterEach(async () => {
  await world?.stop();
});

describe("runtime", () => {
  it("switcher leaves the dearer pool for the cheaper one before lock", async () => {
    const sw: Policy = { archetype: "switcher", units: 2, max_unit_price: near("1") };
    const s = await agent(world, "sw-", sw);
    const fillers = await Promise.all([1, 2].map((i) => agent(world, `fl${i}-`, eagerPolicy(10), "30")));
    const runtime = new AgentRuntime({ client: world.client, pollMs: 200 });

    const poolA = await offer(world, { title: "Pool A", durationMs: 45_000, lockWindowMs: 10_000 });
    runtime.addAgent({ id: s.id, account: s.account, policy: sw });
    await runtime.tick(); // joins A (the only pool, projected price 1.00)
    expect((await world.client.getAgent(s.id))?.active_pools).toEqual([poolA.offerId]);

    const poolB = await offer(world, { title: "Pool B", durationMs: 45_000, lockWindowMs: 10_000 });
    for (const f of fillers) await world.client.joinPool(f.account, poolB.offerId, 10, null, "filler"); // B reaches 20 units: 0.70
    expect((await world.client.getPool(poolB.offerId))?.projected.unit_price).toBe(near("0.7"));

    await runtime.tick(); // leaves A
    expect((await world.client.getAgent(s.id))?.active_pools).toEqual([]);
    await runtime.tick(); // joins B
    expect((await world.client.getAgent(s.id))?.active_pools).toEqual([poolB.offerId]);
    const kinds = runtime.getLog({ limit: 100 }).map((e) => e.kind);
    expect(kinds).toContain("pool_left");
    expect(kinds.filter((k) => k === "pool_joined")).toHaveLength(2);
  });

  it("turns a failing agent into error entries and keeps serving the others", async () => {
    // This agent's function-call key may only call leave_pool, so every join attempt is rejected by the chain.
    const policy = eagerPolicy(1);
    const broken = await agentWithKeyMethods(world, "bk-", policy, ["leave_pool"]);
    const good = await agent(world, "gd-", policy);
    const posted = await offer(world, { durationMs: 30_000, lockWindowMs: 6_000 });
    const runtime = new AgentRuntime({ client: world.client, pollMs: 200, retryCooldownMs: 60_000 });
    runtime.addAgent({ id: broken.id, account: broken.account, policy });
    runtime.addAgent({ id: good.id, account: good.account, policy });
    await runtime.tick();
    await runtime.tick();

    const log = runtime.getLog({ limit: 100 });
    const errors = log.filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1); // cooldown stops the retry storm
    expect(errors[0]?.agent_id).toBe(broken.id);
    expect(errors[0]?.message).toContain("join_pool");
    expect((await world.client.getAgent(good.id))?.active_pools).toEqual([posted.offerId]);
    expect(log.some((e) => e.kind === "pool_joined" && e.agent_id === good.id && e.tx?.hash)).toBe(true);
  });
});
