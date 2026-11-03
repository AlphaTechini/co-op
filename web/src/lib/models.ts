// Wire shapes of the Co-op contract views (docs/SPEC.md 1.2) and the server API (3.1).
// U128 / U64 arrive as decimal strings and are only ever turned into BigInt, never Number.

export type U128 = string;
export type U64 = string;

export interface Tier {
  min_units: number;
  unit_price: U128;
}

export type OfferStatus = 'AwaitingInventory' | 'Open' | 'Closed';
export type PoolStatus = 'AwaitingInventory' | 'Open' | 'Locked' | 'Expired' | 'Settling' | 'Settled' | 'Refunded';
export type Outcome = 'Filled' | 'Excluded' | 'Refunded';
export type Delivery = 'Pending' | 'Delivered' | 'Claimable';

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

export interface SettlementResult extends Projection {
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

export interface MemberView {
  agent_id: string;
  owner: string;
  units: number;
  threshold_units: number | null;
  locked: U128;
  memo: string;
  joined_at_ns: U64;
  projected_in: boolean;
  outcome: Outcome | null;
  paid: U128 | null;
  refunded: U128 | null;
  delivery: Delivery | null;
}

export interface AgentLimits {
  max_unit_price: U128;
  max_units_per_pool: number;
  allowed_sellers: string[] | null;
  expires_at_ns: U64 | null;
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

export interface StatsView {
  offers: number;
  pools_settled: number;
  pools_refunded: number;
  agents: number;
  volume: U128;
  units_delivered: number;
}

// ---- server API (optional) ------------------------------------------------

export interface TxRef {
  hash: string;
  signer: string;
  receiver: string;
  method: string;
  explorer_url?: string;
}

export type ActivityKind =
  | 'offer_created'
  | 'pool_joined'
  | 'pool_left'
  | 'decision'
  | 'settle'
  | 'pool_settled'
  | 'pool_refunded'
  | 'spawned'
  | 'error';

export interface ActivityEntry {
  id: string | number;
  ts: number; // ms since epoch
  kind: ActivityKind;
  pool_id?: number;
  agent_id?: string;
  message: string;
  reason?: string;
  tx?: TxRef;
}

export interface ServerConfig {
  network: string;
  rpcUrl: string;
  contractId: string;
  tokenId?: string;
  explorerTxBase: string;
  explorerAccountBase: string;
  spawn: { enabled: boolean; maxBudgetNear: number | string; remaining: number };
}

export interface ServerHealth {
  ok: boolean;
  network: string;
  contractId: string;
  llm: 'on' | 'off';
}

export interface SpawnedAgent {
  agent_id: string;
  archetype: string;
  brief: string;
  policy?: unknown;
  created_at?: number | string;
  status?: string;
}

export interface SpawnResponse {
  agent_id: string;
  policy: unknown;
  parser: 'llm' | 'rules';
  txs: TxRef[];
}
