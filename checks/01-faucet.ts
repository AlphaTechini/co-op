/**
 * PRD check 01: testnet funding. The operator account must exist (created by the human with
 * `near create-account <id> --useFaucet --networkId testnet`) and hold enough NEAR.
 * Also reads the testnet protocol version: near-sdk 5.30 wasm needs nearcore 2.14 / protocol 88.
 */
import { REPO_ROOT, TESTNET_RPC_URLS, loadEnv, networkConfig } from "@coop/agents/config";
import { YOCTO_PER_NEAR, formatNear } from "@coop/agents/money";
import { Report, errorText, rpcCall } from "./lib.js";

loadEnv();
const report = new Report("01 testnet funding (operator account)");
const MIN_BALANCE = 10n * YOCTO_PER_NEAR;

const config = networkConfig("testnet");
const operator = process.env.OPERATOR_ACCOUNT_ID ?? "";

async function main(): Promise<void> {
  // 1. Is any RPC reachable, and which protocol does testnet run?
  let reachable: string | undefined;
  for (const url of config.rpcUrls) {
    const probe = await rpcCall(url, "status", []);
    if (!probe.ok) {
      report.skip(`RPC ${url}`, `unreachable: ${probe.error ?? "unknown error"}`);
      continue;
    }
    reachable ??= url;
    const status = probe.result as { protocol_version?: number; version?: { version?: string }; chain_id?: string };
    const protocol = status.protocol_version ?? 0;
    report.expect(
      protocol >= 88,
      `testnet protocol version >= 88 (${url})`,
      `protocol ${protocol}, neard ${status.version?.version ?? "?"}, chain ${status.chain_id ?? "?"}. ` +
        (protocol >= 88 ? "near-sdk 5.30 wasm will link." : `Pin near-sdk = "=5.29.1" and rebuild: 5.30 needs protocol 88.`),
    );
    break;
  }
  if (!reachable) {
    report.fail("testnet RPC reachable", `none of ${config.rpcUrls.join(", ")} answered. Check your network; this check needs internet access to NEAR testnet.`);
    return;
  }

  // 2. Operator account.
  if (!operator) {
    report.fail("OPERATOR_ACCOUNT_ID set", `copy .env.example to ${REPO_ROOT}/.env and fill OPERATOR_ACCOUNT_ID / OPERATOR_PRIVATE_KEY. Create the account with: near create-account <id>.testnet --useFaucet --networkId testnet`);
    return;
  }
  const view = await rpcCall(reachable, "query", { request_type: "view_account", finality: "final", account_id: operator });
  if (!view.ok) {
    report.fail(`operator account ${operator} exists`, `${view.error}. Create it with: near create-account ${operator} --useFaucet --networkId testnet`);
    return;
  }
  const amount = BigInt((view.result as { amount: string }).amount);
  report.pass(`operator account ${operator} exists`, `balance ${formatNear(amount, 4)} NEAR`);
  report.expect(
    amount >= MIN_BALANCE,
    "operator balance covers contract deploys and a 12-agent testnet run",
    `${formatNear(amount, 4)} NEAR, need about ${formatNear(MIN_BALANCE, 0)} (contracts ~5 NEAR, agents ~3 NEAR)`,
  );

  // 3. The key in .env controls the account.
  const secret = process.env.OPERATOR_PRIVATE_KEY;
  if (!secret) {
    report.fail("OPERATOR_PRIVATE_KEY set", "missing from .env");
    return;
  }
  try {
    const { KeyPair } = await import("near-api-js");
    const publicKey = KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().toString();
    const key = await rpcCall(reachable, "query", { request_type: "view_access_key", finality: "final", account_id: operator, public_key: publicKey });
    report.expect(key.ok, "OPERATOR_PRIVATE_KEY is an access key of the operator", key.ok ? publicKey : (key.error ?? "unknown"));
  } catch (e) {
    report.fail("OPERATOR_PRIVATE_KEY parses", errorText(e));
  }
  void TESTNET_RPC_URLS;
}

await main().catch((e: unknown) => report.fail("unexpected error", errorText(e)));
process.exit(report.finish("check-01-faucet.txt"));
