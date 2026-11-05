/**
 * Keeps one offer open: when no pool is joinable (Open or awaiting inventory), the operator posts a new
 * offer with the standard ladder [1 unit: 100%, 20 units: 70%, 50 units: 50%] of the entry price.
 * With `isMine`, only matching pools count, so one loop per catalog item can run side by side.
 */
import type { Account } from "near-api-js";
import type { CoopClient } from "@coop/agents/chain";
import { CREATE_OFFER_DEPOSIT } from "@coop/agents/chain";
import { storyTiers } from "@coop/agents/roster";
import { postOffer } from "@coop/agents/seller";
import type { PoolView } from "@coop/agents/types";
import type { NewEntry } from "./activity.js";

export interface SellerLoopOptions {
  client: CoopClient;
  seller: Account;
  tokenId: string;
  /** Entry price in yocto (the 1-unit tier). */
  entryPrice: bigint;
  maxUnits?: number;
  durationMs: number;
  lockWindowMs: number;
  intervalMs: number;
  /** Do not post when the seller would drop below this balance. */
  balanceFloor: bigint;
  emit: (entry: NewEntry) => void;
  /** Runs right before an offer is posted (the demo tops up its scripted agents here). */
  beforePost?: () => Promise<void>;
  /** Runs once the new offer is open. */
  afterPost?: (offerId: number) => void;
  /** Which pools this loop keeps open (default: every pool). */
  isMine?: (pool: PoolView) => boolean;
  title?: string;
  description?: string;
}

const OPEN_STATES = new Set<PoolView["status"]>(["Open", "AwaitingInventory"]);

export class SellerLoop {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private stopped = false;
  private backoffUntil = 0;
  private lastError = "";

  constructor(private readonly o: SellerLoopOptions) {}

  start(): void {
    if (this.timer || this.stopped) return;
    const run = () => {
      void this.tick().finally(() => {
        if (!this.stopped) this.timer = setTimeout(run, this.o.intervalMs);
      });
    };
    run();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.busy) await new Promise((r) => setTimeout(r, 50));
  }

  /** One pass; public for tests. Returns the new offer id when it posted one. */
  async tick(): Promise<number | null> {
    if (this.busy || this.stopped || Date.now() < this.backoffUntil) return null;
    this.busy = true;
    try {
      const pools = await this.o.client.listPools(0, 30);
      const mine = this.o.isMine ?? (() => true);
      if (pools.some((p) => OPEN_STATES.has(p.status) && mine(p))) return null;
      const balance = await this.o.client.accountBalance(this.o.seller.accountId);
      if (balance < this.o.balanceFloor + CREATE_OFFER_DEPOSIT) {
        this.fail("The seller account is too low on NEAR to post another offer.");
        return null;
      }
      const maxUnits = this.o.maxUnits ?? 50;
      if ((await this.o.client.ftBalanceOf(this.o.seller.accountId, this.o.tokenId)) < BigInt(maxUnits)) {
        this.fail("The seller account has no item tokens left to deposit as inventory.");
        return null;
      }
      await this.o.beforePost?.();
      const posted = await postOffer(this.o.client, this.o.seller, this.o.tokenId, {
        title: this.o.title ?? "Demo API credits (volume pricing)",
        description: this.o.description ?? "Demo voucher units. The more agents join, the lower the price for everyone.",
        tiers: storyTiers(this.o.entryPrice),
        maxUnits,
        durationMs: this.o.durationMs,
        lockWindowMs: this.o.lockWindowMs,
      });
      this.lastError = "";
      this.o.afterPost?.(posted.offerId);
      return posted.offerId;
    } catch (e) {
      this.fail(`Posting a new offer failed: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`);
      return null;
    } finally {
      this.busy = false;
    }
  }

  private fail(message: string): void {
    this.backoffUntil = Date.now() + 15_000;
    if (message !== this.lastError) this.o.emit({ kind: "error", message });
    this.lastError = message;
  }
}
