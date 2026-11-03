import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CoopTxError } from "../../src/chain.js";
import { parseNear } from "../../src/money.js";
import { createSandboxWorld, type World } from "../../src/world.js";
import { agent, agentWithKeyMethods, eagerPolicy, offer } from "./fixture.js";

let world: World;
beforeAll(async () => {
  world = await createSandboxWorld();
});
afterAll(async () => {
  await world?.stop();
});

async function failure(promise: Promise<unknown>): Promise<CoopTxError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(CoopTxError);
    return e as CoopTxError;
  }
  throw new Error("expected the call to fail");
}

describe("function-call key", () => {
  it("joins with zero deposit, and cannot do anything else", async () => {
    const a = await agent(world, "fc-", eagerPolicy(2));
    const posted = await offer(world, { durationMs: 40_000, lockWindowMs: 6_000 });

    // join_pool works with the function-call key and no deposit
    const tx = await world.client.joinPool(a.account, posted.offerId, 2, null, "fc key join");
    expect(tx.events.map((e) => e.event)).toEqual(["pool_joined"]);
    expect((await world.client.getAgent(a.id))?.active_pools).toEqual([posted.offerId]);

    // withdraw needs 1 yocto, which a function-call key can never attach ...
    const withdraw = await failure(world.client.withdraw(a.account, a.id));
    expect(withdraw.message).toMatch(/Deposit is not allowed with function call|DepositWithFunctionCall/i);
    // ... and it is not in the key's method list either (zero-deposit attempt)
    const noDeposit = await failure(world.client.callTx(a.account, { method: "withdraw", args: { agent_id: a.id, amount: null } }));
    expect(noDeposit.message).toMatch(/MethodNameMismatch|does not allow method/i);

    // fund_agent, update_limits: same
    await failure(world.client.fundAgent(a.account, a.id, 1n));

    // a deposit is never allowed with a function-call key (even on an allowed method)
    const deposit = await failure(world.client.callTx(a.account, { method: "leave_pool", args: { pool_id: posted.offerId }, deposit: 1n }));
    expect(deposit.message).toMatch(/Deposit is not allowed with function call|DepositWithFunctionCall/i);

    // another contract is out of reach
    const other = await failure(
      world.client.callTx(a.account, { receiver: world.tokenId, method: "ft_transfer", args: { receiver_id: world.operator.accountId, amount: "1" }, deposit: 0n }),
    );
    expect(other.message).toMatch(/receiver|does not allow|not allowed/i);

    // it cannot move NEAR
    await expect(a.account.transfer({ receiverId: world.operator.accountId, amount: parseNear("0.01") })).rejects.toThrow();

    // the budget is untouched by all of that
    const view = await world.client.getAgent(a.id);
    expect(BigInt(view?.budget_locked ?? "0")).toBeGreaterThan(0n);
  });

  it("can leave before lock and not after", async () => {
    const a = await agent(world, "lv-", eagerPolicy(2));
    const posted = await offer(world, { durationMs: 16_000, lockWindowMs: 7_000 });
    const before = await world.client.getAgent(a.id);
    await world.client.joinPool(a.account, posted.offerId, 2, null, "will leave");
    const leave = await world.client.leavePool(a.account, posted.offerId);
    expect(leave.events.map((e) => e.event)).toEqual(["pool_left"]);

    const after = await world.client.getAgent(a.id);
    expect(after?.budget_available).toBe(before?.budget_available); // lock and membership storage fully returned
    expect(after?.budget_locked).toBe("0");
    expect(after?.active_pools).toEqual([]);
    expect((await world.client.getPool(posted.offerId))?.member_count).toBe(0);

    // rejoin, then let the lock time pass: leaving is refused
    await world.client.joinPool(a.account, posted.offerId, 2, null, "rejoin");
    await world.client.waitForChainTime(BigInt(posted.lockAtNs) + 500_000_000n);
    const late = await failure(world.client.leavePool(a.account, posted.offerId));
    expect(late.message).toContain("Pool is locked");
    const lateJoin = await agent(world, "lj-", eagerPolicy(1));
    expect((await failure(world.client.joinPool(lateJoin.account, posted.offerId, 1, null, "late"))).message).toContain("Pool is locked");
  });

  it("a key without join_pool in its list cannot join (the runtime-facing guarantee)", async () => {
    const a = await agentWithKeyMethods(world, "nk-", eagerPolicy(1), ["leave_pool"]);
    const posted = await offer(world, { durationMs: 20_000, lockWindowMs: 6_000 });
    const e = await failure(world.client.joinPool(a.account, posted.offerId, 1, null, "no"));
    expect(e.message).toMatch(/MethodNameMismatch|does not allow method/i);
  });
});

describe("settle", () => {
  it("is refused before the deadline and idempotent after", async () => {
    const a = await agent(world, "id-", eagerPolicy(3));
    const posted = await offer(world, { tiers: [{ min_units: 1, unit_price: parseNear("1").toString() }], maxUnits: 10, durationMs: 13_000, lockWindowMs: 4_000 });
    await world.client.joinPool(a.account, posted.offerId, 3, null, "idempotent");

    const early = await failure(world.client.settleOnce(world.operator, posted.offerId));
    expect(early.message).toContain("Deadline has not passed");

    const first = await world.client.settle(world.operator, posted.offerId, { waitForDeadline: true });
    expect(first.progress.status).toBe("Settled");
    const poolAfter = await world.client.getPool(posted.offerId);
    const agentAfter = await world.client.getAgent(a.id);
    const tokens = await world.client.ftBalanceOf(a.id);
    const stats = await world.client.getStats();
    expect(tokens).toBe(3n);

    // settling again changes nothing and emits nothing
    const again = await world.client.settleOnce(world.operator, posted.offerId);
    expect(again.value.status).toBe("Settled");
    expect(again.tx.events).toEqual([]);
    expect(await world.client.getPool(posted.offerId)).toEqual(poolAfter);
    expect(await world.client.getAgent(a.id)).toEqual(agentAfter);
    expect(await world.client.ftBalanceOf(a.id)).toBe(tokens);
    expect(await world.client.getStats()).toEqual(stats);
  });
});
