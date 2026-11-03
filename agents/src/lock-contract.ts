/**
 * Deletes the full-access keys of the Co-op contract account so nobody can swap the code
 * (PRD section 8). Irreversible, so it only runs with --yes. Writes evidence/contract-lock.md.
 *
 *   pnpm --filter @coop/agents lock-contract            # dry run: shows the keys it would delete
 *   pnpm --filter @coop/agents lock-contract --yes      # deletes them
 *   ... --also-token                                    # lock the demo token account too
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { CoopClient, createProvider } from "./chain.js";
import { EVIDENCE_DIR, REPO_ROOT, explorerTxUrl, loadEnv, networkConfig, requireEnv } from "./config.js";
import { publicKeyOf } from "./deploy.js";
import { lockAccount } from "./lock.js";

async function main(): Promise<void> {
  loadEnv();
  const { values } = parseArgs({ options: { yes: { type: "boolean" }, "also-token": { type: "boolean" } } });
  const operatorSecret = requireEnv("OPERATOR_PRIVATE_KEY");
  const coopId = requireEnv("COOP_CONTRACT_ID");
  const tokenId = requireEnv("CREDITS_TOKEN_ID");
  if ((process.env.NEAR_NETWORK ?? "testnet") !== "testnet") throw new Error("lock-contract is for testnet deployments (set NEAR_NETWORK=testnet)");
  const config = networkConfig("testnet");
  const provider = createProvider(config.rpcUrls);
  const client = new CoopClient(provider, coopId, { tokenId, explorerTx: (h) => explorerTxUrl(config, h) });
  const targets = values["also-token"] ? [coopId, tokenId] : [coopId];
  const operatorKey = publicKeyOf(operatorSecret);
  const dryRun = !values.yes;

  const report: string[] = [
    "# Contract lock",
    "",
    `- When: ${new Date().toISOString()}`,
    "- Effect: the contract account has no access keys, so its code and state can never be changed outside the contract's own methods.",
    "",
  ];

  for (const accountId of targets) {
    const result = await lockAccount(client, accountId, operatorSecret, operatorKey, { dryRun });
    const describe = (keys: typeof result.keysBefore) => keys.map((k) => `${k.kind} ${k.publicKey}`).join(", ") || "none";
    console.log(`${accountId}: code_hash ${result.codeHashBefore}, keys: ${describe(result.keysBefore)}`);
    const full = result.keysBefore.filter((k) => k.kind === "FullAccess");
    if (full.length === 0) {
      console.log("  already locked: no full-access keys");
    } else if (dryRun) {
      console.log(`  DRY RUN: would delete ${full.length} full-access key(s). Re-run with --yes to do it. This cannot be undone.`);
    } else if (result.tx) {
      console.log(`  locked. tx ${result.tx.hash}${result.tx.explorer_url ? `  ${result.tx.explorer_url}` : ""}`);
      report.push(
        `## ${accountId}`,
        "",
        `- Keys before: ${describe(result.keysBefore)}`,
        `- Transaction: ${result.tx.explorer_url ? `[\`${result.tx.hash}\`](${result.tx.explorer_url})` : `\`${result.tx.hash}\``} (${full.length} DeleteKey action(s), signed by the key being deleted)`,
        `- Keys after: ${describe(result.keysAfter)}`,
        `- code_hash before / after: \`${result.codeHashBefore}\` / \`${result.codeHashAfter}\``,
        "",
      );
    }
  }

  if (!dryRun) {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    const file = join(EVIDENCE_DIR, "contract-lock.md");
    writeFileSync(file, `${report.join("\n")}\n`);
    console.log(`Evidence: ${file.replace(`${REPO_ROOT}/`, "")}`);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
