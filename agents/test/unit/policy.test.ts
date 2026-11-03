import { describe, expect, it } from "vitest";
import { decide, limitsFromPolicy, clampMemo, MAX_MEMO_CHARS } from "../../src/policy.js";
import { parseNear } from "../../src/money.js";
import type { AgentView, Policy, PoolView, Tier } from "../../src/types.js";

const near = (s: string) => parseNear(s).toString();
const tiers: Tier[] = [
  { min_units: 1, unit_price: near("1") },
  { min_units: 20, unit_price: near("0.7") },
  { min_units: 50, unit_price: near("0.5") },
];

function pool(over: Partial<PoolView> & { id?: number; token?: string; tiers?: Tier[]; seller?: string; price?: string | null } = {}): PoolView {
  const id = over.id ?? 1;
  return {
    id,
    offer: {
      id,
      seller: over.seller ?? "seller.near",
      item_token: over.token ?? "credits.near",
      title: "x",
      description: "",
      tiers: over.tiers ?? tiers,
      max_units: 60,
      unit_amount: "1",
      inventory_held: "60",
      deadline_ns: "0",
      lock_window_ns: "0",
      lock_at_ns: "0",
      status: "Open",
      created_at_ns: "0",
    },
    status: "Open",
    member_count: 0,
    units_unconditional: 0,
    units_conditional: 0,
    projected: { units: 0, members_in: 0, tier_index: null, unit_price: over.price ?? null },
    result: null,
    settle_cursor: 0,
    ...("status" in over ? { status: over.status } : {}),
    ...("member_count" in over ? { member_count: over.member_count } : {}),
    ...("units_unconditional" in over ? { units_unconditional: over.units_unconditional } : {}),
    ...("units_conditional" in over ? { units_conditional: over.units_conditional } : {}),
  } as PoolView;
}

function agent(policy: Policy, over: Partial<AgentView> = {}): AgentView {
  return {
    agent_id: "a.near",
    owner: "near",
    budget_available: near("50"),
    budget_locked: "0",
    limits: limitsFromPolicy(policy),
    active_pools: [],
    registered_at_ns: "0",
    ...over,
  };
}

const eager = (units = 3, max = "1"): Policy => ({ archetype: "eager", units, max_unit_price: near(max) });
const bargain = (units: number, max: string, target?: string): Policy => ({
  archetype: "bargain",
  units,
  max_unit_price: near(max),
  ...(target ? { target_price: near(target) } : {}),
});

describe("eager", () => {
  it("joins unconditionally when the entry price is within the limit", () => {
    const p = eager(3, "1");
    const d = decide(p, pool(), agent(p));
    expect(d).toEqual({ action: "join", units: 3, threshold_units: null, memo: "Entry price 1.00 is within my 1.00 limit. Joining now." });
  });

  it("skips when the entry price is above the limit", () => {
    const p = eager(3, "0.9");
    const d = decide(p, pool(), agent(p));
    expect(d.action).toBe("skip");
  });

  it("uses the on-chain limit when it is stricter than the policy", () => {
    const p = eager(3, "1");
    const a = agent(p, { limits: { ...limitsFromPolicy(p), max_unit_price: near("0.8") } });
    expect(decide(p, pool(), a).action).toBe("skip");
  });
});

describe("bargain", () => {
  it("joins conditionally at the first tier within limit", () => {
    const p = bargain(2, "0.9", "0.7");
    const d = decide(p, pool(), agent(p));
    expect(d).toEqual({ action: "join", units: 2, threshold_units: 20, memo: "In if the group reaches 20. I only buy at 0.70 or less." });
  });

  it("waits for the deepest tier when that is the only one within limit", () => {
    const p = bargain(4, "0.55", "0.5");
    const d = decide(p, pool(), agent(p));
    expect(d).toMatchObject({ action: "join", units: 4, threshold_units: 50 });
  });

  it("without a target, the limit alone picks the tier", () => {
    const p = bargain(2, "0.75");
    expect(decide(p, pool(), agent(p))).toMatchObject({ action: "join", threshold_units: 20 });
  });

  it("skips when no tier is within the limit", () => {
    const p = bargain(2, "0.4", "0.4");
    expect(decide(p, pool(), agent(p)).action).toBe("skip");
  });

  it("has no condition when its own units already satisfy the threshold", () => {
    const p = bargain(2, "1.2");
    const t: Tier[] = [{ min_units: 2, unit_price: near("1") }, { min_units: 10, unit_price: near("0.5") }];
    expect(decide(p, pool({ tiers: t }), agent(p))).toMatchObject({ action: "join", threshold_units: null });
  });
});

describe("constraints", () => {
  it("never asks for more than max_units_per_pool, pool capacity or budget", () => {
    const p = eager(10, "1");
    const a = agent(p, { limits: { ...limitsFromPolicy(p), max_units_per_pool: 4 } });
    expect(decide(p, pool(), a)).toMatchObject({ units: 4 });
    expect(decide(p, pool({ units_unconditional: 57 }), agent(p))).toMatchObject({ units: 3 });
    const poor = agent(p, { budget_available: near("2.5") });
    // 2 units: 2 + 0.00125 + 0.02 headroom <= 2.5 ; 3 would not fit
    expect(decide(p, pool(), poor)).toMatchObject({ units: 2 });
    expect(decide(p, pool(), agent(p, { budget_available: near("0.5") })).action).toBe("skip");
  });

  it("skips pools that are not open, full, or already joined", () => {
    const p = eager();
    expect(decide(p, pool({ status: "Locked" }), agent(p)).action).toBe("skip");
    expect(decide(p, pool({ member_count: 100 }), agent(p)).action).toBe("skip");
    expect(decide(p, pool({ id: 7 }), agent(p, { active_pools: [7] })).action).toBe("skip");
  });

  it("respects seller allow-lists (policy and on-chain) and expiry", () => {
    const p: Policy = { ...eager(), allowed_sellers: ["other.near"] };
    expect(decide(p, pool(), agent(p)).action).toBe("skip");
    const onChain = agent(eager(), { limits: { ...limitsFromPolicy(eager()), allowed_sellers: ["x.near"] } });
    expect(decide(eager(), pool(), onChain).action).toBe("skip");
    const expired = agent(eager(), { limits: { ...limitsFromPolicy(eager(), 5n) } });
    expect(decide(eager(), pool(), expired, [], { nowNs: 10n }).action).toBe("skip");
    expect(decide(eager(), pool(), expired, [], { nowNs: 1n }).action).toBe("join");
  });

  it("keeps memos short and free of em-dashes", () => {
    expect(clampMemo("a — b – c")).toBe("a , b , c");
    expect(clampMemo("x".repeat(300)).length).toBeLessThanOrEqual(MAX_MEMO_CHARS);
    const p = bargain(2, "0.9", "0.7");
    const d = decide(p, pool(), agent(p));
    expect(d.memo.length).toBeLessThanOrEqual(MAX_MEMO_CHARS);
    expect(d.memo).not.toMatch(/[–—]/);
  });
});

describe("switcher", () => {
  const sw: Policy = { archetype: "switcher", units: 2, max_unit_price: near("1") };

  it("leaves a pool when another open pool for the same item projects a lower price", () => {
    const here = pool({ id: 1, price: near("1") });
    const there = pool({ id: 2, price: near("0.7") });
    const a = agent(sw, { active_pools: [1] });
    const d = decide(sw, here, a, [here, there]);
    expect(d.action).toBe("leave");
    expect(d.memo).toContain("Pool 2");
  });

  it("stays when no other pool is cheaper, or the other pool sells a different item", () => {
    const here = pool({ id: 1, price: near("0.7") });
    const a = agent(sw, { active_pools: [1] });
    expect(decide(sw, here, a, [here, pool({ id: 2, price: near("0.7") })]).action).toBe("skip");
    expect(decide(sw, here, a, [here, pool({ id: 3, price: near("0.5"), token: "other.near" })]).action).toBe("skip");
  });

  it("joins the cheapest pool only, then does not double-join", () => {
    const p1 = pool({ id: 1, price: near("1") });
    const p2 = pool({ id: 2, price: near("0.7") });
    const a = agent(sw);
    expect(decide(sw, p1, a, [p1, p2]).action).toBe("skip");
    expect(decide(sw, p2, a, [p1, p2])).toMatchObject({ action: "join", threshold_units: null });
    expect(decide(sw, p1, agent(sw, { active_pools: [2] }), [p1, p2]).action).toBe("skip");
  });
});
