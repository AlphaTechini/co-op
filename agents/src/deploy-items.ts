/**
 * Deploys the two extra demo item tokens rooms can buy, from the same committed credits_token.wasm:
 *   gpu-hours.<operator>       "GPU compute hours"
 *   dataset-seats.<operator>   "Dataset access seats"
 *
 *   pnpm --filter @coop/agents deploy:items
 *
 * Needs COOP_CONTRACT_ID (the contract must exist first). Skips a token that already exists.
 * Writes evidence/testnet-items.md and prints the env lines the server needs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CoopClient, accountFromKey, createProvider, isAccountMissing } from "./chain.js";
import { EVIDENCE_DIR, REPO_ROOT, explorerTxUrl, loadEnv, networkConfig, requireEnv } from "./config.js";
import { deployItemToken, publicKeyOf, type ItemTokenDeployment } from "./deploy.js";
import { parseNear } from "./money.js";

const ITEMS = [
  { label: "gpu-hours", env: "GPU_HOURS_TOKEN_ID", name: "Demo GPU compute hour (Co-op demo seller)", symbol: "DEMOGPU" },
  { label: "dataset-seats", env: "DATASET_SEATS_TOKEN_ID", name: "Demo dataset access seat (Co-op demo seller)", symbol: "DEMOSEAT" },
];

async function main(): Promise<void> {
  loadEnv();
  const operatorId = requireEnv("OPERATOR_ACCOUNT_ID");
  const operatorSecret = requireEnv("OPERATOR_PRIVATE_KEY");
  const coopId = requireEnv("COOP_CONTRACT_ID");
  const config = networkConfig("testnet");
  const provider = createProvider(config.rpcUrls);
  const explorerTx = (hash: string) => explorerTxUrl(config, hash);
  const operator = accountFromKey(operatorId, provider, operatorSecret);
  const client = new CoopClient(provider, coopId, { explorerTx });

  const done: Array<{ env: string; deployment: ItemTokenDeployment }> = [];
  for (const item of ITEMS) {
    const id = `${item.label}.${operatorId}`;
    try {
      await provider.viewAccount({ accountId: id });
      console.log(`${id} already exists, skipped`);
      continue;
    } catch (e) {
      if (!isAccountMissing(e)) throw e;
    }
    const deployment = await deployItemToken({
      client,
      operator,
      operatorPublicKey: publicKeyOf(operatorSecret),
      operatorSecretKey: operatorSecret,
      // Storage for the code is added on top; this only covers token holder registrations.
      extraFunding: parseNear("0.3"),
      coopId,
      label: item.label,
      name: item.name,
      symbol: item.symbol,
    });
    console.log(`${deployment.tokenId} deployed, code hash ${deployment.token.codeHash} (matches)`);
    done.push({ env: item.env, deployment });
  }

  const envLines = ITEMS.map((i) => `${i.env}=${i.label}.${operatorId}`);
  console.log("\nAdd these lines to .env and the server env:\n");
  for (const line of envLines) console.log(line);
  if (done.length === 0) return;

  const link = (hash: string) => `[\`${hash}\`](${explorerTx(hash)})`;
  const md = [
    "# Testnet deploy: extra item tokens",
    "",
    `- When: ${new Date().toISOString()}`,
    `- Co-op contract: \`${coopId}\``,
    "- Code: `contracts/res/credits_token.wasm`, the same file as the credits token; only the name and symbol passed to `new` differ.",
    "",
    "| token | on-chain code_hash (matches SHA256SUMS) |",
    "|---|---|",
    ...done.map((d) => `| [\`${d.deployment.tokenId}\`](${config.explorerAccountBase}${d.deployment.tokenId}) | \`${d.deployment.token.codeHash}\` |`),
    "",
    "## Transactions",
    "",
    "| method | signer | receiver | tx |",
    "|---|---|---|---|",
    ...done.flatMap((d) => d.deployment.txs.map((t) => `| \`${t.method}\` | \`${t.signer}\` | \`${t.receiver}\` | ${link(t.hash)} |`)),
    "",
    "## Environment",
    "",
    "```",
    ...envLines,
    "```",
    "",
  ].join("\n");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = join(EVIDENCE_DIR, "testnet-items.md");
  writeFileSync(file, md);
  console.log(`\nEvidence: ${file.replace(`${REPO_ROOT}/`, "")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
