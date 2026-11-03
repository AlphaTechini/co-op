/** Deleting an account's full-access keys: how the Co-op contract is made un-upgradable (PRD section 8). */
import { PublicKey, actions } from "near-api-js";
import type { Provider } from "near-api-js";
import { CoopClient, accountFromKey } from "./chain.js";
import type { TxRef } from "./types.js";

export interface KeyInfo {
  publicKey: string;
  kind: "FullAccess" | "FunctionCall";
}

export async function listKeys(provider: Provider, accountId: string): Promise<KeyInfo[]> {
  const list = await provider.viewAccessKeyList({ accountId, finalityQuery: { finality: "optimistic" } });
  return list.keys.map((k) => ({
    publicKey: String(k.public_key),
    kind: k.access_key.permission === "FullAccess" ? "FullAccess" : "FunctionCall",
  }));
}

export interface LockResult {
  accountId: string;
  keysBefore: KeyInfo[];
  keysAfter: KeyInfo[];
  codeHashBefore: string;
  codeHashAfter: string;
  /** Null for a dry run or an account that had no full-access key. */
  tx: TxRef | null;
}

/**
 * Deletes every full-access key of `accountId` in one transaction, signed by `signingSecret` (which must be
 * one of those keys). Verifies afterwards that no full-access key is left and the code did not change.
 */
export async function lockAccount(
  client: CoopClient,
  accountId: string,
  signingSecret: string,
  signingPublicKey: string,
  options: { dryRun: boolean },
): Promise<LockResult> {
  const keysBefore = await listKeys(client.provider, accountId);
  const codeHashBefore = (await client.provider.viewAccount({ accountId })).code_hash;
  const full = keysBefore.filter((k) => k.kind === "FullAccess");
  const unchanged: LockResult = { accountId, keysBefore, keysAfter: keysBefore, codeHashBefore, codeHashAfter: codeHashBefore, tx: null };
  if (full.length === 0 || options.dryRun) return unchanged;
  if (!full.some((k) => k.publicKey === signingPublicKey)) {
    throw new Error(`${accountId} has no full-access key matching the signing key, cannot sign the deletion`);
  }
  const account = accountFromKey(accountId, client.provider, signingSecret);
  const outcome = await account.signAndSendTransaction({
    receiverId: accountId,
    actions: full.map((k) => actions.deleteKey(PublicKey.from(k.publicKey))),
  });
  const tx = client.refFor(outcome, accountId, accountId, "delete_keys");
  const keysAfter = await listKeys(client.provider, accountId);
  const codeHashAfter = (await client.provider.viewAccount({ accountId })).code_hash;
  if (keysAfter.some((k) => k.kind === "FullAccess")) {
    throw new Error(`${accountId} still has full-access keys after the deletion: ${JSON.stringify(keysAfter)}`);
  }
  if (codeHashAfter !== codeHashBefore) throw new Error(`${accountId} code_hash changed during the lock`);
  return { accountId, keysBefore, keysAfter, codeHashBefore, codeHashAfter, tx };
}
