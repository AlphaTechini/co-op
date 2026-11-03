/**
 * PRD check 05: testnet RPC at the dashboard's polling rate. The dashboard (web/) polls `list_pools` and the
 * newest block every 3 s per open tab, and `get_pool_members` for the open pool. This check does the same
 * against each public endpoint independently for N minutes and records errors, rate limiting and latency.
 *
 *   tsx 05-rpc.ts [--minutes 5] [--interval 3000]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_DIR, REPO_ROOT, TESTNET_RPC_URLS, loadEnv } from "@coop/agents/config";
import { Report, errorText, flagValue, rpcCall, type RpcProbe } from "./lib.js";

loadEnv();
const minutes = Number(flagValue("minutes") ?? 5);
const interval = Number(flagValue("interval") ?? 3000);
const report = new Report(`05 testnet RPC at the dashboard polling rate (${minutes} min, every ${interval} ms)`);
const contract = process.env.COOP_CONTRACT_ID ?? "";

interface Stats {
  url: string;
  calls: number;
  errors: number;
  rateLimited: number;
  latencies: number[];
  errorSamples: Map<string, number>;
}

function viewCall(method: string, args: Record<string, unknown>): [string, unknown] {
  return [
    "query",
    {
      request_type: "call_function",
      finality: "optimistic",
      account_id: contract,
      method_name: method,
      args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
    },
  ];
}

/** What one dashboard poll does. */
function pollCalls(): Array<[string, unknown]> {
  const calls: Array<[string, unknown]> = [["block", { finality: "optimistic" }]];
  if (contract) {
    calls.push(viewCall("list_pools", { from_index: null, limit: 20 }));
    calls.push(viewCall("get_pool_members", { pool_id: 1, from_index: null, limit: 100 }));
  }
  return calls;
}

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

async function main(): Promise<void> {
  // Fail fast if the network is not reachable at all: no point polling for minutes.
  const probes = await Promise.all(TESTNET_RPC_URLS.map((url) => rpcCall(url, "status", [])));
  const alive = TESTNET_RPC_URLS.filter((_, i) => probes[i]?.ok);
  probes.forEach((p, i) => (p.ok ? report.pass(`${TESTNET_RPC_URLS[i]} answers status`, `${p.ms.toFixed(0)} ms`) : report.skip(`${TESTNET_RPC_URLS[i]} answers status`, p.error ?? "no answer")));
  if (alive.length === 0) {
    report.fail("any public testnet RPC reachable", `no endpoint answered (${probes.map((p) => p.error).join("; ")}). This check needs internet access to NEAR testnet; nothing was measured.`);
    return;
  }
  if (!contract) report.skip("contract-specific views", "COOP_CONTRACT_ID is not set, polling only the block endpoint. Deploy first for the full dashboard load.");

  const stats = new Map<string, Stats>(alive.map((url) => [url, { url, calls: 0, errors: 0, rateLimited: 0, latencies: [], errorSamples: new Map() }]));
  const endAt = Date.now() + minutes * 60_000;
  console.log(`polling ${alive.length} endpoint(s) until ${new Date(endAt).toISOString()} ...`);
  while (Date.now() < endAt) {
    const tickStart = Date.now();
    await Promise.all(
      alive.map(async (url) => {
        const s = stats.get(url) as Stats;
        for (const [method, params] of pollCalls()) {
          const r: RpcProbe = await rpcCall(url, method, params);
          s.calls++;
          s.latencies.push(r.ms);
          if (!r.ok) {
            s.errors++;
            if (r.status === 429 || /429|rate/i.test(r.error ?? "")) s.rateLimited++;
            s.errorSamples.set(r.error ?? "unknown", (s.errorSamples.get(r.error ?? "unknown") ?? 0) + 1);
          }
        }
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, interval - (Date.now() - tickStart))));
  }

  const lines = [
    "# Testnet RPC at the dashboard polling rate (check 05)",
    "",
    `Run at ${new Date().toISOString()} for ${minutes} minutes, one poll every ${interval} ms per endpoint. Each poll = ${pollCalls().length} JSON-RPC call(s): \`block\` (optimistic)${contract ? `, \`list_pools\` and \`get_pool_members\` on \`${contract}\`` : " (no contract configured)"}.`,
    "",
    "| endpoint | calls | errors | rate limited (429) | p50 ms | p95 ms | max ms |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const s of stats.values()) {
    lines.push(`| ${s.url} | ${s.calls} | ${s.errors} | ${s.rateLimited} | ${percentile(s.latencies, 50).toFixed(0)} | ${percentile(s.latencies, 95).toFixed(0)} | ${Math.max(...s.latencies).toFixed(0)} |`);
    const rate = s.calls === 0 ? 1 : s.errors / s.calls;
    report.expect(rate <= 0.01, `${s.url}: error rate <= 1%`, `${s.errors}/${s.calls} errors, ${s.rateLimited} rate-limited, p95 ${percentile(s.latencies, 95).toFixed(0)} ms`);
  }
  lines.push("");
  for (const s of stats.values()) {
    if (s.errorSamples.size === 0) continue;
    lines.push(`Errors from ${s.url}: ${[...s.errorSamples.entries()].map(([e, n]) => `${e} x${n}`).join("; ")}`);
  }
  const unreachable = TESTNET_RPC_URLS.filter((u) => !alive.includes(u));
  if (unreachable.length > 0) lines.push("", `Not polled (did not answer the initial status call): ${unreachable.join(", ")}`);
  lines.push("", "The server and web use a failover list (fastnear first, then dRPC and Intear). `archival-rpc.testnet.near.org` is deliberately not used (listed as severely rate limited).", "");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, "rpc.md"), lines.join("\n"));
  report.pass("evidence written", `evidence/rpc.md (${join(REPO_ROOT, "evidence/rpc.md")})`);
}

await main().catch((e: unknown) => report.fail("unexpected error", errorText(e)));
process.exit(report.finish());
