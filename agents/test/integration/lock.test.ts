import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicKeyOf } from "../../src/deploy.js";
import { lockAccount } from "../../src/lock.js";
import { createSandboxWorld, type World } from "../../src/world.js";
import { agent, eagerPolicy, offer } from "./fixture.js";

let world: World;
beforeAll(async () => {
  world = await createSandboxWorld();
});
afterAll(async () => {
  await world?.stop();
});

describe("lock-contract (the code path testnet uses)", () => {
  it("dry run changes nothing; locking leaves no keys and the contract keeps working", async () => {
    const publicKey = publicKeyOf(world.operatorSecret);
    const dry = await lockAccount(world.client, world.coopId, world.operatorSecret, publicKey, { dryRun: true });
    expect(dry.tx).toBeNull();
    expect(dry.keysBefore).toEqual([{ publicKey, kind: "FullAccess" }]);

    const a = await agent(world, "lk-", eagerPolicy(1));
    const posted = await offer(world, { durationMs: 30_000, lockWindowMs: 6_000 });

    const locked = await lockAccount(world.client, world.coopId, world.operatorSecret, publicKey, { dryRun: false });
    expect(locked.tx?.method).toBe("delete_keys");
    expect(locked.keysAfter).toEqual([]);
    expect(locked.codeHashAfter).toBe(locked.codeHashBefore);

    // Nobody can redeploy or sign for the contract account any more ...
    const { accountFromKey } = await import("../../src/chain.js");
    const coopAccount = accountFromKey(world.coopId, world.provider, world.operatorSecret);
    await expect(coopAccount.deployContract(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]))).rejects.toThrow();

    // ... while the contract itself keeps serving agents.
    await world.client.joinPool(a.account, posted.offerId, 1, null, "after lock");
    expect((await world.client.getPool(posted.offerId))?.member_count).toBe(1);

    // Locking twice is a no-op.
    const again = await lockAccount(world.client, world.coopId, world.operatorSecret, publicKey, { dryRun: false });
    expect(again.tx).toBeNull();
  });
});
