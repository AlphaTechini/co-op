// Runtime configuration. Build-time values come from PUBLIC_* env (static adapter bakes them in);
// when the Co-op server is reachable, GET /api/config may refine them at runtime.
import { PUBLIC_API_URL, PUBLIC_COOP_CONTRACT_ID, PUBLIC_NETWORK, PUBLIC_RPC_URL } from '$app/env/public';
import type { ServerConfig, ServerHealth } from './models';

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export const BUILD = {
  network: PUBLIC_NETWORK || 'testnet',
  rpcUrl: trimSlash(PUBLIC_RPC_URL || 'https://test.rpc.fastnear.com'),
  contractId: PUBLIC_COOP_CONTRACT_ID || '',
  apiUrl: trimSlash(PUBLIC_API_URL || '')
};

export const TESTNET_FALLBACK_RPCS = ['https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs'];

export const REPO_URL = 'https://github.com/AlphaTechini/co-op';

export type ServerState = 'none' | 'unknown' | 'up' | 'down';

class AppConfig {
  network = $state(BUILD.network);
  contractId = $state(BUILD.contractId);
  tokenId = $state<string | null>(null);
  apiUrl = BUILD.apiUrl;
  extraRpc = $state<string | null>(null);
  explorerTxBase = $state('https://testnet.nearblocks.io/txns/');
  explorerAccountBase = $state('https://testnet.nearblocks.io/address/');
  spawn = $state<{ enabled: boolean; maxBudgetNear: number; remaining: number } | null>(null);
  llm = $state<'on' | 'off' | null>(null);
  server = $state<ServerState>(BUILD.apiUrl ? 'unknown' : 'none');
  loaded = $state(false);

  /** Ordered RPC endpoints: build-time first, then the server's, then public testnet fallbacks. */
  get rpcUrls(): string[] {
    const urls = [BUILD.rpcUrl];
    if (this.extraRpc && !urls.includes(this.extraRpc)) urls.push(this.extraRpc);
    if (this.network === 'testnet') for (const u of TESTNET_FALLBACK_RPCS) if (!urls.includes(u)) urls.push(u);
    return urls;
  }

  /** Parent account of the contract, used as the owner suffix for spawned agents. */
  get operator(): string {
    const i = this.contractId.indexOf('.');
    return i < 0 ? this.contractId : this.contractId.slice(i + 1);
  }

  get hasServer(): boolean {
    return this.server === 'up';
  }

  async load(): Promise<void> {
    if (!BUILD.apiUrl) {
      this.loaded = true;
      return;
    }
    const [cfg, health] = await Promise.all([this.getJson<ServerConfig>('/api/config'), this.getJson<ServerHealth>('/api/health')]);
    if (cfg || health) this.server = 'up';
    else this.server = 'down';
    if (cfg) {
      if (cfg.contractId) this.contractId = cfg.contractId;
      if (cfg.network) this.network = cfg.network;
      if (cfg.rpcUrl && trimSlash(cfg.rpcUrl) !== BUILD.rpcUrl) this.extraRpc = trimSlash(cfg.rpcUrl);
      if (cfg.tokenId) this.tokenId = cfg.tokenId;
      if (cfg.explorerTxBase) this.explorerTxBase = cfg.explorerTxBase;
      if (cfg.explorerAccountBase) this.explorerAccountBase = cfg.explorerAccountBase;
      if (cfg.spawn) {
        this.spawn = {
          enabled: !!cfg.spawn.enabled,
          maxBudgetNear: Number(cfg.spawn.maxBudgetNear),
          remaining: Number(cfg.spawn.remaining)
        };
      }
    }
    if (health) this.llm = health.llm;
    this.loaded = true;
  }

  /** Re-check the server (used by "Retry" in the feed banner). */
  async recheck(): Promise<void> {
    if (!BUILD.apiUrl) return;
    await this.load();
  }

  private async getJson<T>(path: string): Promise<T | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${BUILD.apiUrl}${path}`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  txUrl(hash: string, explorerUrl?: string): string {
    return explorerUrl || `${this.explorerTxBase}${hash}`;
  }

  accountUrl(id: string): string {
    return `${this.explorerAccountBase}${id}`;
  }
}

export const config = new AppConfig();
