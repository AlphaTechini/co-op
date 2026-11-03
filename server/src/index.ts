/** Entry point: `pnpm --filter @coop/server start`. */
import { existsSync } from "node:fs";
import { SANDBOX_ENV_FILE, loadEnv } from "@coop/agents/config";
import { createCoop, chainFromEnv } from "./node.js";
import { loadSettings } from "./settings.js";

async function main(): Promise<void> {
  // Repo-root .env first; .sandbox/env (written by `make demo`) when sandbox is asked for, or when
  // nothing chose a network and that file exists.
  loadEnv();
  if (!process.env.NEAR_NETWORK && existsSync(SANDBOX_ENV_FILE)) {
    process.env.NEAR_NETWORK = "sandbox";
    loadEnv();
  }

  const chain = chainFromEnv(process.env);
  const settings = loadSettings(process.env, chain.network);
  const log = (line: string) => console.log(`[coop-server] ${line}`);

  const coop = await createCoop({ env: process.env, settings, chain, logger: true, log });
  const { resumed, retired } = await coop.spawner.resume();
  if (resumed + retired > 0) log(`resumed ${resumed} spawned agents${retired ? `, retired ${retired} unknown to the chain` : ""}`);
  coop.start();
  await coop.app.listen({ port: settings.port, host: settings.host });
  log(
    `${chain.network} contract ${chain.coopId}; spawn ${coop.spawner.status().enabled ? "on" : "off"}; seller loop ${coop.sellerLoop ? "on" : "off"}; settler ${settings.settler && chain.operator ? "on" : "off"}`,
  );

  let closing = false;
  const shutdown = (signal: string) => {
    if (closing) return;
    closing = true;
    log(`${signal}: shutting down`);
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    coop.stop().then(
      () => process.exit(0),
      (e: unknown) => {
        console.error(e);
        process.exit(1);
      },
    );
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
