/**
 * PRD check 03: the sandbox boots (nearcore 2.14.0), deploys the committed coop.wasm, answers a view,
 * and sandbox_fast_forward moves the chain clock. `make verify` depends on this.
 */
import { SANDBOX_VERSION } from "@coop/agents/config";
import { createSandboxWorld } from "@coop/agents/world";
import { sleep } from "@coop/agents/chain";
import { Report, errorText } from "./lib.js";

const report = new Report(`03 sandbox boots, deploys and time-travels (nearcore ${SANDBOX_VERSION})`);

async function main(): Promise<void> {
  const started = Date.now();
  const world = await createSandboxWorld();
  try {
    report.pass("sandbox started", `${world.sandbox?.version} at ${world.sandbox?.rpcUrl} in ${Date.now() - started} ms`);
    const status = (await world.provider.viewNodeStatus()) as { protocol_version?: number; version?: { version?: string } };
    report.expect(
      (status.protocol_version ?? 0) >= 88,
      "node runs protocol >= 88 (near-sdk 5.30 host functions)",
      `protocol ${status.protocol_version}, neard ${status.version?.version}`,
    );
    const deployment = world.deployment;
    report.expect(
      deployment?.onChainHashesMatch === true,
      "coop.wasm deployed; on-chain code_hash equals the committed SHA-256",
      `${world.coopId} sha256 ${deployment?.coop.sha256}`,
    );
    const stats = await world.client.getStats();
    report.expect(stats.offers === 0 && stats.agents === 0, "view get_stats answers", JSON.stringify(stats));

    // The chain clock follows wall time (about one block per 127 ms)...
    const t0 = await world.client.chainNowNs();
    await sleep(3000);
    const t1 = await world.client.chainNowNs();
    const wallMs = Number((t1 - t0) / 1_000_000n);
    report.expect(wallMs > 2500 && wallMs < 3800, "block timestamps follow the wall clock", `chain clock advanced ${wallMs} ms in 3000 ms of waiting`);

    // ...and fast_forward skips ahead.
    const blockBefore = await world.provider.viewBlock({ finality: "optimistic" });
    const before = BigInt(blockBefore.header.timestamp_nanosec);
    const ffStart = Date.now();
    await world.sandbox?.fastForward(100);
    const ffMs = Date.now() - ffStart;
    const blockAfter = await world.provider.viewBlock({ finality: "optimistic" });
    const movedMs = Number((BigInt(blockAfter.header.timestamp_nanosec) - before) / 1_000_000n);
    report.expect(
      movedMs > 10_000,
      "sandbox_fast_forward(100 blocks) moves the block timestamp",
      `height ${blockBefore.header.height} -> ${blockAfter.header.height}, chain time +${(movedMs / 1000).toFixed(1)} s, took ${ffMs} ms of wall time`,
    );
  } finally {
    await world.stop();
  }
}

await main().catch((e: unknown) => report.fail("unexpected error", errorText(e)));
process.exit(report.finish("check-03-sandbox.txt"));
