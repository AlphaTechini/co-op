// Browser wallet through NEAR Connect (@hot-labs/near-connect): wallet code runs in sandboxed iframes
// loaded from the connector's manifest, so this app ships no wallet SDKs. Loaded lazily on first use.
import type { NearConnector } from '@hot-labs/near-connect';
import { config } from './config.svelte';
import { viewAccount } from './rpc.svelte';

/** Kept back from the spendable balance for the wallet's own transaction fees. */
export const FEE_RESERVE = 50_000_000_000_000_000_000_000n; // 0.05 NEAR
const STORAGE_PER_BYTE = 10_000_000_000_000_000_000n;

export interface WalletTx {
  receiverId: string;
  actions: unknown[];
}

class WalletState {
  accountId = $state<string | null>(null);
  /** Spendable yoctoNEAR: balance minus storage the account must keep. */
  spendable = $state<bigint | null>(null);
  busy = $state(false);
  error = $state<string | null>(null);
  ready = $state(false);
  private connector: NearConnector | null = null;
  private loading: Promise<NearConnector> | null = null;

  private async load(): Promise<NearConnector> {
    if (this.connector) return this.connector;
    this.loading ??= (async () => {
      const { NearConnector } = await import('@hot-labs/near-connect');
      const connector = new NearConnector({
        network: config.network === 'mainnet' ? 'mainnet' : 'testnet',
        features: { signAndSendTransactions: true, testnet: config.network !== 'mainnet' },
        providers: { testnet: config.rpcUrls, mainnet: config.rpcUrls }
      });
      connector.on('wallet:signIn', (e) => {
        this.accountId = e.accounts[0]?.accountId ?? null;
        void this.refresh();
      });
      connector.on('wallet:signOut', () => {
        this.accountId = null;
        this.spendable = null;
      });
      this.connector = connector;
      return connector;
    })();
    return this.loading;
  }

  /** Restores a previous session without opening any UI. */
  async restore(): Promise<void> {
    try {
      const connector = await this.load();
      const { accounts } = await connector.getConnectedWallet();
      this.accountId = accounts[0]?.accountId ?? null;
      if (this.accountId) await this.refresh();
    } catch {
      // nothing connected yet
    } finally {
      this.ready = true;
    }
  }

  async connect(): Promise<void> {
    this.error = null;
    this.busy = true;
    try {
      const connector = await this.load();
      await connector.connect();
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'The wallet did not connect.';
    } finally {
      this.busy = false;
    }
  }

  async disconnect(): Promise<void> {
    const connector = await this.load();
    await connector.disconnect();
    this.accountId = null;
    this.spendable = null;
  }

  async refresh(): Promise<void> {
    if (!this.accountId) return;
    try {
      const acc = await viewAccount(this.accountId);
      if (!acc) {
        this.spendable = 0n;
        return;
      }
      const free = acc.amount - BigInt(acc.storageUsage) * STORAGE_PER_BYTE;
      this.spendable = free > 0n ? free : 0n;
    } catch {
      // keep the last known value; the form shows it as unknown when null
    }
  }

  /** One wallet approval for all transactions. Returns the transaction hashes in order. */
  async signAndSend(transactions: WalletTx[]): Promise<string[]> {
    if (!this.accountId) throw new Error('Connect a wallet first.');
    const connector = await this.load();
    const wallet = await connector.wallet();
    const outcomes = await wallet.signAndSendTransactions({
      network: config.network === 'mainnet' ? 'mainnet' : 'testnet',
      signerId: this.accountId,
      transactions: transactions as Parameters<typeof wallet.signAndSendTransactions>[0]['transactions']
    });
    void this.refresh();
    return (outcomes ?? []).map((o) => {
      const out = o as { transaction?: { hash?: string }; transaction_outcome?: { id?: string } };
      return out.transaction?.hash ?? out.transaction_outcome?.id ?? '';
    });
  }
}

export const wallet = new WalletState();
