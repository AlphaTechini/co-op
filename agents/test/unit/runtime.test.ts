import { describe, expect, it } from "vitest";
import type { Account } from "near-api-js";
import type { CoopClient } from "../../src/chain.js";
import { parseNear } from "../../src/money.js";
import { limitsFromPolicy } from "../../src/policy.js";
import { AgentRuntime } from "../../src/runtime.js";
import type { AgentView, Policy, PoolView, TxRef } from "../../src/types.js";

const near = (s: string) => parseNear(s).toString();
const policy: Policy = { archetype: "eager", units: 2, max_unit_price: near("1") };

function pool(id: number, status: PoolView["status"] = "Open"): PoolView {
  return {
    id,
    offer: {
      id, seller: "s.near", item_token: "t.near", title: `offer ${id}`, description: "",
      tiers: [{ min_units: 1, unit_price: near("1") }], max_units: 10, unit_amount: "1", inventory_held: "10",
      deadline_ns: "0", lock_window_ns: "0", lock_at_ns: "0", status: "Open", created_at_ns: "0",
    },
    status, member_count: 0, units_unconditional: 0, units_conditional: 0,
    projected: { units: 0, members_in: 0, tier_index: null, unit_price: null }, result: null, settle_cursor: 0,
  };
}

const agentView = (id: string): AgentView => ({
  agent_id: id, owner: "o.near", budget_available: near("10"), budget_locked: "0",
  limits: limitsFromPolicy(policy), active_pools: [], registered_at_ns: "0",
});

const tx = (method: string): TxRef => ({ hash: "H", signer: "a", receiver: "c", method, gas_burnt: "1", events: [] });

/** A stand-in for the chain client: records calls, lets a test choose what fails. */
function fakeClient(options: { failJoinFor?: string; pools: PoolView[] }) {
  const joins: string[] = [];
  const client = {
    listPools: async () => options.pools,
    listAllAgents: async () => [agentView("good.o.near"), agentView("bad.o.near")],
    joinPool: async (account: Account) => {
      if (account.accountId === options.failJoinFor) throw new Error("Smart contract panicked: boom");
      joins.push(account.accountId);
      return tx("join_pool");
    },
    leavePool: async () => tx("leave_pool"),
    getPool: async () => null,
  } as unknown as CoopClient;
  return { client, joins };
}

const account = (id: string) => ({ accountId: id }) as unknown as Account;

describe("AgentRuntime (offline)", () => {
  it("turns a failing agent into an error entry, keeps going, and respects the retry cooldown", async () => {
    const { client, joins } = fakeClient({ failJoinFor: "bad.o.near", pools: [pool(1)] });
    const runtime = new AgentRuntime({ client, retryCooldownMs: 60_000 });
    runtime.addAgent({ id: "good.o.near", account: account("good.o.near"), policy });
    runtime.addAgent({ id: "bad.o.near", account: account("bad.o.near"), policy });
    const seen: string[] = [];
    runtime.onActivity((e) => seen.push(e.kind));

    await runtime.tick();
    await runtime.tick();

    expect(joins).toEqual(["good.o.near", "good.o.near"]); // the fake never records membership, so it retries
    const errors = runtime.getLog().filter((e) => e.kind === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ agent_id: "bad.o.near", pool_id: 1 });
    expect(errors[0]?.message).toContain("boom");
    expect(seen).toContain("pool_joined");
    expect(seen).toContain("offer_created");
  });

  it("logs a decision once per change, not once per poll", async () => {
    const { client } = fakeClient({ pools: [pool(1)] });
    const runtime = new AgentRuntime({ client });
    runtime.addAgent({ id: "good.o.near", account: account("good.o.near"), policy });
    await runtime.tick();
    await runtime.tick();
    await runtime.tick();
    expect(runtime.getLog().filter((e) => e.kind === "decision")).toHaveLength(1);
  });

  it("ignores pools that are not open and keeps the log bounded and newest-first", async () => {
    const { client, joins } = fakeClient({ pools: [pool(2, "Locked"), pool(1)] });
    const runtime = new AgentRuntime({ client, maxLog: 5 });
    runtime.addAgent({ id: "good.o.near", account: account("good.o.near"), policy });
    await runtime.tick();
    expect(joins).toHaveLength(1);
    for (let i = 0; i < 20; i++) runtime.emitActivity({ kind: "spawned", message: `n${i}` });
    const log = runtime.getLog({ limit: 100 });
    expect(log).toHaveLength(5);
    expect(log[0]?.message).toBe("n19");
    expect(new Set(log.map((e) => e.id)).size).toBe(5);
    expect(runtime.getLog({ poolId: 1 })).toHaveLength(0);
  });
});
