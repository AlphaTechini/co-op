/**
 * Typed client around near-api-js v7 for the Co-op contract and its demo item token.
 * Views return SPEC shapes (amounts as decimal strings); transactions return TxRef records.
 */
import {
  Account,
  FailoverRpcProvider,
  JsonRpcProvider,
  KeyPair,
  actions,
  getTransactionLastResult,
  type KeyPairString,
  type Provider,
} from "near-api-js";
import { STORAGE_RESERVE, parseNear, teraGas } from "./money.js";
import type {
  AgentLimits,
  AgentView,
  ChainEvent,
  Claimable,
  MemberView,
  OfferView,
  PoolView,
  Projection,
  SettleProgress,
  Stats,
  Tier,
  TxRef,
} from "./types.js";

export type TxOutcome = Awaited<ReturnType<Account["signAndSendTransaction"]>>;

// ------------------------------------------------------------------------------------------------
// Gas defaults (Tgas). join/leave were measured in checks/04; settle is the 300 Tgas recommended cap.
// ------------------------------------------------------------------------------------------------
export const GAS = {
  join: teraGas(50),
  leave: teraGas(50),
  settle: teraGas(300),
  claim: teraGas(100),
  ftTransferCall: teraGas(100),
  createOffer: teraGas(30),
  register: teraGas(30),
  simple: teraGas(30),
} as const;

/** Attached to create_offer; the contract keeps what it needs for storage and refunds the rest. */
export const CREATE_OFFER_DEPOSIT = parseNear("0.2");

// ------------------------------------------------------------------------------------------------
// Errors
// ------------------------------------------------------------------------------------------------

/** A transaction failed. `txHash` is set when the transaction made it on chain. */
export class CoopTxError extends Error {
  constructor(
    message: string,
    readonly method: string,
    readonly txHash?: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CoopTxError";
  }

  /** True if the contract panic text contains `fragment`. */
  panicked(fragment: string): boolean {
    return this.message.includes(fragment);
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

function txHashOf(e: unknown): string | undefined {
  const result = (e as { transactionResult?: { transaction?: { hash?: unknown } } } | undefined)?.transactionResult;
  const hash = result?.transaction?.hash;
  return typeof hash === "string" && hash !== "" ? hash : undefined;
}

// ------------------------------------------------------------------------------------------------
// Providers, keys, accounts
// ------------------------------------------------------------------------------------------------

export function createProvider(rpcUrls: readonly string[]): Provider {
  if (rpcUrls.length === 0) throw new Error("No RPC URL configured");
  const providers = rpcUrls.map((url) => new JsonRpcProvider({ url }));
  const first = providers[0];
  if (providers.length === 1 && first) return first;
  return new FailoverRpcProvider(providers);
}

export function accountFromKey(accountId: string, provider: Provider, secretKey: string): Account {
  return new Account(accountId, provider, secretKey as KeyPairString);
}

/**
 * The agent's runtime identity: signs with the function-call key ONLY. Whatever this account
 * object sends must fit the key (receiver = Co-op contract, join_pool / leave_pool, zero deposit).
 */
export function agentSigner(agentId: string, provider: Provider, functionCallSecret: string): Account {
  return accountFromKey(agentId, provider, functionCallSecret);
}

// ------------------------------------------------------------------------------------------------
// Outcome parsing
// ------------------------------------------------------------------------------------------------

/** Gas burnt by the transaction plus every receipt it spawned. */
export function gasBurnt(outcome: TxOutcome): bigint {
  let total = BigInt(outcome.transaction_outcome.outcome.gas_burnt);
  for (const r of outcome.receipts_outcome) total += BigInt(r.outcome.gas_burnt);
  return total;
}

/** Every NEP-297 `EVENT_JSON:` log in the transaction, in receipt order. */
export function parseEvents(outcome: TxOutcome): ChainEvent[] {
  const events: ChainEvent[] = [];
  for (const receipt of outcome.receipts_outcome) {
    for (const line of receipt.outcome.logs) {
      if (!line.startsWith("EVENT_JSON:")) continue;
      try {
        events.push(JSON.parse(line.slice("EVENT_JSON:".length)) as ChainEvent);
      } catch {
        // A malformed log line is not an event; ignore it.
      }
    }
  }
  return events;
}

/** Per receipt: executor, gas burnt, total log bytes. Used by the gas measurements. */
export function receiptStats(outcome: TxOutcome) {
  return outcome.receipts_outcome.map((r) => ({
    executor: r.outcome.executor_id,
    gasBurnt: BigInt(r.outcome.gas_burnt),
    logBytes: r.outcome.logs.reduce((n, l) => n + Buffer.byteLength(l), 0),
    logCount: r.outcome.logs.length,
    ok: typeof r.outcome.status === "object" && "SuccessValue" in r.outcome.status,
  }));
}

export interface TxBuildContext {
  signer: string;
  receiver: string;
  method: string;
  explorerTx?: (hash: string) => string | undefined;
}

export function toTxRef(outcome: TxOutcome, ctx: TxBuildContext): TxRef {
  const hash = outcome.transaction.hash as string;
  const ref: TxRef = {
    hash,
    signer: ctx.signer,
    receiver: ctx.receiver,
    method: ctx.method,
    gas_burnt: gasBurnt(outcome).toString(),
    events: parseEvents(outcome),
  };
  const url = ctx.explorerTx?.(hash);
  if (url) ref.explorer_url = url;
  return ref;
}

export interface TxResult<T = unknown> {
  tx: TxRef;
  /** Decoded JSON return value of the transaction (undefined for empty returns). */
  value: T;
  outcome: TxOutcome;
}

// ------------------------------------------------------------------------------------------------
// CoopClient
// ------------------------------------------------------------------------------------------------

export interface CoopClientOptions {
  /** Item token used by token helpers when none is passed. */
  tokenId?: string;
  explorerTx?: (hash: string) => string | undefined;
  /** "optimistic" (default) sees the newest block; "final" lags a couple of blocks. */
  finality?: "optimistic" | "final";
}

export interface CreateOfferParams {
  itemToken: string;
  title: string;
  description: string;
  tiers: Tier[];
  maxUnits: number;
  /** Item token base units per Co-op unit (the demo token has decimals 0, so 1n). */
  unitAmount: bigint;
  deadlineNs: bigint;
  lockWindowNs: bigint;
  deposit?: bigint;
}

export class CoopClient {
  readonly tokenId?: string;
  private readonly explorerTx?: (hash: string) => string | undefined;
  private readonly finality: "optimistic" | "final";

  constructor(
    readonly provider: Provider,
    readonly coopId: string,
    options: CoopClientOptions = {},
  ) {
    if (options.tokenId !== undefined) this.tokenId = options.tokenId;
    if (options.explorerTx !== undefined) this.explorerTx = options.explorerTx;
    this.finality = options.finality ?? "optimistic";
  }

  // ---- views ---------------------------------------------------------------------------------

  private async view<T>(contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.provider.callFunction<T & never>({
      contractId,
      method,
      args,
      blockQuery: { finality: this.finality },
    });
    // `Option::None` comes back as JSON null; near-api-js may surface that as null or undefined.
    return (result ?? null) as T;
  }

  getOffer(offerId: number): Promise<OfferView | null> {
    return this.view(this.coopId, "get_offer", { offer_id: offerId });
  }

  getPool(poolId: number): Promise<PoolView | null> {
    return this.view(this.coopId, "get_pool", { pool_id: poolId });
  }

  /** Newest first. Default limit 20, max 50 (contract-side). */
  listPools(fromIndex?: number, limit?: number): Promise<PoolView[]> {
    return this.view(this.coopId, "list_pools", { from_index: fromIndex ?? null, limit: limit ?? null });
  }

  async getPoolMembers(poolId: number, fromIndex?: number, limit?: number): Promise<MemberView[]> {
    return this.view(this.coopId, "get_pool_members", {
      pool_id: poolId,
      from_index: fromIndex ?? null,
      limit: limit ?? null,
    });
  }

  /** All members in join order (pages of 100). */
  async getAllPoolMembers(poolId: number): Promise<MemberView[]> {
    const all: MemberView[] = [];
    for (;;) {
      const page = await this.getPoolMembers(poolId, all.length, 100);
      all.push(...page);
      if (page.length < 100) return all;
    }
  }

  projectedPrice(poolId: number): Promise<Projection> {
    return this.view(this.coopId, "projected_price", { pool_id: poolId });
  }

  getAgent(agentId: string): Promise<AgentView | null> {
    return this.view(this.coopId, "get_agent", { agent_id: agentId });
  }

  listAgents(fromIndex?: number, limit?: number): Promise<AgentView[]> {
    return this.view(this.coopId, "list_agents", { from_index: fromIndex ?? null, limit: limit ?? null });
  }

  async listAllAgents(): Promise<AgentView[]> {
    const all: AgentView[] = [];
    for (;;) {
      const page = await this.listAgents(all.length, 100);
      all.push(...page);
      if (page.length < 100) return all;
    }
  }

  getClaimable(accountId: string): Promise<Claimable[]> {
    return this.view(this.coopId, "get_claimable", { agent_id: accountId });
  }

  getStats(): Promise<Stats> {
    return this.view(this.coopId, "get_stats");
  }

  // ---- item token views ----------------------------------------------------------------------

  private token(tokenId?: string): string {
    const id = tokenId ?? this.tokenId;
    if (!id) throw new Error("No item token configured for this CoopClient");
    return id;
  }

  async ftBalanceOf(accountId: string, tokenId?: string): Promise<bigint> {
    const raw = await this.view<string>(this.token(tokenId), "ft_balance_of", { account_id: accountId });
    return BigInt(raw);
  }

  async storageBalanceBounds(tokenId?: string): Promise<{ min: bigint; max: bigint | null }> {
    const raw = await this.view<{ min: string; max: string | null }>(this.token(tokenId), "storage_balance_bounds");
    return { min: BigInt(raw.min), max: raw.max === null ? null : BigInt(raw.max) };
  }

  async isRegisteredOnToken(accountId: string, tokenId?: string): Promise<boolean> {
    const raw = await this.view<unknown>(this.token(tokenId), "storage_balance_of", { account_id: accountId });
    return raw !== null;
  }

  async accountBalance(accountId: string): Promise<bigint> {
    const state = await this.provider.viewAccount({ accountId, blockQuery: { finality: this.finality } });
    return BigInt(state.amount);
  }

  /** Timestamp of the newest block (what contracts see as env::block_timestamp). */
  async chainNowNs(): Promise<bigint> {
    const block = await this.provider.viewBlock({ finality: "optimistic" });
    return BigInt(block.header.timestamp_nanosec);
  }

  /** Resolves once the chain clock is at or past `targetNs`. */
  async waitForChainTime(targetNs: bigint, pollMs = 250, timeoutMs = 600_000): Promise<void> {
    const started = Date.now();
    for (;;) {
      if ((await this.chainNowNs()) >= targetNs) return;
      if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for the chain clock");
      await sleep(pollMs);
    }
  }

  // ---- transactions --------------------------------------------------------------------------

  /** Signs and sends one function call, waits for every receipt, returns the TxRef. */
  async callTx<T = unknown>(
    signer: Account,
    params: { receiver?: string; method: string; args?: Record<string, unknown>; gas?: bigint; deposit?: bigint },
  ): Promise<TxResult<T>> {
    const receiver = params.receiver ?? this.coopId;
    let outcome: TxOutcome;
    try {
      outcome = await signer.callFunctionRaw({
        contractId: receiver,
        methodName: params.method,
        args: params.args ?? {},
        gas: params.gas ?? GAS.simple,
        deposit: params.deposit ?? 0n,
      });
    } catch (e) {
      throw new CoopTxError(`${params.method} on ${receiver} failed: ${errorText(e)}`, params.method, txHashOf(e), e);
    }
    const ctx: TxBuildContext = { signer: signer.accountId, receiver, method: params.method };
    if (this.explorerTx) ctx.explorerTx = this.explorerTx;
    return { tx: toTxRef(outcome, ctx), value: getTransactionLastResult(outcome) as T, outcome };
  }

  /** TxRef for transactions sent with the raw Account API (account creation, keys, deploys). */
  refFor(outcome: TxOutcome, signer: string, receiver: string, method: string): TxRef {
    const ctx: TxBuildContext = { signer, receiver, method };
    if (this.explorerTx) ctx.explorerTx = this.explorerTx;
    return toTxRef(outcome, ctx);
  }

  async createOffer(seller: Account, p: CreateOfferParams): Promise<{ offerId: number; tx: TxRef }> {
    const result = await this.callTx<number>(seller, {
      method: "create_offer",
      args: {
        item_token: p.itemToken,
        title: p.title,
        description: p.description,
        tiers: p.tiers,
        max_units: p.maxUnits,
        unit_amount: p.unitAmount.toString(),
        deadline_ns: p.deadlineNs.toString(),
        lock_window_ns: p.lockWindowNs.toString(),
      },
      gas: GAS.createOffer,
      deposit: p.deposit ?? CREATE_OFFER_DEPOSIT,
    });
    if (typeof result.value !== "number") throw new Error("create_offer returned no offer id");
    return { offerId: result.value, tx: result.tx };
  }

  /** Seller sends inventory with ft_transfer_call; throws if the contract did not take all of it. */
  async depositInventory(seller: Account, offerId: number, amount: bigint, tokenId?: string): Promise<TxRef> {
    const token = this.token(tokenId);
    const result = await this.callTx<string>(seller, {
      receiver: token,
      method: "ft_transfer_call",
      args: { receiver_id: this.coopId, amount: amount.toString(), msg: JSON.stringify({ offer_id: offerId }) },
      gas: GAS.ftTransferCall,
      deposit: 1n,
    });
    const used = BigInt(result.value ?? "0");
    if (used !== amount) {
      throw new CoopTxError(
        `Co-op accepted ${used} of ${amount} inventory units for offer ${offerId}`,
        "ft_transfer_call",
        result.tx.hash,
      );
    }
    return result.tx;
  }

  /** NEP-145 registration (registration_only). Returns null if already registered. */
  async ensureRegisteredOnToken(payer: Account, accountId: string, tokenId?: string): Promise<TxRef | null> {
    const token = this.token(tokenId);
    if (await this.isRegisteredOnToken(accountId, token)) return null;
    const bounds = await this.storageBalanceBounds(token);
    const result = await this.callTx(payer, {
      receiver: token,
      method: "storage_deposit",
      args: { account_id: accountId, registration_only: true },
      gas: teraGas(30),
      deposit: bounds.min,
    });
    return result.tx;
  }

  async registerAgent(owner: Account, agentId: string, limits: AgentLimits, budget: bigint): Promise<TxRef> {
    return (
      await this.callTx(owner, {
        method: "register_agent",
        args: { agent_id: agentId, limits },
        gas: GAS.register,
        deposit: budget,
      })
    ).tx;
  }

  async fundAgent(owner: Account, agentId: string, amount: bigint): Promise<TxRef> {
    return (await this.callTx(owner, { method: "fund_agent", args: { agent_id: agentId }, deposit: amount })).tx;
  }

  async updateLimits(owner: Account, agentId: string, limits: AgentLimits): Promise<TxRef> {
    return (
      await this.callTx(owner, { method: "update_limits", args: { agent_id: agentId, limits }, deposit: 1n })
    ).tx;
  }

  /** Owner withdraws `amount` (all available budget when omitted). Needs the owner's full-access key. */
  async withdraw(owner: Account, agentId: string, amount?: bigint): Promise<TxRef> {
    return (
      await this.callTx(owner, {
        method: "withdraw",
        args: { agent_id: agentId, amount: amount === undefined ? null : amount.toString() },
        deposit: 1n,
      })
    ).tx;
  }

  /** Called by the agent with its function-call key: zero deposit. */
  async joinPool(
    agent: Account,
    poolId: number,
    units: number,
    thresholdUnits: number | null,
    memo: string,
  ): Promise<TxRef> {
    return (
      await this.callTx(agent, {
        method: "join_pool",
        args: { pool_id: poolId, units, threshold_units: thresholdUnits, memo },
        gas: GAS.join,
      })
    ).tx;
  }

  async leavePool(agent: Account, poolId: number): Promise<TxRef> {
    return (await this.callTx(agent, { method: "leave_pool", args: { pool_id: poolId }, gas: GAS.leave })).tx;
  }

  async improveOffer(seller: Account, offerId: number, tiers: Tier[]): Promise<TxRef> {
    return (
      await this.callTx(seller, { method: "improve_offer", args: { offer_id: offerId, tiers }, deposit: 1n })
    ).tx;
  }

  async claim(caller: Account, agentId: string, token: string): Promise<TxRef> {
    return (
      await this.callTx(caller, { method: "claim", args: { agent_id: agentId, token }, gas: GAS.claim })
    ).tx;
  }

  /** One settle call. */
  async settleOnce(
    signer: Account,
    poolId: number,
    options: { maxMembers?: number; gas?: bigint } = {},
  ): Promise<TxResult<SettleProgress>> {
    return this.callTx<SettleProgress>(signer, {
      method: "settle",
      args: { pool_id: poolId, max_members: options.maxMembers ?? null },
      gas: options.gas ?? GAS.settle,
    });
  }

  /**
   * Calls settle until the pool is Settled or Refunded, recording every transaction. If the chain
   * clock has not reached the deadline yet, waits for it (when `waitForDeadline`) instead of failing.
   */
  async settle(
    signer: Account,
    poolId: number,
    options: {
      maxMembers?: number;
      gas?: bigint;
      maxCalls?: number;
      waitForDeadline?: boolean;
      onTx?: (tx: TxRef, progress: SettleProgress) => void;
    } = {},
  ): Promise<{ txs: TxRef[]; progress: SettleProgress }> {
    const txs: TxRef[] = [];
    const maxCalls = options.maxCalls ?? 40;
    if (options.waitForDeadline) {
      const pool = await this.getPool(poolId);
      if (!pool) throw new Error(`Pool ${poolId} not found`);
      await this.waitForChainTime(BigInt(pool.offer.deadline_ns) + 1_000_000n);
    }
    for (let call = 0; call < maxCalls; call++) {
      const r = await this.settleOnce(signer, poolId, options);
      txs.push(r.tx);
      options.onTx?.(r.tx, r.value);
      if (r.value.status === "Settled" || r.value.status === "Refunded") return { txs, progress: r.value };
    }
    throw new Error(`Pool ${poolId} still not settled after ${maxCalls} settle calls`);
  }
}

// ------------------------------------------------------------------------------------------------
// Accounts and keys
// ------------------------------------------------------------------------------------------------

export interface CreatedAccount {
  accountId: string;
  /** Full-access key pair (null when the account reuses an existing public key). */
  keyPair: KeyPair | null;
  tx: TxRef;
}

/**
 * Creates `<label>.<parent>` funded with `initialBalance`. By default a fresh full-access key is
 * generated and returned; pass `publicKey` to give the account an existing key instead.
 */
export async function createSubAccount(
  client: CoopClient,
  parent: Account,
  label: string,
  initialBalance: bigint,
  publicKey?: string,
): Promise<CreatedAccount> {
  const accountId = `${label}.${parent.accountId}`;
  const keyPair = publicKey ? null : KeyPair.fromRandom("ed25519");
  const pk = publicKey ?? (keyPair as KeyPair).getPublicKey().toString();
  let outcome: TxOutcome;
  try {
    outcome = await parent.createSubAccount({ accountOrPrefix: accountId, publicKey: pk, nearToTransfer: initialBalance });
  } catch (e) {
    throw new CoopTxError(`create ${accountId} failed: ${errorText(e)}`, "create_account", txHashOf(e), e);
  }
  return { accountId, keyPair, tx: client.refFor(outcome, parent.accountId, accountId, "create_account") };
}

export interface AddedKey {
  keyPair: KeyPair;
  tx: TxRef;
}

/**
 * Adds a function-call key to `account` limited to `methods` on `contractId`.
 *
 * near-api-js's own `addFunctionCallAccessKey` silently defaults to a 0.25 NEAR allowance, which a
 * long-running agent would use up; here no allowance means unlimited (the agent account's own balance,
 * a few tenths of a NEAR, is then the real cap). If you set one, keep it at 0.5 NEAR or more: gas is
 * bought at 0.001 NEAR per Tgas up front and only refunded a few seconds later.
 * Pass `keyPair` to add a key the caller already holds (and has stored) instead of a fresh one.
 */
export async function addFunctionCallKey(
  client: CoopClient,
  account: Account,
  contractId: string,
  methods: string[],
  allowance?: bigint,
  keyPair: KeyPair = KeyPair.fromRandom("ed25519"),
): Promise<AddedKey> {
  let outcome: TxOutcome;
  try {
    outcome = await account.signAndSendTransaction({
      receiverId: account.accountId,
      actions: [actions.addFunctionCallAccessKey(keyPair.getPublicKey(), contractId, methods, allowance)],
    });
  } catch (e) {
    throw new CoopTxError(`add key on ${account.accountId} failed: ${errorText(e)}`, "add_key", txHashOf(e), e);
  }
  return { keyPair, tx: client.refFor(outcome, account.accountId, account.accountId, "add_key") };
}

export const AGENT_METHODS = ["join_pool", "leave_pool"] as const;

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Minimum balance a budget needs on top of locks: reserve per delivery plus membership storage headroom. */
export const MEMBERSHIP_HEADROOM = parseNear("0.03");
export { STORAGE_RESERVE };
