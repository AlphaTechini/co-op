//! Co-op: pooled, tiered purchasing for AI buying agents on NEAR.
//!
//! Sellers post offers with volume price tiers and deposit inventory (NEP-141).
//! Registered buyer agents lock budget to join the offer's pool, unconditionally or
//! conditionally on the pool reaching a size. After the deadline anyone can call
//! `settle`, which finds the largest consistent group, charges the tier price that
//! group reached, pays the seller, delivers the goods and refunds the rest.
//!
//! Module map: `offer` (offers, tiers, inventory), `agent` (agents, budgets, claims),
//! `pool` (membership), `settle` (resolution and chunked settlement), `views`, `events`.

pub mod agent;
pub mod events;
pub mod offer;
pub mod pool;
pub mod settle;
pub mod views;

#[cfg(test)]
mod tests;

use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, near, require, AccountId, BorshStorageKey, Gas, NearToken, PanicOnDefault, Promise,
};

use crate::agent::{AgentRecord, ClaimableEntry};
use crate::offer::Offer;
use crate::pool::Pool;

/// Covers the NEP-145 registration of an agent on the item token (0.00125 NEAR).
pub const STORAGE_RESERVE: u128 = 1_250_000_000_000_000_000_000;
/// Hard cap on members per pool so a pool can always be settled in a few calls.
pub const MAX_MEMBERS: u32 = 100;
pub const MAX_UNITS: u32 = 10_000;
pub const MAX_TIERS: usize = 8;
pub const MAX_TITLE_CHARS: usize = 64;
pub const MAX_DESCRIPTION_CHARS: usize = 280;
pub const MAX_MEMO_CHARS: usize = 140;
pub const MAX_ALLOWED_SELLERS: usize = 32;

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
pub(crate) enum StorageKey {
    Offers,
    Pools,
    Agents,
    Claimable,
    PoolMembers { pool_id: u64 },
    PoolMemberships { pool_id: u64 },
}

/// Counters behind `get_stats`.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Stats {
    pub pools_settled: u64,
    pub pools_refunded: u64,
    pub volume: u128,
    pub units_delivered: u64,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Coop {
    /// Next offer id; `pool_id == offer_id`. Ids start at 1.
    pub(crate) next_id: u64,
    pub(crate) offers: LookupMap<u64, Offer>,
    pub(crate) pools: LookupMap<u64, Pool>,
    pub(crate) agents: IterableMap<AccountId, AgentRecord>,
    /// Undelivered item-token balances (failed deliveries, failed inventory returns).
    pub(crate) claimable: LookupMap<AccountId, Vec<ClaimableEntry>>,
    pub(crate) stats: Stats,
}

#[near]
impl Coop {
    /// No admin, no owner. Nobody can change the rules after deploy.
    #[init]
    pub fn new() -> Self {
        Self {
            next_id: 1,
            offers: LookupMap::new(StorageKey::Offers),
            pools: LookupMap::new(StorageKey::Pools),
            agents: IterableMap::new(StorageKey::Agents),
            claimable: LookupMap::new(StorageKey::Claimable),
            stats: Stats::default(),
        }
    }
}

// ---------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------

pub(crate) fn now_ns() -> u64 {
    env::block_timestamp()
}

/// Cost in yoctoNEAR of `after - before` bytes of storage (zero if storage shrank).
pub(crate) fn storage_cost(before: u64, after: u64) -> u128 {
    u128::from(after.saturating_sub(before)) * env::storage_byte_cost().as_yoctonear()
}

pub(crate) fn yocto(amount: u128) -> NearToken {
    NearToken::from_yoctonear(amount)
}

/// True if the single promise this callback depends on succeeded.
pub(crate) fn promise_succeeded() -> bool {
    env::promise_result_checked(0, 1024).is_ok()
}

pub(crate) fn gas_left() -> Gas {
    env::prepaid_gas().saturating_sub(env::used_gas())
}

impl Coop {
    pub(crate) fn offer(&self, id: u64) -> &Offer {
        self.offers.get(&id).unwrap_or_else(|| env::panic_str("Offer not found"))
    }

    pub(crate) fn pool(&self, id: u64) -> &Pool {
        self.pools.get(&id).unwrap_or_else(|| env::panic_str("Pool not found"))
    }

    /// Persists pending writes of a pool (and its nested collections) so that
    /// `env::storage_usage()` reflects them.
    pub(crate) fn flush_pool(&mut self, pool_id: u64) {
        if let Some(pool) = self.pools.get_mut(&pool_id) {
            pool.members.flush();
            pool.memberships.flush();
        }
        self.pools.flush();
    }
}
