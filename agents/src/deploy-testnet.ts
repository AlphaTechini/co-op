/**
 * Deploys the committed wasm to testnet under the operator account:
 *   coop.<operator>      Co-op contract (contracts/res/coop.wasm)
 *   credits.<operator>   demo item token (contracts/res/credits_token.wasm)
 *
 *   pnpm --filter @coop/agents deploy:testnet
 *
 * Both contract accounts get the operator's own public key, so no new secret exists and
 * `lock-contract` can later delete it with the operator key. Writes evidence/testnet-deploy.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { EVIDENCE_DIR, REPO_ROOT, loadEnv, networkConfig, explorerTxUrl, requireEnv } from "./config.js";
import { CoopClient, accountFromKey, createProvider } from "./chain.js";
import { deployStack, publicKeyOf } from "./deploy.js";
import { formatNear, parseNear } from "./money.js";

async function accountExists(client: CoopClient, accountId: string): Promise<boolean> {
  try {
    await client.provider.viewAccount({ accountId });
    return true;
  } catch (e) {
    if (/does not exist|UNKNOWN_ACCOUNT|AccountDoesNotExist/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e))) return false;
    throw e;
  }
}

async function main(): Promise<void> {
  loadEnv();
  const operatorId = requireEnv("OPERATOR_ACCOUNT_ID");
  const operatorSecret = requireEnv("OPERATOR_PRIVATE_KEY");
  const config = networkConfig("testnet");
  const provider = createProvider(config.rpcUrls);
  const explorerTx = (hash: string) => explorerTxUrl(config, hash);
  const operator = accountFromKey(operatorId, provider, operatorSecret);
  const client = new CoopClient(provider, operatorId, { explorerTx });

  const status = (await provider.viewNodeStatus()) as { protocol_version?: number; version?: { version?: string } };
  const protocol = status.protocol_version ?? 0;
  console.log(`testnet protocol ${protocol}, neard ${status.version?.version ?? "?"}`);
  if (protocol < 88) {
    throw new Error(`Testnet is on protocol ${protocol}; near-sdk 5.30 wasm needs 88. Pin near-sdk =5.29.1, rebuild with contracts/build.sh and redeploy.`);
  }

  const coopId = `coop.${operatorId}`;
  const tokenId = `credits.${operatorId}`;
  for (const id of [coopId, tokenId]) {
    if (await accountExists(client, id)) {
      throw new Error(`${id} already exists. Use a fresh operator account, or delete ${id} first (it was probably deployed already: check .env).`);
    }
  }

  const extra = parseNear("0.5");
  const balance = await client.accountBalance(operatorId);
  const needed = 4_500_000_000_000_000_000_000_000n + 2n * extra + parseNear("1");
  console.log(`operator ${operatorId}: ${formatNear(balance, 4)} NEAR`);
  if (balance < needed) {
    throw new Error(`Operator has ${formatNear(balance, 3)} NEAR; deploying both contracts needs about ${formatNear(needed, 1)} NEAR (storage for ~450 KB of wasm). Fund it from the faucet first.`);
  }

  const deployment = await deployStack({
    client,
    operator,
    operatorPublicKey: publicKeyOf(operatorSecret),
    operatorSecretKey: operatorSecret,
    extraFunding: extra,
    log: (line) => console.log(line),
  });

  const envLines = [
    `COOP_CONTRACT_ID=${deployment.coopId}`,
    `CREDITS_TOKEN_ID=${deployment.tokenId}`,
    `PUBLIC_COOP_CONTRACT_ID=${deployment.coopId}`,
  ];
  console.log("\nAdd these lines to .env:\n");
  for (const line of envLines) console.log(line);

  const link = (hash: string) => `[\`${hash}\`](${explorerTx(hash)})`;
  const md = [
    "# Testnet deploy",
    "",
    `- When: ${new Date().toISOString()}`,
    `- Network: testnet (protocol ${protocol}, neard ${status.version?.version ?? "?"})`,
    `- Operator: [\`${operatorId}\`](${config.explorerAccountBase}${operatorId})`,
    `- Co-op contract: [\`${deployment.coopId}\`](${config.explorerAccountBase}${deployment.coopId})`,
    `- Demo item token: [\`${deployment.tokenId}\`](${config.explorerAccountBase}${deployment.tokenId}) (a demo voucher; the seller is the operator, not a real merchant)`,
    "",
    "## Deployed code",
    "",
    "| file | SHA-256 (matches contracts/res/SHA256SUMS) | on-chain code_hash (base58 of the same hash) |",
    "|---|---|---|",
    `| coop.wasm | \`${deployment.coop.sha256}\` | \`${deployment.coop.codeHash}\` |`,
    `| credits_token.wasm | \`${deployment.token.sha256}\` | \`${deployment.token.codeHash}\` |`,
    "",
    "Both on-chain `code_hash` values were read back with `view_account` after the deploy and equal the local hashes.",
    "",
    "## Transactions",
    "",
    "| method | signer | receiver | tx |",
    "|---|---|---|---|",
    ...deployment.txs.map((t) => `| \`${t.method}\` | \`${t.signer}\` | \`${t.receiver}\` | ${link(t.hash)} |`),
    "",
    "## Environment",
    "",
    "```",
    ...envLines,
    "```",
    "",
    "Next: `pnpm --filter @coop/agents scenario --network testnet`, and, once everything is verified, `pnpm --filter @coop/agents lock-contract --yes` to delete the contract account's full-access key.",
    "",
  ].join("\n");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = join(EVIDENCE_DIR, "testnet-deploy.md");
  writeFileSync(file, md);
  console.log(`\nEvidence: ${file.replace(`${REPO_ROOT}/`, "")}`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
