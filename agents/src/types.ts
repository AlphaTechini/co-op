/** Shapes pinned by docs/SPEC.md. Amounts and timestamps are decimal strings (JSON U128 / U64). */

export type U128 = string;
export type U64 = string;

export interface Tier {
  min_units: number;
  unit_price: U128;
}

export interface AgentLimits {
  max_unit_price: U128;
  max_units_per_pool: number;
  allowed_sellers: string[] | null;
  expires_at_ns: U64 | null;
}

export type OfferStatus = "AwaitingInventory" | "Open" | "Closed";
export type PoolStatus =
  | "AwaitingInventory"
  | "Open"
  | "Locked"
  | "Expired"
  | "Settling"
  | "Settled"
  | "Refunded";

export interface OfferView {
  id: number;
  seller: string;
  item_token: string;
  title: string;
  description: string;
  tiers: Tier[];
  max_units: number;
  unit_amount: U128;
  inventory_held: U128;
  deadline_ns: U64;
  lock_window_ns: U64;
  lock_at_ns: U64;
  status: OfferStatus;
  created_at_ns: U64;
}

export interface Projection {
  units: number;
  members_in: number;
  tier_index: number | null;
  unit_price: U128 | null;
}

export interface SettlementResult {
  units: number;
  members_in: number;
  tier_index: number | null;
  unit_price: U128 | null;
  seller_payout: U128;
  resolved_at_ns: U64;
}

export interface PoolView {
  id: number;
  offer: OfferView;
  status: PoolStatus;
  member_count: number;
  units_unconditional: number;
  units_conditional: number;
  projected: Projection;
  result: SettlementResult | null;
  settle_cursor: number;
}

export type MemberOutcome = "Filled" | "Excluded" | "Refunded";
export type DeliveryState = "Pending" | "Delivered" | "Claimable";

export interface MemberView {
  agent_id: string;
  owner: string;
  units: number;
  threshold_units: number | null;
  locked: U128;
  memo: string;
  joined_at_ns: U64;
  projected_in: boolean;
  outcome: MemberOutcome | null;
  paid: U128 | null;
  refunded: U128 | null;
  delivery: DeliveryState | null;
}

export interface AgentView {
  agent_id: string;
  owner: string;
  budget_available: U128;
  budget_locked: U128;
  limits: AgentLimits;
  active_pools: number[];
  registered_at_ns: U64;
}

export interface Claimable {
  token: string;
  amount: U128;
}

export interface Stats {
  offers: number;
  pools_settled: number;
  pools_refunded: number;
  agents: number;
  volume: U128;
  units_delivered: number;
}

export interface SettleProgress {
  status: PoolStatus;
  processed: number;
  remaining: number;
}

/** A parsed NEP-297 log line. */
export interface ChainEvent {
  standard: string;
  version: string;
  event: string;
  data: Record<string, unknown>[];
}

/**
 * Reference to a transaction that landed on chain. `gas_burnt` is a decimal string (BigInt-safe JSON):
 * the transaction plus every receipt it spawned.
 */
export interface TxRef {
  hash: string;
  signer: string;
  receiver: string;
  method: string;
  explorer_url?: string;
  gas_burnt: string;
  events: ChainEvent[];
}

/** TxRef as stored in the activity feed (SPEC 3.1): events stripped to keep the feed small. */
export type ActivityTx = Omit<TxRef, "events"> & { events?: undefined };

export type ActivityKind =
  | "offer_created"
  | "pool_joined"
  | "pool_left"
  | "decision"
  | "settle"
  | "pool_settled"
  | "pool_refunded"
  | "spawned"
  | "error";

/** SPEC 3.1. `ts` is milliseconds since epoch. */
export interface ActivityEntry {
  id: string;
  ts: number;
  kind: ActivityKind;
  pool_id?: number;
  agent_id?: string;
  message: string;
  reason?: string;
  tx?: ActivityTx;
}

export type Archetype = "eager" | "bargain" | "switcher";

/** Deterministic buying policy (PRD section 7). Prices are yoctoNEAR strings. */
export interface Policy {
  archetype: Archetype;
  units: number;
  max_unit_price: U128;
  target_price?: U128;
  allowed_sellers?: string[];
  brief?: string;
}
