//! Read-only views (SPEC 1.2) and the view structs.

use crate::agent::{AgentLimits, ClaimableView};
use crate::offer::{Offer, OfferStatus, Tier};
use crate::pool::{Delivery, Outcome, Pool, PoolPhase};
use crate::settle::SettlementResult;
use crate::*;

pub const DEFAULT_POOL_PAGE: u32 = 20;
pub const MAX_POOL_PAGE: u32 = 50;
pub const DEFAULT_MEMBER_PAGE: u32 = 50;
pub const MAX_MEMBER_PAGE: u32 = 100;
pub const DEFAULT_AGENT_PAGE: u32 = 50;
pub const MAX_AGENT_PAGE: u32 = 100;

#[near(serializers = [json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PoolStatus {
    AwaitingInventory,
    Open,
    Locked,
    Expired,
    Settling,
    Settled,
    Refunded,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OfferView {
    pub id: u64,
    pub seller: AccountId,
    pub item_token: AccountId,
    pub title: String,
    pub description: String,
    pub tiers: Vec<Tier>,
    pub max_units: u32,
    pub unit_amount: U128,
    pub inventory_held: U128,
    pub deadline_ns: U64,
    pub lock_window_ns: U64,
    pub lock_at_ns: U64,
    pub status: OfferStatus,
    pub created_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Projection {
    pub units: u32,
    pub members_in: u32,
    pub tier_index: Option<u32>,
    pub unit_price: Option<U128>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PoolView {
    pub id: u64,
    pub offer: OfferView,
    pub status: PoolStatus,
    pub member_count: u32,
    pub units_unconditional: u32,
    pub units_conditional: u32,
    pub projected: Projection,
    pub result: Option<SettlementResult>,
    pub settle_cursor: u32,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MemberView {
    pub agent_id: AccountId,
    pub owner: AccountId,
    pub units: u32,
    pub threshold_units: Option<u32>,
    pub locked: U128,
    pub memo: String,
    pub joined_at_ns: U64,
    pub projected_in: bool,
    pub outcome: Option<Outcome>,
    pub paid: Option<U128>,
    pub refunded: Option<U128>,
    pub delivery: Option<Delivery>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentView {
    pub agent_id: AccountId,
    pub owner: AccountId,
    pub budget_available: U128,
    pub budget_locked: U128,
    pub limits: AgentLimits,
    pub active_pools: Vec<u64>,
    pub registered_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StatsView {
    pub offers: u64,
    pub pools_settled: u64,
    pub pools_refunded: u64,
    pub agents: u64,
    pub volume: U128,
    pub units_delivered: u64,
}

/// Public status: stored phase combined with the clock.
pub fn pool_status(pool: &Pool, offer: &Offer, now: u64) -> PoolStatus {
    match pool.phase {
        PoolPhase::Settling => PoolStatus::Settling,
        PoolPhase::Settled => PoolStatus::Settled,
        PoolPhase::Refunded => PoolStatus::Refunded,
        PoolPhase::Active => {
            if now >= offer.deadline_ns {
                PoolStatus::Expired
            } else if offer.status == OfferStatus::AwaitingInventory {
                PoolStatus::AwaitingInventory
            } else if now >= offer.lock_at_ns() {
                PoolStatus::Locked
            } else {
                PoolStatus::Open
            }
        }
    }
}

fn offer_view(offer: &Offer) -> OfferView {
    OfferView {
        id: offer.id,
        seller: offer.seller.clone(),
        item_token: offer.item_token.clone(),
        title: offer.title.clone(),
        description: offer.description.clone(),
        tiers: offer.tiers.clone(),
        max_units: offer.max_units,
        unit_amount: U128(offer.unit_amount),
        inventory_held: U128(offer.inventory_held),
        deadline_ns: U64(offer.deadline_ns),
        lock_window_ns: U64(offer.lock_window_ns),
        lock_at_ns: U64(offer.lock_at_ns()),
        status: offer.status,
        created_at_ns: U64(offer.created_at_ns),
    }
}

fn projection(pool: &Pool, offer: &Offer) -> Projection {
    if let Some(result) = &pool.result {
        return Projection {
            units: result.units,
            members_in: result.members_in,
            tier_index: result.tier_index,
            unit_price: result.unit_price,
        };
    }
    let evaluation = pool.evaluate(&offer.tiers);
    Projection {
        units: evaluation.units,
        members_in: evaluation.members_in,
        tier_index: evaluation.tier.map(|(index, _)| index as u32),
        unit_price: evaluation.tier.map(|(_, price)| U128(price)),
    }
}

fn agent_view(agent_id: &AccountId, agent: &crate::agent::AgentRecord) -> AgentView {
    AgentView {
        agent_id: agent_id.clone(),
        owner: agent.owner.clone(),
        budget_available: U128(agent.budget_available),
        budget_locked: U128(agent.budget_locked),
        limits: agent.limits.clone(),
        active_pools: agent.active_pools.clone(),
        registered_at_ns: U64(agent.registered_at_ns),
    }
}

impl Coop {
    fn pool_view(&self, pool_id: u64, now: u64) -> Option<PoolView> {
        let pool = self.pools.get(&pool_id)?;
        let offer = self.offers.get(&pool_id)?;
        Some(PoolView {
            id: pool_id,
            offer: offer_view(offer),
            status: pool_status(pool, offer, now),
            member_count: pool.member_count(),
            units_unconditional: pool.uncond_units,
            units_conditional: pool.units_conditional(),
            projected: projection(pool, offer),
            result: pool.result.clone(),
            settle_cursor: pool.settle_cursor,
        })
    }
}

#[near]
impl Coop {
    pub fn get_offer(&self, offer_id: u64) -> Option<OfferView> {
        self.offers.get(&offer_id).map(offer_view)
    }

    pub fn get_pool(&self, pool_id: u64) -> Option<PoolView> {
        self.pool_view(pool_id, now_ns())
    }

    /// Newest first.
    pub fn list_pools(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<PoolView> {
        let now = now_ns();
        let skip = u64::from(from_index.unwrap_or(0));
        let limit = limit.unwrap_or(DEFAULT_POOL_PAGE).min(MAX_POOL_PAGE) as usize;
        (1..self.next_id)
            .rev()
            .skip(skip as usize)
            .take(limit)
            .filter_map(|id| self.pool_view(id, now))
            .collect()
    }

    /// Members in join order.
    pub fn get_pool_members(
        &self,
        pool_id: u64,
        from_index: Option<u32>,
        limit: Option<u32>,
    ) -> Vec<MemberView> {
        let pool = self.pool(pool_id);
        let offer = self.offer(pool_id);
        let evaluation = pool.evaluate(&offer.tiers);
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(DEFAULT_MEMBER_PAGE).min(MAX_MEMBER_PAGE);
        let end = from.saturating_add(limit).min(pool.members.len());
        (from..end)
            .filter_map(|i| {
                let agent_id = pool.members.get(i)?;
                let m = pool.memberships.get(agent_id)?;
                let owner = self.agents.get(agent_id).map(|a| a.owner.clone())?;
                let projected_in = if pool.result.is_some() {
                    m.outcome == Some(Outcome::Filled)
                } else {
                    evaluation.tier.is_some() && evaluation.includes(m.threshold_units)
                };
                Some(MemberView {
                    agent_id: agent_id.clone(),
                    owner,
                    units: m.units,
                    threshold_units: m.threshold_units,
                    locked: U128(m.locked),
                    memo: m.memo.clone(),
                    joined_at_ns: U64(m.joined_at_ns),
                    projected_in,
                    outcome: m.outcome,
                    paid: m.paid.map(U128),
                    refunded: m.refunded.map(U128),
                    delivery: m.delivery,
                })
            })
            .collect()
    }

    /// What `settle` would do right now (the frozen result once resolved).
    pub fn projected_price(&self, pool_id: u64) -> Projection {
        projection(self.pool(pool_id), self.offer(pool_id))
    }

    pub fn get_agent(&self, agent_id: AccountId) -> Option<AgentView> {
        self.agents.get(&agent_id).map(|agent| agent_view(&agent_id, agent))
    }

    pub fn list_agents(&self, from_index: Option<u32>, limit: Option<u32>) -> Vec<AgentView> {
        let limit = limit.unwrap_or(DEFAULT_AGENT_PAGE).min(MAX_AGENT_PAGE) as usize;
        self.agents
            .iter()
            .skip(from_index.unwrap_or(0) as usize)
            .take(limit)
            .map(|(id, agent)| agent_view(id, agent))
            .collect()
    }

    pub fn get_claimable(&self, agent_id: AccountId) -> Vec<ClaimableView> {
        self.claimable
            .get(&agent_id)
            .map(|entries| {
                entries
                    .iter()
                    .filter(|e| e.amount > 0)
                    .map(|e| ClaimableView { token: e.token.clone(), amount: U128(e.amount) })
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn get_stats(&self) -> StatsView {
        StatsView {
            offers: self.next_id - 1,
            pools_settled: self.stats.pools_settled,
            pools_refunded: self.stats.pools_refunded,
            agents: u64::from(self.agents.len()),
            volume: U128(self.stats.volume),
            units_delivered: self.stats.units_delivered,
        }
    }
}
