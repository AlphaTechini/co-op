import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sleep } from "@coop/agents/chain";
import { createSandboxWorld, type World } from "@coop/agents/world";
import { chainFromWorld, createCoop, type Coop } from "../../src/node.js";
import { loadSettings } from "../../src/settings.js";
import { MemoryAgentStore } from "../../src/store.js";

let world: World;
let coop: Coop;
let base: string;

beforeAll(async () => {
  world = await createSandboxWorld();
  const settings = { ...loadSettings({ SELLER_LOOP: "1", RUNTIME_POLL_MS: "300" }, "sandbox"), port: 0, host: "127.0.0.1" };
  coop = await createCoop({ env: {}, settings, chain: chainFromWorld(world), store: new MemoryAgentStore() });
  await coop.app.listen({ port: 0, host: "127.0.0.1" });
  base = `http://127.0.0.1:${(coop.app.server.address() as AddressInfo).port}`;
  coop.start();
});

afterAll(async () => {
  await coop?.stop();
  await world?.stop();
});

async function waitFor<T>(fn: () => Promise<T | null | false>, timeoutMs = 60_000): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await sleep(300);
  }
}

describe("server against a real sandbox", () => {
  it("seller loop opens an offer, POST /api/agents spawns an agent that joins it, feed and config show it", async () => {
    // The seller loop posts an offer because no pool exists yet.
    const offerId = await waitFor(async () => {
      const pools = await world.client.listPools(0, 5);
      return pools.find((p) => p.status === "Open")?.id ?? null;
    });

    const cfg = (await (await fetch(`${base}/api/config`)).json()) as { contractId: string; spawn: { enabled: boolean; remaining: number } };
    expect(cfg.contractId).toBe(world.coopId);
    expect(cfg.spawn).toMatchObject({ enabled: true, remaining: 40 });

    const res = await fetch(`${base}/api/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "it-spawn", brief: "buy 1 credit now, at most 1.0", budget_near: 2 }),
    });
    const body = (await res.json()) as { agent_id: string; parser: string; policy: { archetype: string }; txs: Array<{ hash: string; method: string }> };
    expect(res.status).toBe(200);
    expect(body.agent_id).toBe(`it-spawn.${world.operator.accountId}`);
    expect(body.parser).toBe("rules");
    expect(body.txs.map((t) => t.method)).toEqual(["create_account", "add_key", "register_agent"]);
    expect(body.txs.every((t) => t.hash.length > 20)).toBe(true);

    // On chain: registered with the budget, and a member of the open pool.
    const view = await world.client.getAgent(body.agent_id);
    expect(view?.owner).toBe(world.operator.accountId);
    const member = await waitFor(async () => (await world.client.getPoolMembers(offerId)).find((m) => m.agent_id === body.agent_id) ?? null);
    expect(member.units).toBe(1);
    expect(member.owner).toBe(world.operator.accountId);

    // Feed and agent list.
    const agents = (await (await fetch(`${base}/api/agents`)).json()) as Array<{ agent_id: string; status: string }>;
    expect(agents.map((a) => a.agent_id)).toContain(body.agent_id);
    const feed = await waitFor(async () => {
      const rows = (await (await fetch(`${base}/api/activity?pool_id=${offerId}&limit=50`)).json()) as Array<{ kind: string; agent_id?: string; tx?: { hash: string } }>;
      return rows.some((r) => r.kind === "pool_joined" && r.agent_id === body.agent_id) ? rows : null;
    });
    expect(feed.find((r) => r.kind === "pool_joined")?.tx?.hash).toBeTruthy();
    const all = (await (await fetch(`${base}/api/activity?limit=100`)).json()) as Array<{ kind: string }>;
    expect(all.some((r) => r.kind === "spawned")).toBe(true);
    expect(all.some((r) => r.kind === "offer_created")).toBe(true);

    // The same name again is a 409 (real account lookup).
    const dup = await fetch(`${base}/api/agents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "it-spawn", brief: "buy 1 credit now, at most 1.0", budget_near: 2 }),
    });
    expect(dup.status).toBe(409);
  });
});
