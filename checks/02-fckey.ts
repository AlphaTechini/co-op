/**
 * PRD check 02: sub-account + function-call key with zero deposit, against the real Co-op contract.
 *
 *   tsx 02-fckey.ts                      # starts a local sandbox, deploys the committed wasm
 *   tsx 02-fckey.ts --network testnet    # uses OPERATOR_*, COOP_CONTRACT_ID, CREDITS_TOKEN_ID from .env
 *
 * Creates `<agent>.<operator>`, adds a key limited to join_pool / leave_pool on Co-op, registers the
 * agent with a budget, then proves what that key can and cannot do.
 */
import { CoopTxError, agentSigner } from "@coop/agents/chain";
import { loadEnv, parseNetwork } from "@coop/agents/config";
import { parseNear } from "@coop/agents/money";
import { limitsFromPolicy } from "@coop/agents/policy";
import { postOffer } from "@coop/agents/seller";
import { createSandboxWorld, provisionAgent, worldFromEnv, type World } from "@coop/agents/world";
import { Report, errorText, flagValue, hasFlag } from "./lib.js";

loadEnv();
const network = parseNetwork(flagValue("network") ?? process.env.CHECK_NETWORK, "sandbox");
const report = new Report(`02 function-call key joins with zero deposit (${network})`);

async function rejected(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof CoopTxError ? e.message.split("\n")[0] ?? e.message : errorText(e);
  }
}

const hashOf = (tx: { hash: string; explorer_url?: string }) => tx.explorer_url ?? tx.hash;

async function main(): Promise<void> {
  let world: World;
  try {
    world = network === "sandbox" ? await createSandboxWorld() : worldFromEnv(process.env, "testnet");
  } catch (e) {
    report.fail("environment", `${errorText(e)}${network === "testnet" ? " (needs OPERATOR_ACCOUNT_ID, OPERATOR_PRIVATE_KEY, COOP_CONTRACT_ID, CREDITS_TOKEN_ID in .env; run deploy:testnet first)" : ""}`);
    return;
  }
  const testnet = network === "testnet";
  try {
    const price = parseNear(testnet ? "0.01" : "1");
    const label = `fckey${testnet ? `-${Date.now().toString(36)}` : ""}`;
    const policy = { archetype: "eager" as const, units: 1, max_unit_price: price.toString() };

    // An offer for the agent to join (the inventory comes back at settlement).
    const posted = await postOffer(world.client, world.operator, world.tokenId, {
      title: "fc key check",
      description: "capability check 02",
      tiers: [{ min_units: 1, unit_price: price.toString() }],
      maxUnits: 2,
      durationMs: testnet ? 90_000 : 25_000,
      lockWindowMs: testnet ? 20_000 : 8_000,
    });
    report.pass("offer opened for the check", `offer ${posted.offerId}, tx ${hashOf(posted.txs[0]!)}`);

    // Sub-account + function-call key + registration.
    const agent = await provisionAgent(world, {
      label,
      limits: limitsFromPolicy(policy),
      budget: price * 3n,
      gasBalance: parseNear("0.3"),
    });
    const key = await world.provider.viewAccessKey({ accountId: agent.id, publicKey: (await keyOf(agent.fcSecret)) });
    report.pass(`sub-account ${agent.id} created, function-call key added`, `create tx ${hashOf(agent.txs[0]!)}, key permission ${JSON.stringify(key.permission)}`);
    const view = await world.client.getAgent(agent.id);
    report.expect(view?.owner === world.operator.accountId, "register_agent accepted the direct sub-account", `owner ${view?.owner}, budget ${view?.budget_available}`);

    // 1. join_pool with the fc key and zero deposit succeeds.
    try {
      const tx = await world.client.joinPool(agent.account, posted.offerId, 1, null, "check 02");
      report.pass("join_pool with the function-call key and 0 deposit succeeds", `${hashOf(tx)}, gas burnt ${(Number(tx.gas_burnt) / 1e12).toFixed(2)} Tgas, events ${tx.events.map((e) => e.event).join(",")}`);
    } catch (e) {
      report.fail("join_pool with the function-call key and 0 deposit succeeds", errorText(e));
    }

    // 2. Same key with 1 yocto: refused by the protocol.
    const withDeposit = await rejected(() => world.client.callTx(agent.account, { method: "leave_pool", args: { pool_id: posted.offerId }, deposit: 1n }));
    report.expect(withDeposit !== null && /Deposit is not allowed|DepositWithFunctionCall/i.test(withDeposit), "attaching 1 yocto with the key is rejected", withDeposit ?? "call unexpectedly succeeded");

    // 3. Owner-only methods are out of reach (they need 1 yocto, and are not in the key's method list).
    const withdraw = await rejected(() => world.client.callTx(agent.account, { method: "withdraw", args: { agent_id: agent.id, amount: null } }));
    report.expect(withdraw !== null && /does not allow method|MethodNameMismatch/i.test(withdraw), "withdraw with the key is rejected (method not allowed)", withdraw ?? "call unexpectedly succeeded");

    // 4. The key cannot move NEAR or touch another contract.
    const transfer = await rejected(() => agent.account.transfer({ receiverId: world.operator.accountId, amount: parseNear("0.001") }));
    report.expect(transfer !== null, "a plain NEAR transfer with the key is rejected", transfer ?? "transfer unexpectedly succeeded");
    const other = await rejected(() => world.client.callTx(agent.account, { receiver: world.tokenId, method: "ft_transfer", args: { receiver_id: world.operator.accountId, amount: "1" } }));
    report.expect(other !== null, "calling another contract with the key is rejected", other ?? "call unexpectedly succeeded");

    // 5. leave_pool works with the key, and the lock returns to the budget.
    try {
      const tx = await world.client.leavePool(agent.account, posted.offerId);
      const after = await world.client.getAgent(agent.id);
      report.expect(after?.budget_locked === "0", "leave_pool with the key returns the lock to the budget", `${hashOf(tx)}, budget_locked ${after?.budget_locked}`);
    } catch (e) {
      report.fail("leave_pool with the function-call key", errorText(e));
    }
    void agentSigner;

    // 6. Settle so the inventory returns to the seller (skip with --no-settle).
    if (!hasFlag("no-settle")) {
      const { progress, txs } = await world.client.settle(world.operator, posted.offerId, { waitForDeadline: true });
      report.expect(progress.status === "Refunded" || progress.status === "Settled", "pool settles after the deadline", `${progress.status}, ${txs.map((t) => hashOf(t)).join(" ")}`);
    }
  } finally {
    await world.stop();
  }
}

async function keyOf(secret: string): Promise<string> {
  const { KeyPair } = await import("near-api-js");
  return KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().toString();
}

await main().catch((e: unknown) => report.fail("unexpected error", errorText(e)));
process.exit(report.finish(`check-02-fckey-${network}.txt`));
