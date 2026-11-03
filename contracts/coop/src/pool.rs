//! Pools: membership, conditional joins and the tally the resolver works on.

use std::collections::BTreeMap;

use near_sdk::store::Vector;

use crate::offer::{lock_price, price_for, OfferStatus, Tier};
use crate::settle::{resolve, SettlementResult};
use crate::*;

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Outcome {
    Filled,
    Excluded,
    Refunded,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
    Pending,
    Delivered,
    Claimable,
}

/// Stored lifecycle phase. The public `PoolStatus` is derived from this plus the clock.
#[near(serializers = [borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PoolPhase {
    Active,
    Settling,
    Settled,
    Refunded,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Membership {
    pub units: u32,
    pub threshold_units: Option<u32>,
    /// Budget locked for this member: `units * lock_price + STORAGE_RESERVE`.
    pub locked: u128,
    /// Storage paid for this membership, taken from the agent's budget at join. Returned
    /// on `leave_pool`; spent for good once the pool is settled.
    pub storage_fee: u128,
    pub memo: String,
    pub joined_at_ns: u64,
    pub outcome: Option<Outcome>,
    pub paid: Option<u128>,
    pub refunded: Option<u128>,
    pub delivery: Option<Delivery>,
}

/// What the resolver decided for a pool at some point in time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Evaluation {
    /// Units of the resolved group (zero if nobody is in).
    pub units: u32,
    pub members_in: u32,
    /// Conditional members with `threshold > cutoff` are out. Included conditional
    /// members always have thresholds below every excluded one (the dropped set is a
    /// top slice of the threshold order), so one number describes the whole group.
    pub cutoff: u32,
    pub tier: Option<(usize, u128)>,
}

impl Evaluation {
    pub fn includes(&self, threshold: Option<u32>) -> bool {
        threshold.is_none_or(|t| t <= self.cutoff)
    }
}

#[near(serializers = [borsh])]
pub struct Pool {
    pub id: u64,
    pub phase: PoolPhase,
    /// Members in join order; also the settlement cursor space.
    pub members: Vector<AccountId>,
    pub memberships: LookupMap<AccountId, Membership>,
    pub uncond_units: u32,
    pub uncond_count: u32,
    /// Conditional members grouped by threshold: `threshold -> (units, members)`.
    pub cond: BTreeMap<u32, (u32, u32)>,
    /// Frozen by the resolver when settlement starts.
    pub cutoff: u32,
    pub result: Option<SettlementResult>,
    pub settle_cursor: u32,
}

impl Pool {
    pub fn new(id: u64) -> Self {
        Self {
            id,
            phase: PoolPhase::Active,
            members: Vector::new(StorageKey::PoolMembers { pool_id: id }),
            memberships: LookupMap::new(StorageKey::PoolMemberships { pool_id: id }),
            uncond_units: 0,
            uncond_count: 0,
            cond: BTreeMap::new(),
            cutoff: 0,
            result: None,
            settle_cursor: 0,
        }
    }

    pub fn member_count(&self) -> u32 {
        self.members.len()
    }

    pub fn units_conditional(&self) -> u32 {
        self.cond.values().map(|(units, _)| units).sum()
    }

    /// Units of every member, in or out.
    pub fn total_units(&self) -> u32 {
        self.uncond_units + self.units_conditional()
    }

    fn add_to_tally(&mut self, units: u32, threshold: Option<u32>) {
        match threshold {
            None => {
                self.uncond_units += units;
                self.uncond_count += 1;
            }
            Some(t) => {
                let entry = self.cond.entry(t).or_insert((0, 0));
                entry.0 += units;
                entry.1 += 1;
            }
        }
    }

    fn remove_from_tally(&mut self, units: u32, threshold: Option<u32>) {
        match threshold {
            None => {
                self.uncond_units -= units;
                self.uncond_count -= 1;
            }
            Some(t) => {
                let entry = self.cond.get_mut(&t).unwrap_or_else(|| env::panic_str("Tally corrupted"));
                entry.0 -= units;
                entry.1 -= 1;
                if entry.1 == 0 {
                    self.cond.remove(&t);
                }
            }
        }
    }

    /// Runs the pure resolver over the pool's tally (members with equal thresholds are
    /// always in or out together, so grouping is exact) and prices the result.
    pub fn evaluate(&self, tiers: &[Tier]) -> Evaluation {
        let mut entries: Vec<(u32, Option<u32>)> = Vec::with_capacity(self.cond.len() + 1);
        let mut counts: Vec<u32> = Vec::with_capacity(self.cond.len() + 1);
        if self.uncond_count > 0 {
            entries.push((self.uncond_units, None));
            counts.push(self.uncond_count);
        }
        for (threshold, (units, count)) in &self.cond {
            entries.push((*units, Some(*threshold)));
            counts.push(*count);
        }
        let (included, units) = resolve(&entries);
        let mut members_in = 0;
        let mut cutoff = 0;
        for (i, flag) in included.iter().enumerate() {
            if *flag {
                members_in += counts[i];
                if let Some(t) = entries[i].1 {
                    cutoff = cutoff.max(t);
                }
            }
        }
        Evaluation { units, members_in, cutoff, tier: price_for(tiers, units) }
    }

    /// Position of `agent_id` in join order.
    fn position(&self, agent_id: &AccountId) -> Option<u32> {
        (0..self.members.len()).find(|i| self.members.get(*i) == Some(agent_id))
    }

    /// Removes a member keeping join order for everyone else.
    fn remove_member(&mut self, agent_id: &AccountId) -> Membership {
        let index = self.position(agent_id).unwrap_or_else(|| env::panic_str("Not a member"));
        let last = self.members.len() - 1;
        for i in index..last {
            let next = self.members.get(i + 1).cloned().unwrap_or_else(|| env::panic_str("Index"));
            self.members.set(i, next);
        }
        self.members.pop();
        self.memberships.remove(agent_id).unwrap_or_else(|| env::panic_str("Not a member"))
    }
}

#[near]
impl Coop {
    /// Called by a registered agent (works with a zero-deposit function-call key).
    /// Locks `units * lock_price + STORAGE_RESERVE` from the agent's budget.
    pub fn join_pool(
        &mut self,
        pool_id: u64,
        units: u32,
        threshold_units: Option<u32>,
        memo: Option<String>,
    ) {
        let agent_id = env::predecessor_account_id();
        let now = now_ns();
        let memo = memo.unwrap_or_default();
        require!(units > 0, "units must be positive");
        require!(threshold_units != Some(0), "threshold_units must be positive");
        require!(memo.chars().count() <= MAX_MEMO_CHARS, "memo is longer than 140 characters");

        let offer = self.offers.get(&pool_id).unwrap_or_else(|| env::panic_str("Pool not found"));
        require!(offer.status == OfferStatus::Open, "Offer is not open");
        require!(now < offer.lock_at_ns(), "Pool is locked");
        let lock = lock_price(&offer.tiers, threshold_units);
        let max_units = offer.max_units;
        let seller = offer.seller.clone();

        let mut agent = self
            .agents
            .get(&agent_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str("Caller is not a registered agent"));
        if let Some(expires) = agent.limits.expires_at_ns {
            require!(now < expires.0, "Agent has expired");
        }
        if let Some(allowed) = &agent.limits.allowed_sellers {
            require!(allowed.contains(&seller), "Seller is not in the agent's allowed_sellers");
        }
        require!(units <= agent.limits.max_units_per_pool, "units exceeds max_units_per_pool");
        require!(lock <= agent.limits.max_unit_price.0, "Lock price exceeds max_unit_price");

        let before = env::storage_usage();
        let pool = self.pools.get_mut(&pool_id).unwrap_or_else(|| env::panic_str("Pool not found"));
        require!(pool.phase == PoolPhase::Active, "Pool is not accepting members");
        require!(pool.memberships.get(&agent_id).is_none(), "Already a member of this pool");
        require!(pool.member_count() < MAX_MEMBERS, "Pool is full");
        require!(
            u64::from(pool.total_units()) + u64::from(units) <= u64::from(max_units),
            "Pool units would exceed max_units"
        );

        let locked = u128::from(units)
            .checked_mul(lock)
            .and_then(|v| v.checked_add(STORAGE_RESERVE))
            .unwrap_or_else(|| env::panic_str("Lock overflow"));
        require!(agent.budget_available >= locked, "Insufficient budget to lock");

        pool.add_to_tally(units, threshold_units);
        pool.members.push(agent_id.clone());
        pool.memberships.insert(
            agent_id.clone(),
            Membership {
                units,
                threshold_units,
                locked,
                storage_fee: 0,
                memo: memo.clone(),
                joined_at_ns: now,
                outcome: None,
                paid: None,
                refunded: None,
                delivery: None,
            },
        );
        agent.active_pools.push(pool_id);
        self.agents.insert(agent_id.clone(), agent);

        // Measure what this join added to storage (membership, tally, agent record).
        self.agents.flush();
        self.flush_pool(pool_id);
        let fee = storage_cost(before, env::storage_usage());

        let agent = self.agents.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("Agent"));
        require!(
            agent.budget_available >= locked + fee,
            "Insufficient budget to lock and pay membership storage"
        );
        agent.budget_available -= locked + fee;
        agent.budget_locked += locked;
        let pool = self.pools.get_mut(&pool_id).unwrap_or_else(|| env::panic_str("Pool"));
        let membership = pool.memberships.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("Member"));
        membership.storage_fee = fee;

        events::pool_joined(pool_id, &agent_id, units, threshold_units, locked, &memo);
    }

    /// Before the lock time only. Lock and membership storage return to the budget.
    pub fn leave_pool(&mut self, pool_id: u64) {
        let agent_id = env::predecessor_account_id();
        let offer = self.offers.get(&pool_id).unwrap_or_else(|| env::panic_str("Pool not found"));
        require!(now_ns() < offer.lock_at_ns(), "Pool is locked");
        let pool = self.pools.get_mut(&pool_id).unwrap_or_else(|| env::panic_str("Pool not found"));
        require!(pool.phase == PoolPhase::Active, "Pool is not accepting changes");
        require!(pool.memberships.get(&agent_id).is_some(), "Not a member of this pool");
        let membership = pool.remove_member(&agent_id);
        pool.remove_from_tally(membership.units, membership.threshold_units);

        let agent = self.agents.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("Agent not found"));
        let released = membership.locked + membership.storage_fee;
        agent.budget_locked -= membership.locked;
        agent.budget_available += released;
        agent.active_pools.retain(|p| *p != pool_id);
        events::pool_left(pool_id, &agent_id, released);
    }
}
