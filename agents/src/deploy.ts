/** Deploys the committed wasm (contracts/res) and checks its SHA-256 against SHA256SUMS and the chain. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Account, KeyPair, actions, baseEncode, teraToGas, type KeyPairString } from "near-api-js";
import { CoopClient, createSubAccount, CoopTxError, type TxOutcome } from "./chain.js";
import { COOP_WASM, SHA256SUMS, TOKEN_WASM } from "./config.js";
import { parseNear } from "./money.js";
import type { TxRef } from "./types.js";

export interface WasmInfo {
  file: string;
  bytes: Uint8Array;
  sha256: string;
  /** Hash recorded in contracts/res/SHA256SUMS. */
  expected: string;
  /** NEAR-style code hash (base58 of the raw SHA-256). */
  codeHash: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readSha256Sums(path = SHA256SUMS): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) map.set(m[2] as string, m[1] as string);
  }
  return map;
}

/** Reads a wasm and throws unless its hash matches SHA256SUMS. */
export function loadWasm(path: string): WasmInfo {
  const bytes = readFileSync(path);
  const sha256 = sha256Hex(bytes);
  const expected = readSha256Sums().get(basename(path));
  if (!expected) throw new Error(`${basename(path)} is not listed in ${SHA256SUMS}`);
  if (expected !== sha256) {
    throw new Error(`SHA-256 mismatch for ${basename(path)}: file ${sha256}, SHA256SUMS ${expected}`);
  }
  return { file: path, bytes, sha256, expected, codeHash: baseEncode(Buffer.from(sha256, "hex")) };
}

export interface DeployOptions {
  client: CoopClient;
  operator: Account;
  /** Public key given to both contract accounts (the operator's own key, so no new secret exists). */
  operatorPublicKey: string;
  coopLabel?: string;
  tokenLabel?: string;
  tokenSupply?: bigint;
  tokenName?: string;
  tokenSymbol?: string;
  /** Extra NEAR on top of the storage cost of the code. */
  extraFunding?: bigint;
  log?: (line: string) => void;
}

export interface Deployment {
  coopId: string;
  tokenId: string;
  coop: WasmInfo;
  token: WasmInfo;
  txs: TxRef[];
  /** True when the on-chain code_hash of both accounts equals the local SHA-256. */
  onChainHashesMatch: boolean;
}

const STORAGE_PER_BYTE = 10n ** 19n;

type DeployCore = Pick<DeployOptions, "client" | "operator" | "operatorPublicKey" | "extraFunding"> & { operatorSecretKey: string };

/** Creates `<label>.<operator>` and deploys + inits the wasm in one transaction. */
async function deployInit(
  o: DeployCore,
  txs: TxRef[],
  label: string,
  wasm: WasmInfo,
  initMethod: string,
  initArgs: Record<string, unknown>,
): Promise<string> {
  const { client, operator } = o;
  const funding = BigInt(wasm.bytes.length) * STORAGE_PER_BYTE + (o.extraFunding ?? parseNear("1"));
  const created = await createSubAccount(client, operator, label, funding, o.operatorPublicKey);
  txs.push(created.tx);
  const contract = new Account(created.accountId, client.provider, o.operatorSecretKey as KeyPairString);
  let outcome: TxOutcome;
  try {
    outcome = await contract.signAndSendTransaction({
      receiverId: created.accountId,
      actions: [
        actions.deployContract(wasm.bytes),
        actions.functionCall(initMethod, initArgs, teraToGas(30), 0n),
      ],
    });
  } catch (e) {
    throw new CoopTxError(
      `deploy ${basename(wasm.file)} to ${created.accountId} failed: ${e instanceof Error ? e.message : String(e)}`,
      "deploy",
      undefined,
      e,
    );
  }
  txs.push(client.refFor(outcome, created.accountId, created.accountId, `deploy+${initMethod}`));
  return created.accountId;
}

export interface ItemTokenDeployment {
  tokenId: string;
  token: WasmInfo;
  txs: TxRef[];
}

/**
 * Another demo item token from the same committed wasm (only name and symbol differ), owned by the
 * operator, with the Co-op contract registered on it so it can hold room inventory.
 */
export async function deployItemToken(
  o: DeployCore & { coopId: string; label: string; name: string; symbol: string; supply?: bigint },
): Promise<ItemTokenDeployment> {
  const token = loadWasm(TOKEN_WASM);
  const txs: TxRef[] = [];
  const tokenId = await deployInit(o, txs, o.label, token, "new", {
    owner_id: o.operator.accountId,
    total_supply: (o.supply ?? 1_000_000n).toString(),
    name: o.name,
    symbol: o.symbol,
  });
  const reg = await new CoopClient(o.client.provider, o.coopId, { tokenId }).ensureRegisteredOnToken(o.operator, o.coopId);
  if (reg) txs.push(reg);
  if ((await o.client.provider.viewAccount({ accountId: tokenId })).code_hash !== token.codeHash) {
    throw new Error(`On-chain code_hash of ${tokenId} does not match the local wasm after deploy`);
  }
  return { tokenId, token, txs };
}

/** Creates `<coop>.<operator>` and `<credits>.<operator>`, deploys + inits both in one tx each. */
export async function deployStack(o: DeployOptions & { operatorSecretKey: string }): Promise<Deployment> {
  const log = o.log ?? (() => undefined);
  const coop = loadWasm(COOP_WASM);
  const token = loadWasm(TOKEN_WASM);
  const txs: TxRef[] = [];
  const { client, operator } = o;
  const coopLabel = o.coopLabel ?? "coop";
  const tokenLabel = o.tokenLabel ?? "credits";
  log(`coop.wasm          sha256 ${coop.sha256} (matches SHA256SUMS)`);
  log(`credits_token.wasm sha256 ${token.sha256} (matches SHA256SUMS)`);

  const coopId = await deployInit(o, txs, coopLabel, coop, "new", {});
  const tokenId = await deployInit(o, txs, tokenLabel, token, "new", {
    owner_id: operator.accountId,
    total_supply: (o.tokenSupply ?? 1_000_000n).toString(),
    name: o.tokenName ?? "Demo API credit voucher (Co-op demo seller)",
    symbol: o.tokenSymbol ?? "DEMOCRED",
  });

  // The Co-op contract must be registered on the token before it can receive inventory.
  const tokenClient = new CoopClient(client.provider, coopId, { tokenId });
  const reg = await tokenClient.ensureRegisteredOnToken(operator, coopId);
  if (reg) txs.push(reg);

  const onChain = async (id: string) => (await client.provider.viewAccount({ accountId: id })).code_hash;
  const onChainHashesMatch = (await onChain(coopId)) === coop.codeHash && (await onChain(tokenId)) === token.codeHash;
  if (!onChainHashesMatch) throw new Error("On-chain code_hash does not match the local wasm after deploy");
  log(`on-chain code_hash of ${coopId} = ${coop.codeHash} (matches)`);
  log(`on-chain code_hash of ${tokenId} = ${token.codeHash} (matches)`);
  return { coopId, tokenId, coop, token, txs, onChainHashesMatch };
}

export function publicKeyOf(secretKey: string): string {
  return KeyPair.fromString(secretKey as KeyPairString).getPublicKey().toString();
}
