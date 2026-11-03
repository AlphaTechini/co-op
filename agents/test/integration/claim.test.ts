import { Account, actions } from "near-api-js";
import type { KeyPairString } from "near-api-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadWasm } from "../../src/deploy.js";
import { WASM_DIR } from "../../src/config.js";
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

const wasmPath = (name: string): string => `${WASM_DIR}/${name}`;

/** Replaces the code on the item-token account (its full-access key is the operator key); state is kept. */
async function redeploy(name: string): Promise<void> {
  const wasm = loadWasm(wasmPath(name));
  // The other wasm may be larger than the one funded at deploy time: top up the storage balance first.
  await world.operator.transfer({ receiverId: world.tokenId, amount: parseNear("5") });
  const tokenAccount = new Account(world.tokenId, world.provider, world.operatorSecret as KeyPairString);
  await tokenAccount.signAndSendTransaction({ receiverId: world.tokenId, actions: [actions.deployContract(wasm.bytes)] });
}

describe("failed delivery becomes a claimable balance, then a successful claim", () => {
  it("never loses the units when the token cannot be called, and pays them out on claim", async () => {
    const buyer = await agent(world, "cl-", eagerPolicy(2), "5");
    const snapshot = await takeSnapshot(world.client, [buyer.id], world.operator.accountId);
    const coopBefore = await world.client.ftBalanceOf(world.coopId);
    const sellerBefore = await world.client.ftBalanceOf(world.operator.accountId);
    const posted = await offer(world, { tiers: [{ min_units: 1, unit_price: near("1") }], maxUnits: 10, durationMs: 14_000, lockWindowMs: 4_000 });
    await world.client.joinPool(buyer.account, posted.offerId, 2, null, "delivery will fail");

    // The item token account now runs the Co-op wasm: no storage_deposit / ft_transfer, so every delivery batch fails.
    await redeploy("coop.wasm");

    const { txs } = await world.client.settle(world.operator, posted.offerId, { waitForDeadline: true });
    const members = await world.client.getAllPoolMembers(posted.offerId);
    expect(members.find((m) => m.agent_id === buyer.id)).toMatchObject({ outcome: "Filled", delivery: "Claimable" });
    const eventNames = txs.flatMap((t) => t.events.map((e) => e.event));
    expect(eventNames).toContain("delivery_failed");

    // Units (and the failed unsold-inventory return) stay held by the contract as claimable balances.
    expect(await world.client.getClaimable(buyer.id)).toEqual([{ token: world.tokenId, amount: "2" }]);
    expect(await world.client.getClaimable(world.operator.accountId)).toEqual([{ token: world.tokenId, amount: "8" }]);

    // Token works again (same state); the owner claims and receives the units.
    await redeploy("credits_token.wasm");
    // (verifyPool reads ft balances, so it runs once the real token code is back.)
    // Seller payout and refunds still happened: invariants hold.
    const v = await verifyPool(world.client, posted.offerId, snapshot, txs);
    expect(v.pool.status).toBe("Settled");
    // Only the two delivery-dependent checks fail while the units are still claimable; all money checks pass.
    expect(v.checks.filter((c) => !c.pass).map((c) => c.name).sort()).toEqual([
      "inventory fully accounted for (seller kept the unsold units)",
      "token balances match units delivered",
    ]);
    expect(await world.client.ftBalanceOf(world.coopId)).toBe(coopBefore + 10n);
    const claim = await world.client.claim(world.operator, buyer.id, world.tokenId);
    expect(claim.events.map((e) => e.event)).not.toContain("delivery_failed");
    expect(await world.client.getClaimable(buyer.id)).toEqual([]);
    expect(await world.client.ftBalanceOf(buyer.id)).toBe(2n);
    const after = await world.client.getAllPoolMembers(posted.offerId);
    expect(after.find((m) => m.agent_id === buyer.id)).toMatchObject({ outcome: "Filled", delivery: "Delivered" });

    // The seller claims the unsold inventory.
    await world.client.claim(world.operator, world.operator.accountId, world.tokenId);
    expect(await world.client.getClaimable(world.operator.accountId)).toEqual([]);
    expect(await world.client.ftBalanceOf(world.operator.accountId)).toBe(sellerBefore - 2n); // posted 10, 2 sold, 8 claimed back
    expect(await world.client.ftBalanceOf(world.coopId)).toBe(coopBefore);

    // With everything claimed, every invariant holds.
    const final = await verifyPool(world.client, posted.offerId, snapshot, txs);
    expect(final.checks.filter((c) => !c.pass)).toEqual([]);
  });
});
