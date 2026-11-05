/**
 * Scenario runner: N buyers with mixed archetypes against one tiered offer, run to settlement through the
 * real AgentRuntime, then recheck every invariant from chain views.
 *
 *   pnpm --filter @coop/agents scenario [--agents 12] [--network sandbox|testnet] [--out file.json]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { sleep } from "./chain.js";
import { EVIDENCE_DIR, REPO_ROOT, SANDBOX_DIR, loadEnv, parseNetwork, type NetworkName } from "./config.js";
import { formatNear, parseNear } from "./money.js";
import { renderReceipt } from "./receipt.js";
import { buildRoster, limitsFromPolicy, storyTiers, type RosterEntry } from "./roster.js";
import { AgentRuntime } from "./runtime.js";
import { postOffer } from "./seller.js";
import type { ActivityEntry, TxRef } from "./types.js";
import { takeSnapshot, verifyPool, type Check, type Verification } from "./verify.js";
import { createSandboxWorld, provisionAgent, worldFromEnv, type ProvisionedAgent, type World } from "./world.js";

export interface ScenarioOptions {
  agents: number;
  /** Time from offer creation to the deadline. */
  durationMs: number;
  lockWindowMs: number;
  /** Delay between agents arriving. 0 picks a value that fits the join window. */
  staggerMs: number;
  /** Price of the entry tier (yocto). Tiers are 100%, 70% and 50% of it. */
  topPrice: bigint;
  pollMs: number;
  log: (line: string) => void;
  /** Owner withdraws every leftover budget at the end and the amounts are checked. */
  withdraw: boolean;
  /** Label prefix for the agents (unique per round in the demo). */
  prefix: string;
  title: string;
  /** Reuse agents provisioned earlier (demo rounds). */
  provisioned?: Map<string, ProvisionedAgent>;
  /** Opt-in seller negotiation (P1). */
  sellerNegotiates: boolean;
}

export interface ScenarioResult {
  ok: boolean;
  offerId: number;
  roster: RosterEntry[];
  verification: Verification;
  checks: Check[];
  receipt: string;
  activity: ActivityEntry[];
  txs: Array<TxRef & { phase: string }>;
  startedAt: number;
  finishedAt: number;
}

export function defaultOptions(network: NetworkName): ScenarioOptions {
  const sandbox = network === "sandbox";
  return {
    agents: 12,
    durationMs: sandbox ? 45_000 : 300_000,
    lockWindowMs: sandbox ? 10_000 : 60_000,
    staggerMs: 0,
    topPrice: parseNear(sandbox ? "1" : "0.05"),
    pollMs: sandbox ? 500 : 3000,
    log: (line) => console.log(line),
    withdraw: true,
    prefix: "buyer",
    title: "Demo API credits (volume pricing)",
    sellerNegotiates: false,
  };
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Registers (and funds) every roster agent; reuses existing ones and tops their budget up. */
export async function provisionRoster(
  world: World,
  roster: RosterEntry[],
  existing: Map<string, ProvisionedAgent> | undefined,
  txs: Array<TxRef & { phase: string }>,
  batch: number,
): Promise<Map<string, ProvisionedAgent>> {
  const agents = existing ?? new Map<string, ProvisionedAgent>();
  await inBatches(roster, batch, async (entry) => {
    const known = agents.get(entry.label);
    if (known) {
      const view = await world.client.getAgent(known.id);
      const have = view ? BigInt(view.budget_available) : 0n;
      if (have < entry.budget) {
        txs.push({ ...(await world.client.fundAgent(world.operator, known.id, entry.budget - have)), phase: "top up budget" });
      }
      return;
    }
    const agent = await provisionAgent(world, {
      label: entry.label,
      limits: limitsFromPolicy(entry.policy),
      budget: entry.budget,
      gasBalance: parseNear("0.12"),
    });
    agents.set(entry.label, agent);
    for (const tx of agent.txs) txs.push({ ...tx, phase: "provision agents" });
  });
  return agents;
}

export async function runScenario(world: World, partial: Partial<ScenarioOptions> = {}): Promise<ScenarioResult> {
  const o: ScenarioOptions = { ...defaultOptions(world.network), ...partial };
  const startedAt = Date.now();
  const txs: Array<TxRef & { phase: string }> = world.setupTxs.map((t) => ({ ...t, phase: "deploy contracts" }));
  const roster = buildRoster(o.agents, o.topPrice, o.prefix);
  const tiers = storyTiers(o.topPrice);
  const t0 = Date.now();
  const stamp = (line: string) => o.log(`[+${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s] ${line}`);

  // Funding check up front: a half-funded run on testnet wastes the faucet.
  const need = roster.reduce((n, r) => n + r.budget + parseNear("0.12"), 0n) + parseNear("1");
  const balance = await world.client.accountBalance(world.operator.accountId);
  if (balance < need) {
    throw new Error(
      `Operator ${world.operator.accountId} has ${formatNear(balance, 3)} NEAR but this run needs about ${formatNear(need, 3)} NEAR. ` +
        `Lower --price or --agents, or top the operator up.`,
    );
  }

  stamp(`provisioning ${roster.length} agents (sub-accounts of ${world.operator.accountId}, function-call keys, budgets)`);
  const provisioned = await provisionRoster(world, roster, o.provisioned, txs, world.network === "sandbox" ? 8 : 4);
  const labels = new Map(roster.map((r) => [provisioned.get(r.label)?.id ?? r.label, r.label]));
  const agentIds = roster.map((r) => (provisioned.get(r.label) as ProvisionedAgent).id);

  const snapshot = await takeSnapshot(world.client, agentIds, world.operator.accountId);

  stamp("posting offer and depositing inventory");
  const posted = await postOffer(world.client, world.operator, world.tokenId, {
    title: o.title,
    description: "Demo seller. Tiers: 1+ at the entry price, 20+ at 70%, 50+ at 50%.",
    tiers,
    maxUnits: 60,
    durationMs: o.durationMs,
    lockWindowMs: o.lockWindowMs,
  });
  for (const tx of posted.txs) txs.push({ ...tx, phase: "offer" });
  stamp(`offer ${posted.offerId} open: lock in ${(o.durationMs - o.lockWindowMs) / 1000}s, deadline in ${o.durationMs / 1000}s`);

  const activity: ActivityEntry[] = [];
  const runtimeTxs: TxRef[] = [];
  const runtimeOptions: ConstructorParameters<typeof AgentRuntime>[0] = {
    client: world.client,
    pollMs: o.pollMs,
    settler: world.operator,
    onTx: (tx) => runtimeTxs.push(tx),
  };
  const runtime = new AgentRuntime(runtimeOptions);
  runtime.onActivity((entry) => {
    activity.push(entry);
    if (entry.kind === "decision" && entry.message.includes("skips")) return;
    stamp(`${entry.kind.padEnd(13)} ${entry.message}${entry.reason ? `  | "${entry.reason}"` : ""}`);
  });
  runtime.start();

  // Agents arrive one by one so the pool visibly fills.
  const joinWindowMs = Math.max(2000, o.durationMs - o.lockWindowMs - 10_000);
  const stagger = o.staggerMs > 0 ? o.staggerMs : Math.min(1500, Math.floor(joinWindowMs / roster.length));
  const timers: NodeJS.Timeout[] = [];
  roster.forEach((entry, i) => {
    const agent = provisioned.get(entry.label) as ProvisionedAgent;
    timers.push(
      setTimeout(() => runtime.addAgent({ id: agent.id, account: agent.account, policy: entry.policy, label: entry.label }), 1000 + i * stagger),
    );
  });

  // Wait for the runtime's settler to finish the pool.
  const giveUpAt = Date.now() + o.durationMs + 150_000;
  let lastPrint = 0;
  for (;;) {
    const pool = await world.client.getPool(posted.offerId);
    if (pool && (pool.status === "Settled" || pool.status === "Refunded")) break;
    if (Date.now() > giveUpAt) {
      timers.forEach(clearTimeout);
      await runtime.stop();
      throw new Error(`Pool ${posted.offerId} did not settle in time (status ${pool?.status ?? "missing"})`);
    }
    if (pool && Date.now() - lastPrint > 5000) {
      lastPrint = Date.now();
      const p = pool.projected;
      stamp(`pool ${pool.id} ${pool.status}: ${pool.member_count} members, ${pool.units_unconditional}+${pool.units_conditional} units, projected tier ${p.tier_index === null ? "none" : p.tier_index + 1}`);
    }
    await sleep(world.network === "sandbox" ? 500 : 2000);
  }
  timers.forEach(clearTimeout);
  await runtime.stop();

  const settleTxs = runtimeTxs.filter((t) => t.method === "settle");
  for (const tx of runtimeTxs) txs.push({ ...tx, phase: tx.method === "join_pool" || tx.method === "leave_pool" ? "agents act (function-call key)" : tx.method === "settle" ? "settle" : "other" });

  const verification = await verifyPool(world.client, posted.offerId, snapshot, settleTxs);
  const checks = [...verification.checks];

  if (o.withdraw) {
    const available = new Map<string, bigint>();
    for (const r of verification.rows) available.set(r.member.agent_id, BigInt(r.agent.budget_available));
    let expected = 0n;
    let withdrawn = 0n;
    await inBatches([...available.entries()], 8, async ([id, amount]) => {
      expected += amount;
      const tx = await world.client.withdraw(world.operator, id);
      txs.push({ ...tx, phase: "owner withdraws leftovers" });
      for (const e of tx.events) for (const d of e.data) if (e.event === "agent_withdrew") withdrawn += BigInt(String(d.amount));
    });
    checks.push({
      name: "owner withdrew every leftover budget (full-access key, 1 yocto)",
      pass: expected === withdrawn,
      detail: `${formatNear(withdrawn, 4, 2)} NEAR withdrawn from ${available.size} agents`,
    });
  }

  const ok = checks.every((c) => c.pass);
  const final: Verification = { ...verification, checks, ok };
  const receipt = renderReceipt(final, labels);
  return { ok, offerId: posted.offerId, roster, verification: final, checks, receipt, activity, txs, startedAt, finishedAt: Date.now() };
}

// ------------------------------------------------------------------------------------------------
// Evidence output
// ------------------------------------------------------------------------------------------------

export function scenarioJson(world: World, r: ScenarioResult) {
  return {
    network: world.network,
    rpc: world.netConfig.rpcUrls[0] ?? null,
    coop: world.coopId,
    token: world.tokenId,
    wasm: world.deployment
      ? { coop_sha256: world.deployment.coop.sha256, credits_token_sha256: world.deployment.token.sha256 }
      : undefined,
    offer_id: r.offerId,
    started_at: new Date(r.startedAt).toISOString(),
    finished_at: new Date(r.finishedAt).toISOString(),
    ok: r.ok,
    roster: r.roster.map((e) => ({ label: e.label, kind: e.kind, units: e.units, policy: e.policy, budget: e.budget.toString() })),
    checks: r.checks,
    pool: r.verification.pool,
    members: r.verification.rows.map((x) => ({ ...x.member, limit: x.limit.toString(), token_balance: x.tokens.toString(), storage_fee: x.storageFee?.toString() ?? null })),
    decisions_and_activity: r.activity,
    transactions: r.txs.map((t) => ({ phase: t.phase, hash: t.hash, signer: t.signer, receiver: t.receiver, method: t.method, gas_burnt: t.gas_burnt, explorer_url: t.explorer_url, events: t.events.map((e) => e.event) })),
  };
}

function link(tx: TxRef): string {
  const short = `${tx.hash.slice(0, 8)}...${tx.hash.slice(-6)}`;
  return tx.explorer_url ? `[\`${short}\`](${tx.explorer_url})` : `\`${short}\``;
}

export function scenarioMarkdown(world: World, r: ScenarioResult): string {
  const lines: string[] = [];
  lines.push(`# ${world.network === "testnet" ? "Testnet" : "Sandbox"} run: pool ${r.offerId}`);
  lines.push("");
  lines.push(`- Network: ${world.network}${world.netConfig.rpcUrls[0] ? ` (${world.netConfig.rpcUrls[0]})` : ""}`);
  lines.push(`- Co-op contract: \`${world.coopId}\``);
  lines.push(`- Item token: \`${world.tokenId}\``);
  lines.push(`- Started ${new Date(r.startedAt).toISOString()}, finished ${new Date(r.finishedAt).toISOString()}`);
  lines.push(`- Agents: ${r.roster.length}; transactions recorded: ${r.txs.length}`);
  lines.push(`- Result: ${r.ok ? "all invariants hold" : "INVARIANT VIOLATION"}`);
  lines.push("");
  lines.push("## Receipt");
  lines.push("");
  lines.push("```text");
  lines.push(r.receipt);
  lines.push("```");
  lines.push("");
  lines.push("## Every transaction");
  lines.push("");
  lines.push("| # | phase | method | signer | receiver | gas burnt (Tgas) | tx |");
  lines.push("|---|---|---|---|---|---|---|");
  r.txs.forEach((t, i) => {
    lines.push(`| ${i + 1} | ${t.phase} | \`${t.method}\` | \`${t.signer}\` | \`${t.receiver}\` | ${(Number(t.gas_burnt) / 1e12).toFixed(2)} | ${link(t)} |`);
  });
  lines.push("");
  lines.push("## Why each agent acted (memos stored on chain with the join)");
  lines.push("");
  for (const m of r.verification.rows) lines.push(`- \`${m.member.agent_id}\` (${m.member.units} units, ${m.member.threshold_units === null ? "unconditional" : `in if the group reaches ${m.member.threshold_units}`}): "${m.member.memo}"`);
  lines.push("");
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------------
// CLI
// ------------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  loadEnv();
  const { values } = parseArgs({
    options: {
      agents: { type: "string" },
      network: { type: "string" },
      out: { type: "string" },
      duration: { type: "string" },
      "lock-window": { type: "string" },
      price: { type: "string" },
      prefix: { type: "string" },
      "no-withdraw": { type: "boolean" },
    },
  });
  const network = parseNetwork(values.network, "sandbox");
  const base = defaultOptions(network);
  const options: Partial<ScenarioOptions> = { withdraw: !values["no-withdraw"] };
  if (values.agents) options.agents = Number(values.agents);
  if (values.duration) options.durationMs = Number(values.duration) * 1000;
  if (values["lock-window"]) options.lockWindowMs = Number(values["lock-window"]) * 1000;
  if (values.price) options.topPrice = parseNear(values.price);
  // Agent accounts are <prefix>-...; a fresh prefix avoids names left on testnet by an earlier run.
  if (values.prefix) {
    if (!/^[a-z0-9]+$/.test(values.prefix)) throw new Error("--prefix must be lowercase letters and digits");
    options.prefix = values.prefix;
  }
  if (!Number.isInteger(options.agents ?? base.agents)) throw new Error("--agents must be an integer");

  const world =
    network === "sandbox"
      ? await createSandboxWorld({ log: (l) => console.log(l) })
      : worldFromEnv(process.env, "testnet");
  if (network === "testnet") {
    const status = (await world.provider.viewNodeStatus()) as { protocol_version?: number };
    console.log(`testnet ${world.coopId} via ${world.netConfig.rpcUrls[0]}, protocol ${status.protocol_version}`);
    if ((status.protocol_version ?? 0) < 88) throw new Error("Testnet protocol is below 88: near-sdk 5.30 contracts will not run. See evidence/testnet-deploy.md / README.");
  }
  let exit = 1;
  try {
    const result = await runScenario(world, options);
    console.log("");
    console.log(result.receipt);
    const stamp = new Date(result.startedAt).toISOString().replace(/[:.]/g, "-");
    const jsonPath = resolve(
      values.out ?? (network === "testnet" ? join(EVIDENCE_DIR, `testnet-run-${stamp}.json`) : join(SANDBOX_DIR, "last-scenario.json")),
    );
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, `${JSON.stringify(scenarioJson(world, result), null, 2)}\n`);
    console.log(`\nJSON log: ${jsonPath.replace(`${REPO_ROOT}/`, "")}`);
    if (network === "testnet") {
      const mdPath = join(EVIDENCE_DIR, `testnet-run-${stamp}.md`);
      writeFileSync(mdPath, scenarioMarkdown(world, result));
      console.log(`Evidence: ${mdPath.replace(`${REPO_ROOT}/`, "")}`);
    }
    exit = result.ok ? 0 : 1;
  } catch (e) {
    console.error(e instanceof Error ? (e.stack ?? e.message) : e);
  } finally {
    await world.stop();
  }
  process.exit(exit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
