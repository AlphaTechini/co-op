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
import { PublicKey, actions } from "near-api-js";
import { CoopClient, accountFromKey, createProvider } from "./chain.js";
import { EVIDENCE_DIR, REPO_ROOT, explorerTxUrl, loadEnv, networkConfig, requireEnv } from "./config.js";
import { publicKeyOf } from "./deploy.js";

interface KeyInfo {
  publicKey: string;
  kind: "FullAccess" | "FunctionCall";
}

async function listKeys(client: CoopClient, accountId: string): Promise<KeyInfo[]> {
  const list = await client.provider.viewAccessKeyList({ accountId, finality: "final" } as never);
  return list.keys.map((k) => ({
    publicKey: String(k.public_key),
    kind: k.access_key.permission === "FullAccess" ? "FullAccess" : "FunctionCall",
  }));
}

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

  const report: string[] = [
    "# Contract lock",
    "",
    `- When: ${new Date().toISOString()}`,
    "- Effect: the contract account has no access keys, so its code and state can never be changed outside the contract's own methods.",
    "",
  ];

  for (const accountId of targets) {
    const keys = await listKeys(client, accountId);
    const codeHash = (await provider.viewAccount({ accountId, blockQuery: { finality: "final" } })).code_hash;
    console.log(`${accountId}: code_hash ${codeHash}, keys: ${keys.map((k) => `${k.kind} ${k.publicKey}`).join(", ") || "none"}`);
    const full = keys.filter((k) => k.kind === "FullAccess");
    if (full.length === 0) {
      console.log(`  already locked: no full-access keys`);
      continue;
    }
    if (!full.some((k) => k.publicKey === operatorKey)) {
      throw new Error(`${accountId} has no full-access key matching OPERATOR_PRIVATE_KEY, cannot sign the deletion`);
    }
    if (!values.yes) {
      console.log(`  DRY RUN: would delete ${full.length} full-access key(s). Re-run with --yes to do it. This cannot be undone.`);
      continue;
    }
    const account = accountFromKey(accountId, provider, operatorSecret);
    // One transaction deletes every full-access key; the signing key goes with them.
    const outcome = await account.signAndSendTransaction({
      receiverId: accountId,
      actions: full.map((k) => actions.deleteKey(PublicKey.from(k.publicKey))),
    });
    const tx = client.refFor(outcome, accountId, accountId, "delete_keys");
    const after = await listKeys(client, accountId);
    const codeAfter = (await provider.viewAccount({ accountId, blockQuery: { finality: "final" } })).code_hash;
    if (after.some((k) => k.kind === "FullAccess")) throw new Error(`${accountId} still has full-access keys after the deletion: ${JSON.stringify(after)}`);
    console.log(`  locked. tx ${tx.hash}${tx.explorer_url ? `  ${tx.explorer_url}` : ""}`);
    report.push(
      `## ${accountId}`,
      "",
      `- Keys before: ${keys.map((k) => `${k.kind} \`${k.publicKey}\``).join(", ")}`,
      `- Transaction: ${tx.explorer_url ? `[\`${tx.hash}\`](${tx.explorer_url})` : `\`${tx.hash}\``} (${full.length} DeleteKey action(s), signed by the key being deleted)`,
      `- Keys after: ${after.length === 0 ? "none" : after.map((k) => `${k.kind} \`${k.publicKey}\``).join(", ")}`,
      `- code_hash before / after: \`${codeHash}\` / \`${codeAfter}\``,
      "",
    );
  }

  if (values.yes) {
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
