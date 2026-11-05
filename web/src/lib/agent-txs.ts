// The wallet transactions that create the visitor's agents (see server/src/wallet-spawn.ts).
// Per agent: a sub-account of the visitor with gas money, the server's join/leave key and a full-access
// key generated here (it never leaves the browser), then register_agent with the agent's budget.
import type { PrepareResponse } from './models';
import type { WalletTx } from './wallet.svelte';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

export interface AgentKey {
  agentId: string;
  publicKey: string;
  /** NEAR CLI / near-api-js format: ed25519:<base58 of seed + public key>. */
  secretKey: string;
}

/** Ed25519 through WebCrypto. Null when the browser has no Ed25519 support. */
async function newKey(agentId: string): Promise<AgentKey | null> {
  try {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
    const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
    // PKCS#8 for Ed25519 ends with the 32-byte seed.
    const seed = pkcs8.slice(pkcs8.length - 32);
    const secret = new Uint8Array(64);
    secret.set(seed, 0);
    secret.set(pub, 32);
    return { agentId, publicKey: `ed25519:${base58(pub)}`, secretKey: `ed25519:${base58(secret)}` };
  } catch {
    return null;
  }
}

export interface AgentBatch {
  transactions: WalletTx[];
  keys: AgentKey[];
  /** False when the browser could not make full-access keys (the agents still work). */
  ownerKeys: boolean;
  totalYocto: bigint;
}

export async function buildAgentBatch(prep: PrepareResponse): Promise<AgentBatch> {
  const keys: AgentKey[] = [];
  const transactions: WalletTx[] = [];
  for (const agent of prep.agents) {
    const key = await newKey(agent.agent_id);
    if (key) keys.push(key);
    transactions.push({
      receiverId: agent.agent_id,
      actions: [
        { type: 'CreateAccount' },
        { type: 'Transfer', params: { deposit: prep.gas_yocto } },
        {
          type: 'AddKey',
          params: {
            publicKey: agent.fc_public_key,
            accessKey: { nonce: 0, permission: { receiverId: prep.contract_id, methodNames: prep.methods } }
          }
        },
        ...(key ? [{ type: 'AddKey', params: { publicKey: key.publicKey, accessKey: { nonce: 0, permission: 'FullAccess' } } }] : [])
      ]
    });
    transactions.push({
      receiverId: prep.contract_id,
      actions: [
        {
          type: 'FunctionCall',
          params: {
            methodName: 'register_agent',
            args: { agent_id: agent.agent_id, limits: prep.limits },
            gas: prep.register_gas,
            deposit: prep.budget_yocto
          }
        }
      ]
    });
  }
  const per = BigInt(prep.budget_yocto) + BigInt(prep.gas_yocto);
  return { transactions, keys, ownerKeys: keys.length === prep.agents.length, totalYocto: per * BigInt(prep.agents.length) };
}

const KEY_STORE = 'coop:agent-keys';

/** Keeps the full-access keys in this browser so the owner can export them later. */
export function saveKeys(owner: string, keys: AgentKey[]): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY_STORE) ?? '{}') as Record<string, AgentKey[]>;
    all[owner] = [...(all[owner] ?? []).filter((k) => !keys.some((n) => n.agentId === k.agentId)), ...keys];
    localStorage.setItem(KEY_STORE, JSON.stringify(all));
  } catch {
    // storage full or blocked: the download button still has them for this session
  }
}

export function downloadKeys(owner: string, keys: AgentKey[]): void {
  const body = JSON.stringify({ owner, network: 'testnet', note: 'Full-access keys of your Co-op agents. Anyone with this file controls these accounts.', agents: keys }, null, 2);
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `coop-agents-${owner}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
