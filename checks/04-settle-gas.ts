/**
 * PRD check 04: settlement gas on the sandbox. Pools of 10, 25 and 50 members, each member a fresh agent so
 * the item token registers it (storage_deposit) and transfers units (ft_transfer) at settlement. Records gas
 * per settle call, per member and log sizes, then writes evidence/gas.md with a DEFAULT_CHUNK recommendation.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { receiptStats, type TxOutcome } from "@coop/agents/chain";
import { EVIDENCE_DIR, REPO_ROOT, SANDBOX_VERSION } from "@coop/agents/config";
import { parseNear, teraGas } from "@coop/agents/money";
import { limitsFromPolicy } from "@coop/agents/policy";
import { postOffer } from "@coop/agents/seller";
import type { SettleProgress, Tier, TxRef } from "@coop/agents/types";
import { createSandboxWorld, provisionAgent, type ProvisionedAgent, type World } from "@coop/agents/world";
import { Report, errorText } from "./lib.js";

const report = new Report(`04 settlement gas on the sandbox (nearcore ${SANDBOX_VERSION})`);
const LOG_CAP_BYTES = 16_384; // protocol limit: max_total_log_length per receipt

interface CallRow {
  scenario: string;
  members: number;
  attachedTgas: number;
  call: number;
  processedNow: number;
  cursor: number;
  remaining: number;
  status: string;
  txBurntTgas: number;
  settleReceiptBurntTgas: number;
  maxReceiptLogBytes: number;
  logLines: number;
  receipts: number;
  allReceiptsOk: boolean;
}

const rows: CallRow[] = [];
const joinLeave: Array<{ members: number; join: number; leave: number }> = [];

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function freshAgents(world: World, n: number, tag: string): Promise<ProvisionedAgent[]> {
  const policy = { archetype: "eager" as const, units: 1, max_unit_price: parseNear("1").toString() };
  return inBatches(Array.from({ length: n }, (_, i) => i), 10, (i) =>
    provisionAgent(world, { label: `${tag}${i}`, limits: limitsFromPolicy(policy), budget: parseNear("3"), gasBalance: parseNear("0.2") }),
  );
}

/** Runs one pool to completion with explicit settle parameters and records every call. */
async function measure(
  world: World,
  scenario: string,
  agents: ProvisionedAgent[],
  options: { tiers: Tier[]; attachedTgas: number; maxMembers?: number; expect: "Settled" | "Refunded" },
): Promise<void> {
  const n = agents.length;
  const posted = await postOffer(world.client, world.operator, world.tokenId, {
    title: scenario,
    description: "check 04",
    tiers: options.tiers,
    maxUnits: n + 5,
    durationMs: 45_000 + n * 300,
    lockWindowMs: 12_000,
  });
  await inBatches(agents, 10, (a) => world.client.joinPool(a.account, posted.offerId, 1, null, "gas check"));
  const pool = await world.client.getPool(posted.offerId);
  if (pool?.member_count !== n) throw new Error(`${scenario}: expected ${n} members, pool has ${pool?.member_count}`);
  await world.client.waitForChainTime(BigInt(posted.deadlineNs) + 1_000_000n);

  let previous = 0;
  for (let call = 1; call <= 40; call++) {
    const result = await world.client.settleOnce(world.operator, posted.offerId, {
      gas: teraGas(options.attachedTgas),
      ...(options.maxMembers !== undefined ? { maxMembers: options.maxMembers } : {}),
    });
    const progress: SettleProgress = result.value;
    const outcome: TxOutcome = result.outcome;
    const stats = receiptStats(outcome);
    rows.push({
      scenario,
      members: n,
      attachedTgas: options.attachedTgas,
      call,
      processedNow: progress.processed - previous,
      cursor: progress.processed,
      remaining: progress.remaining,
      status: progress.status,
      txBurntTgas: Number(result.tx.gas_burnt) / 1e12,
      settleReceiptBurntTgas: Number(stats[0]?.gasBurnt ?? 0n) / 1e12,
      maxReceiptLogBytes: Math.max(0, ...stats.map((s) => s.logBytes)),
      logLines: stats.reduce((a, s) => a + s.logCount, 0),
      receipts: stats.length,
      allReceiptsOk: stats.every((s) => s.ok),
    });
    previous = progress.processed;
    if (progress.status === options.expect) break;
  }
  const members = await world.client.getAllPoolMembers(posted.offerId);
  const delivered = members.filter((m) => m.delivery === "Delivered").length;
  const last = rows[rows.length - 1] as CallRow;
  report.expect(
    last.status === options.expect && (options.expect === "Refunded" || delivered === n),
    `${scenario}: ${n} members ${options.expect.toLowerCase()}`,
    `${rows.filter((r) => r.scenario === scenario).length} settle calls at ${options.attachedTgas} Tgas${options.maxMembers ? `, max_members ${options.maxMembers}` : ""}, ${delivered}/${n} delivered`,
  );
}

function summarize(scenario: string) {
  const calls = rows.filter((r) => r.scenario === scenario);
  const members = calls[0]?.members ?? 0;
  const total = calls.reduce((a, r) => a + r.txBurntTgas, 0);
  return {
    scenario,
    members,
    attached: calls[0]?.attachedTgas ?? 0,
    calls: calls.length,
    perCall: Math.max(...calls.map((c) => c.processedNow)),
    total,
    perMember: total / Math.max(1, members),
    maxLog: Math.max(...calls.map((c) => c.maxReceiptLogBytes)),
    maxLogLines: Math.max(...calls.map((c) => c.logLines)),
  };
}

function writeEvidence(): string {
  const scenarios = [...new Set(rows.map((r) => r.scenario))];
  const sums = scenarios.map(summarize);
  const at300 = sums.filter((s) => s.attached === 300 && s.scenario.includes("filled") && !s.scenario.includes("max_members"));
  const gasBound = rows.find((r) => r.scenario.includes("max_members 25") && r.attachedTgas === 300 && r.call === 1);
  const defaultCeiling = Math.max(...at300.map((s) => s.perCall));
  const m300 = gasBound?.processedNow ?? defaultCeiling;
  const big = sums.find((s) => s.attached === 1000);
  const refund = sums.find((s) => s.scenario.includes("refund"));
  const perMemberBurn = at300.reduce((a, s) => a + s.perMember, 0) / Math.max(1, at300.length);
  const logPerMember = Math.max(...rows.filter((r) => r.processedNow >= 5 && r.scenario.includes("filled")).map((r) => r.maxReceiptLogBytes / r.processedNow));
  const logCapMembers = Math.floor(LOG_CAP_BYTES / logPerMember);

  // Largest multiple of 5 that a default 300 Tgas call can always finish (so the gas guard never cuts a default call short),
  // and well below what the 16 KB log cap would allow.
  const recommendedChunk = Math.max(5, Math.min(Math.floor(m300 / 5) * 5, Math.floor(logCapMembers / 2)));
  const recommend = recommendedChunk === 10 ? "keep DEFAULT_CHUNK = 10" : `set DEFAULT_CHUNK = ${recommendedChunk}`;
  const lines: string[] = [];
  lines.push("# Settlement gas (check 04)");
  lines.push("");
  lines.push(`Measured on a local near-sandbox, nearcore ${SANDBOX_VERSION} (protocol 88), ${new Date().toISOString()}, with \`checks/04-settle-gas.ts\`.`);
  lines.push("Every member is a fresh agent, so each fill really does `storage_deposit` (NEP-145 registration) + `ft_transfer` on the item token, then the `on_delivered` callback. Gas is the sum of `gas_burnt` over the transaction and every receipt it spawned (the callbacks and the token calls are included because the harness waits for all receipts).");
  lines.push("");
  lines.push("## Per scenario");
  lines.push("");
  lines.push("| scenario | members | attached gas per call (Tgas) | settle calls | members in the biggest call | total gas burnt (Tgas) | gas burnt per member (Tgas) | largest log per receipt (bytes) | log lines in the biggest tx |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const s of sums) {
    lines.push(`| ${s.scenario} | ${s.members} | ${s.attached} | ${s.calls} | ${s.perCall} | ${s.total.toFixed(1)} | ${s.perMember.toFixed(2)} | ${s.maxLog} | ${s.maxLogLines} |`);
  }
  lines.push("");
  lines.push("## Every settle call");
  lines.push("");
  lines.push("| scenario | call | members processed in this call | cursor after | remaining | status after | tx gas burnt, all receipts (Tgas) | settle receipt alone (Tgas) | receipts | log bytes, largest receipt | log lines | all receipts succeeded |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const r of rows) {
    lines.push(`| ${r.scenario} | ${r.call} | ${r.processedNow} | ${r.cursor} | ${r.remaining} | ${r.status} | ${r.txBurntTgas.toFixed(1)} | ${r.settleReceiptBurntTgas.toFixed(1)} | ${r.receipts} | ${r.maxReceiptLogBytes} | ${r.logLines} | ${r.allReceiptsOk ? "yes" : "no"} |`);
  }
  lines.push("");
  lines.push("## What the numbers say");
  lines.push("");
  lines.push(`- With the default \`DEFAULT_CHUNK\` a 300 Tgas \`settle\` call processes **${defaultCeiling} filled members** (the ceiling binds). Asking for more (\`max_members: 25\`) shows where the contract's own gas guard stops at 300 Tgas: **${m300} filled members per call**. The guard sizes each call from the gas left after the first filled member (\`env::used_gas()\`, which counts the 18 Tgas it attaches to the token batch and callback plus receipt fees).`);
  lines.push(`- What actually burns is far less than what the contract reserves: **${perMemberBurn.toFixed(1)} Tgas per filled member** across the whole receipt tree (settle work, \`storage_deposit\`, \`ft_transfer\`, \`on_delivered\`). Unused attached gas is refunded to the caller, so reserving more than is burnt costs extra transactions, not extra money.`);
  if (big) lines.push(`- Attaching 1000 Tgas (the protocol maximum on protocol 88) with an explicit \`max_members\` of ${big.members} processed ${big.perCall} members in one call (${big.calls} call${big.calls === 1 ? "" : "s"} for the ${big.members}-member pool). 300 Tgas is still the recommended cap for wallets and CLIs.`);
  if (refund) lines.push(`- A refunded pool is cheaper per member (no promises): ${refund.members} members took ${refund.calls} call${refund.calls === 1 ? "" : "s"} at ${refund.attached} Tgas, ${refund.perMember.toFixed(2)} Tgas burnt per member.`);
  lines.push(`- **Log size is not the binding limit.** The protocol allows 16384 bytes of logs per receipt (and 100 lines). One \`member_filled\` event is about ${Math.round(logPerMember)} bytes, so a single receipt could carry about ${logCapMembers} members' events before hitting the cap, far more than the ${m300} that gas allows per 300 Tgas call.`);
  const jl = joinLeave[0];
  if (jl) lines.push(`- Worst case for the agents' own calls: with ${jl.members} members in the pool (MAX_MEMBERS), \`join_pool\` burnt ${jl.join.toFixed(2)} Tgas and the first member's \`leave_pool\` (which shifts the member list) burnt ${jl.leave.toFixed(2)} Tgas. The runtime attaches 50 Tgas to each.`);
  lines.push("");
  lines.push("## Recommended DEFAULT_CHUNK");
  lines.push("");
  lines.push(`**${recommend}** (\`contracts/coop/src/settle.rs\`, currently ${10}).`);
  lines.push("");
  lines.push(`Reason: at 300 Tgas the gas guard lets ${m300} filled members through one call, so a ceiling of ${recommendedChunk} is the largest multiple of 5 that every default call can finish inside 300 Tgas (${Math.round((1 - recommendedChunk / m300) * 100)}% of headroom for a heavier first member), and it stays far below the 16 KB log cap (about ${logCapMembers} members). \`DEFAULT_CHUNK\` is only a ceiling, because the contract also stops when the gas left is below its per-member estimate, so a value that is too high cannot make a call run out of gas; a value that is too low only costs extra transactions. The runtime's settler loops until the pool is finished, so a 50-member pool takes ${Math.ceil(50 / recommendedChunk)} settle transactions at this ceiling (measured with the current ceiling of 10: ${at300.length > 0 ? Math.max(...at300.map((s) => s.calls)) : "?"}). The 100-member cap (\`MAX_MEMBERS\`) bounds the worst case at about ${Math.ceil(100 / recommendedChunk)} calls.`);
  lines.push("");
  lines.push("This file does not change the contract; the number is a recommendation only.");
  lines.push("");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = join(EVIDENCE_DIR, "gas.md");
  writeFileSync(file, lines.join("\n"));
  return file;
}

async function main(): Promise<void> {
  const world = await createSandboxWorld();
  try {
    const flat: Tier[] = [{ min_units: 1, unit_price: parseNear("1").toString() }];
    // maxUnits of the measured pool is members + 5 = 55, so a 54-unit minimum is valid but 50 members cannot reach it.
    const unreachable: Tier[] = [{ min_units: 54, unit_price: parseNear("1").toString() }];

    const a10 = await freshAgents(world, 10, "g10x");
    await measure(world, "10 members, all filled", a10, { tiers: flat, attachedTgas: 300, expect: "Settled" });

    const a25 = await freshAgents(world, 25, "g25x");
    await measure(world, "25 members, all filled", a25, { tiers: flat, attachedTgas: 300, expect: "Settled" });

    const a50 = await freshAgents(world, 50, "g50x");
    await measure(world, "50 members, all filled", a50, { tiers: flat, attachedTgas: 300, expect: "Settled" });

    // The same 50 agents again (already registered on the token, so cheaper) in a pool that cannot reach its tier.
    await measure(world, "50 members, pool refunded (no tier)", a50, { tiers: unreachable, attachedTgas: 300, expect: "Refunded" });

    // Where the contract's own gas guard stops at 300 Tgas when DEFAULT_CHUNK is not the limit (max_members above it).
    const c25 = await freshAgents(world, 25, "g25z");
    await measure(world, "25 members, all filled, 300 Tgas, max_members 25", c25, { tiers: flat, attachedTgas: 300, maxMembers: 25, expect: "Settled" });

    // What a bigger gas attachment buys: 25 fresh members, 1000 Tgas, ask for all 25 in one call.
    const b25 = await freshAgents(world, 25, "g25y");
    await measure(world, "25 members, all filled, 1000 Tgas", b25, { tiers: flat, attachedTgas: 1000, maxMembers: 25, expect: "Settled" });

    // Worst case for join/leave: a pool at MAX_MEMBERS (100). leave_pool shifts the member list, so the first member pays most.
    const all = [...a10, ...a25, ...a50, ...b25].slice(0, 100);
    const crowded = await postOffer(world.client, world.operator, world.tokenId, {
      title: "100 members",
      description: "check 04 join/leave cost at MAX_MEMBERS",
      tiers: flat,
      maxUnits: 120,
      durationMs: 120_000,
      lockWindowMs: 20_000,
    });
    let lastJoin: TxRef | undefined;
    for (let i = 0; i < all.length; i += 10) {
      const batch = all.slice(i, i + 10);
      const txs = await Promise.all(batch.map((a) => world.client.joinPool(a.account, crowded.offerId, 1, null, "worst case")));
      lastJoin = txs[txs.length - 1];
    }
    const full = await world.client.getPool(crowded.offerId);
    const leaveTx = await world.client.leavePool((all[0] as ProvisionedAgent).account, crowded.offerId);
    joinLeave.push({ members: full?.member_count ?? 0, join: Number(lastJoin?.gas_burnt ?? 0n) / 1e12, leave: Number(leaveTx.gas_burnt) / 1e12 });
    report.expect(
      full?.member_count === 100 && leaveTx.events.some((e) => e.event === "pool_left"),
      "pool at MAX_MEMBERS: the last join and the first member's leave_pool both fit the 50 Tgas the runtime attaches",
      `join gas burnt ${joinLeave[0]?.join.toFixed(2)} Tgas, leave gas burnt ${joinLeave[0]?.leave.toFixed(2)} Tgas`,
    );

    const file = writeEvidence();
    report.pass("evidence written", file.replace(`${REPO_ROOT}/`, ""));
    const worst = Math.max(...rows.map((r) => r.maxReceiptLogBytes));
    report.expect(worst < LOG_CAP_BYTES, "no receipt came near the 16 KB log cap", `largest receipt log ${worst} bytes of ${LOG_CAP_BYTES}`);
    report.expect(rows.every((r) => r.allReceiptsOk), "every receipt of every settle call succeeded", `${rows.length} settle calls`);
  } finally {
    await world.stop();
  }
}

await main().catch((e: unknown) => report.fail("unexpected error", errorText(e)));
process.exit(report.finish());
