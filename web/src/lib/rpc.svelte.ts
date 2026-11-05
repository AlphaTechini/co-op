// Minimal JSON-RPC view client for NEAR (query/call_function over fetch).
// Chosen over near-api-js: the dashboard only does view calls, and a ~100 line client keeps
// ~56 kB gzipped out of the bundle and gives direct control over failover and timing.

import { config } from './config.svelte';

export type RpcHealth = 'ok' | 'slow' | 'down';

class RpcState {
  failures = $state(0);
  lastOkAt = $state<number | null>(null);
  lastMs = $state<number | null>(null);
  host = $state('');
  lastError = $state<string | null>(null);
  /** When the next retry is due (set by pollers while backing off). */
  retryAt = $state<number | null>(null);
  preferred = 0;

  get health(): RpcHealth {
    if (this.failures >= 3) return 'down';
    if (this.failures >= 1 || (this.lastMs !== null && this.lastMs > 3000)) return 'slow';
    return 'ok';
  }
}

export const rpcState = new RpcState();

export class RpcUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RpcUnavailableError';
  }
}

/** The contract (or account) answered, but with an error: not a transport problem. */
export class ContractViewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViewError';
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(text: string): string {
  const bytes = encoder.encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function post(url: string, body: unknown, timeoutMs: number): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface CallResult {
  result?: { result?: number[]; error?: string };
  error?: { name?: string; cause?: { name?: string; info?: unknown }; message?: string; data?: unknown };
}

let reqId = 0;

/** Calls a view method, rotating through the configured endpoints on transport failure. */
export async function view<T>(method: string, args: Record<string, unknown> = {}, contractId = config.contractId): Promise<T> {
  if (!contractId) throw new ContractViewError('No contract id configured');
  const urls = config.rpcUrls;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < urls.length; attempt++) {
    const idx = (rpcState.preferred + attempt) % urls.length;
    const url = urls[idx];
    const started = performance.now();
    try {
      const json = (await post(
        url,
        {
          jsonrpc: '2.0',
          id: String(++reqId),
          method: 'query',
          params: {
            request_type: 'call_function',
            finality: 'optimistic',
            account_id: contractId,
            method_name: method,
            args_base64: toBase64(JSON.stringify(args))
          }
        },
        8000
      )) as CallResult;
      const ms = performance.now() - started;
      if (json.error) {
        const cause = json.error.cause?.name ?? json.error.name ?? '';
        if (cause === 'UNKNOWN_ACCOUNT' || cause === 'NO_CONTRACT_CODE' || cause === 'CONTRACT_EXECUTION_ERROR') {
          markOk(idx, url, ms);
          throw new ContractViewError(`${cause}: ${contractId}`);
        }
        throw new Error(json.error.message ?? json.error.name ?? 'RPC error');
      }
      markOk(idx, url, ms);
      if (json.result?.error) throw new ContractViewError(json.result.error);
      const bytes = json.result?.result ?? [];
      const text = decoder.decode(Uint8Array.from(bytes));
      return (text === '' ? null : JSON.parse(text)) as T;
    } catch (e) {
      if (e instanceof ContractViewError) throw e;
      lastErr = e;
      rpcState.lastError = e instanceof Error ? e.message : String(e);
    }
  }
  rpcState.failures += 1;
  rpcState.host = hostOf(urls[rpcState.preferred % urls.length]);
  throw new RpcUnavailableError(lastErr instanceof Error ? lastErr.message : 'RPC unreachable');
}

/** Balance and storage of an account; null when it does not exist. */
export async function viewAccount(accountId: string): Promise<{ amount: bigint; storageUsage: number } | null> {
  const urls = config.rpcUrls;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < urls.length; attempt++) {
    const url = urls[(rpcState.preferred + attempt) % urls.length];
    try {
      const json = (await post(
        url,
        { jsonrpc: '2.0', id: String(++reqId), method: 'query', params: { request_type: 'view_account', finality: 'optimistic', account_id: accountId } },
        8000
      )) as { result?: { amount: string; storage_usage: number }; error?: { cause?: { name?: string }; name?: string; message?: string } };
      if (json.error) {
        if ((json.error.cause?.name ?? json.error.name) === 'UNKNOWN_ACCOUNT') return null;
        throw new Error(json.error.message ?? 'RPC error');
      }
      if (!json.result) throw new Error('Empty RPC answer');
      return { amount: BigInt(json.result.amount), storageUsage: json.result.storage_usage };
    } catch (e) {
      lastErr = e;
    }
  }
  throw new RpcUnavailableError(lastErr instanceof Error ? lastErr.message : 'RPC unreachable');
}

function markOk(idx: number, url: string, ms: number) {
  rpcState.preferred = idx;
  rpcState.host = hostOf(url);
  rpcState.lastMs = ms;
  rpcState.lastOkAt = Date.now();
  rpcState.failures = 0;
  rpcState.retryAt = null;
  rpcState.lastError = null;
}
