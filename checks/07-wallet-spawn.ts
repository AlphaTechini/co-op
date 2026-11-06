/**
 * Check 07: rooms, wallet spawn and withdraw against a running Co-op server on testnet.
 * Signs exactly what the web app asks a wallet to sign (web/src/lib/agent-txs.ts, MyAgents.svelte),
 * from a testnet account given on the command line:
 *
 *   pnpm --filter @coop/checks exec tsx 07-wallet-spawn.ts --api https://<server> --account you.testnet
 *
 * The key comes from CHECK_WALLET_PRIVATE_KEY, or else from the NEAR CLI keychain
 * (~/.near-credentials/testnet/<account>.json). It spends about 0.8 NEAR of testnet funds and takes about
 * 12 minutes, because it waits for the room's pool to settle before withdrawing.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PublicKey, actions, type Account } from "near-api-js";
import { accountFromKey, createProvider } from "@coop/agents/chain";
import { explorerTxUrl, loadEnv, networkConfig } from "@coop/agents/config";
import { formatNear, parseNear } from "@coop/agents/money";
import { Report, errorText, flagValue } from "./lib.js";

loadEnv();
const report = new Report("07 rooms, wallet spawn and withdraw (testnet)");
const config = networkConfig("testnet");
const provider = createProvider(config.rpcUrls);
const api = (flagValue("api") ?? process.env.COOP_API_URL ?? "").replace(/\/+$/, "");
const owner = flagValue("account") ?? process.env.CHECK_WALLET_ACCOUNT_ID ?? "";
const link = (hash: string) => explorerTxUrl(config, hash) ?? hash;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Json = Record<string, any>;

async function http(method: "GET" | "POST", path: string, body?: unknown, retrySafe = method === "GET"): Promise<{ status: number; json: Json }> {
  // Reads (and calls that are safe to repeat) retry on network errors; creating calls fail fast instead.
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${api}${path}`, {
        method,
        headers: body ? { "content-type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(60_000),
      });
      return { status: res.status, json: (await res.json()) as Json };
    } catch (e) {
      if (!retrySafe || attempt >= 4) throw e;
      await sleep(2000 * attempt);
    }
  }
}

function walletKey(): string | null {
  if (process.env.CHECK_WALLET_PRIVATE_KEY) return process.env.CHECK_WALLET_PRIVATE_KEY;
  const file = join(homedir(), ".near-credentials", "testnet", `${owner}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { private_key: string }).private_key : null;
}

async function view<T>(contractId: string, method: string, args: Json): Promise<T> {
  return (await provider.callFunction({ contractId, method, args })) as T;
}

async function send(wallet: Account, receiverId: string, acts: ReturnType<typeof actions.transfer>[]): Promise<string> {
  const outcome = (await wallet.signAndSendTransaction({ receiverId, actions: acts })) as { transaction: { hash: string } };
  return outcome.transaction.hash;
}

async function main(): Promise<void> {
  if (!api || !owner) {
    report.fail("inputs", "pass --api <server url> and --account <testnet account>");
    return;
  }
  const secret = walletKey();
  if (!secret) {
    report.fail("wallet key", `set CHECK_WALLET_PRIVATE_KEY or create ${owner} with the NEAR CLI legacy keychain`);
    return;
  }
  const wallet = accountFromKey(owner, provider, secret);

  // 1. server config
  const cfg = (await http("GET", "/api/config")).json;
  const coop = cfg.contractId as string;
  const item = cfg.rooms?.catalog?.[0]?.key as string | undefined;
  if (!report.expect(!!cfg.rooms?.canCreate && !!cfg.walletSpawn && !!item, "server offers rooms and wallet spawn", `contract ${coop}, items: ${(cfg.rooms?.catalog ?? []).map((i: Json) => i.key).join(", ")}`)) return;

  // 2. an invite room
  const created = await http("POST", "/api/rooms", { item, purpose: "Check 07: two agents from one wallet, then withdraw what is left", duration_min: 10, host: owner });
  if (!report.expect(created.status === 200 && /^[A-Z0-9]{6}$/.test(created.json.code ?? ""), "open an invite room", created.status === 200 ? `room ${created.json.code}, pool ${created.json.pool_id} (${created.json.title})` : `${created.status} ${created.json.error}`)) return;
  const code = created.json.code as string;
  const poolId = created.json.pool_id as number;
  const listed = ((await http("GET", "/api/rooms")).json as unknown as Json[]).find((r) => r.pool_id === poolId);
  report.expect(!!listed && listed.code === null, "the room list shows the invite room without its code", listed ? `visibility ${listed.visibility}, code ${listed.code}` : "not listed");
  const byCode = (await http("GET", `/api/rooms/${code}`)).json;
  report.expect(byCode.pool_id === poolId, "the code finds the room", `pool ${byCode.pool_id}`);

  // 3. prepare two agents
  const name = `c7${Date.now().toString(36).slice(-6)}`;
  const prep = await http("POST", "/api/wallet-agents/prepare", { owner, room_code: code, name, count: 2, brief: "buy 4 credits now, up to 0.05 each", total_near: 0.5 });
  if (!report.expect(prep.status === 200, "server prepares two agents", prep.status === 200 ? `${prep.json.agents.map((a: Json) => a.agent_id).join(", ")}; budget ${formatNear(BigInt(prep.json.budget_yocto), 4)} and gas ${formatNear(BigInt(prep.json.gas_yocto), 4)} NEAR each` : `${prep.status} ${prep.json.error}`)) return;
  const agents = prep.json.agents as Array<{ agent_id: string; fc_public_key: string }>;

  // 4. the wallet transactions the web app builds
  for (const a of agents) {
    const created = await send(wallet, a.agent_id, [
      actions.createAccount(),
      actions.transfer(BigInt(prep.json.gas_yocto)),
      actions.addFunctionCallAccessKey(PublicKey.fromString(a.fc_public_key), prep.json.contract_id, prep.json.methods, undefined),
    ]);
    const registered = await send(wallet, prep.json.contract_id, [
      actions.functionCall("register_agent", { agent_id: a.agent_id, limits: prep.json.limits }, BigInt(prep.json.register_gas), BigInt(prep.json.budget_yocto)),
    ]);
    report.pass(`wallet creates and registers ${a.agent_id}`, `create ${link(created)} ; register ${link(registered)}`);
  }

  // 5. activation and ownership
  const ids = agents.map((a) => a.agent_id);
  let states: Json[] = [];
  for (let i = 0; i < 20; i++) {
    states = (await http("POST", "/api/wallet-agents/activate", { owner, agent_ids: ids }, true)).json.agents ?? [];
    if (states.length === ids.length && states.every((s) => s.state === "running")) break;
    await sleep(3000);
  }
  report.expect(states.length === ids.length && states.every((s) => s.state === "running"), "server starts both agents once the chain shows them", states.map((s) => `${s.agent_id}=${s.state}`).join(", "));
  const views = await Promise.all(ids.map((id) => view<Json | null>(coop, "get_agent", { agent_id: id })));
  report.expect(views.every((v) => v?.owner === owner), "the contract records the wallet as owner", views.map((v, i) => `${ids[i]} owner ${v?.owner}`).join(", "));

  // 6. the agents join only the room's pool
  let joined: Json[] = [];
  for (let i = 0; i < 30; i++) {
    const feed = (await http("GET", `/api/activity?pool_id=${poolId}&limit=100`)).json as unknown as Json[];
    joined = feed.filter((e) => e.kind === "pool_joined" && ids.includes(e.agent_id));
    if (joined.length === ids.length) break;
    await sleep(4000);
  }
  report.expect(joined.length === ids.length, `both agents join the room's pool ${poolId}`, joined.map((e) => `${e.agent_id} ${link(e.tx?.hash ?? "")}`).join(" ; "));
  const after = await Promise.all(ids.map((id) => view<Json | null>(coop, "get_agent", { agent_id: id })));
  report.expect(after.every((v) => JSON.stringify(v?.active_pools) === JSON.stringify([poolId])), "and no other pool", after.map((v, i) => `${ids[i]} active_pools ${JSON.stringify(v?.active_pools)}`).join(", "));

  // 7. a refusal: withdrawing from an agent this wallet does not own
  const all = await view<Json[]>(coop, "list_agents", { from_index: 0, limit: 100 });
  const foreign = all.find((a) => a.owner !== owner);
  if (foreign) {
    try {
      const hash = await send(wallet, coop, [actions.functionCall("withdraw", { agent_id: foreign.agent_id }, 30_000_000_000_000n, 1n)]);
      report.fail("withdraw from someone else's agent is refused", `it went through: ${link(hash)}`);
    } catch (e) {
      const text = errorText(e);
      report.expect(/Only the agent's owner/.test(text), "withdraw from someone else's agent is refused", `${foreign.agent_id} (owner ${foreign.owner}): ${text.slice(0, 140)}`);
    }
  } else {
    report.skip("withdraw from someone else's agent is refused", "no agent with another owner on this contract");
  }

  // 8. settlement (the server's settler runs it after the deadline)
  const deadlineMs = Number(BigInt((await view<Json>(coop, "get_pool", { pool_id: poolId })).offer.deadline_ns) / 1_000_000n);
  console.log(`waiting for pool ${poolId} to settle (deadline ${new Date(deadlineMs).toISOString()})`);
  let pool: Json = {};
  const giveUpAt = deadlineMs + 300_000;
  while (Date.now() < giveUpAt) {
    pool = await view<Json>(coop, "get_pool", { pool_id: poolId });
    if (pool.status === "Settled" || pool.status === "Refunded") break;
    await sleep(15_000);
  }
  report.expect(pool.status === "Settled" || pool.status === "Refunded", `pool ${poolId} settles after its deadline`, pool.result ? `${pool.status}: ${pool.result.units} units from ${pool.result.members_in} agents at ${pool.result.unit_price ? formatNear(BigInt(pool.result.unit_price), 4) : "-"} NEAR each` : `status ${pool.status}`);

  // 9. the owner withdraws the free budget
  const settled = await Promise.all(ids.map((id) => view<Json>(coop, "get_agent", { agent_id: id })));
  const free = settled.reduce((s, v) => s + BigInt(v.budget_available), 0n);
  const before = BigInt((await provider.viewAccount({ accountId: owner })).amount);
  const hashes: string[] = [];
  for (const id of ids) {
    hashes.push(await send(wallet, coop, [actions.functionCall("withdraw", { agent_id: id }, 30_000_000_000_000n, 1n)]));
  }
  const afterBalance = BigInt((await provider.viewAccount({ accountId: owner })).amount);
  const left = await Promise.all(ids.map((id) => view<Json>(coop, "get_agent", { agent_id: id })));
  report.expect(
    left.every((v) => v.budget_available === "0") && afterBalance > before,
    "owner withdraws the free budget to the wallet",
    `free ${formatNear(free, 4)} NEAR; wallet ${formatNear(before, 4)} -> ${formatNear(afterBalance, 4)} NEAR (after gas); ${hashes.map(link).join(" ; ")}`,
  );
  if (free < parseNear("0.0001")) report.fail("there was budget to withdraw", "nothing was free after settlement");
}

main()
  .catch((e: unknown) => report.fail("check ran to the end", errorText(e)))
  .finally(() => process.exit(report.finish("check-07-wallet-spawn.txt")));
