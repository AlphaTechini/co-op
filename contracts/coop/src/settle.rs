//! Resolution and chunked settlement.
//!
//! `settle(pool_id, max_members)` may be called repeatedly after the deadline:
//! 1. the first call resolves the pool (greatest fixed point, see [`resolve`]) and fixes
//!    the tier price;
//! 2. each call processes the next chunk of members from the cursor, sized by
//!    `max_members` and by the gas left in the call;
//! 3. the call that has processed the last member (and has gas left) pays the seller and
//!    returns unsold inventory. If the last chunk used up the gas, one more call finishes.

use near_sdk::serde_json::json;

use crate::agent::{add_claimable, delivery_promise};
use crate::offer::{Offer, OfferStatus};
use crate::pool::{Delivery, Outcome, Pool, PoolPhase};
use crate::views::{pool_status, PoolStatus};
use crate::*;

/// Members processed per `settle` call when `max_members` is not given. Further limited
/// by the gas left in the call.
pub const DEFAULT_CHUNK: u32 = 10;

/// Static gas attached to each promise of a filled member's delivery.
pub const STORAGE_DEPOSIT_GAS: Gas = Gas::from_tgas(6);
pub const FT_TRANSFER_GAS: Gas = Gas::from_tgas(6);
pub const CALLBACK_GAS: Gas = Gas::from_tgas(6);

/// First-member estimate of the gas a filled member consumes inside `settle` (attached
/// gas plus receipt fees plus our own storage work). Replaced by the observed maximum
/// after the first filled member of a call.
const FILLED_MEMBER_ESTIMATE: Gas = Gas::from_tgas(40);
/// Gas an excluded/refunded member consumes (no promises).
const EXCLUDED_MEMBER_ESTIMATE: Gas = Gas::from_tgas(6);
/// Gas kept back for the finish step (seller transfer, unsold `ft_transfer`, callback).
const FINISH_RESERVE: Gas = Gas::from_tgas(35);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettlementResult {
    pub units: u32,
    pub members_in: u32,
    pub tier_index: Option<u32>,
    pub unit_price: Option<U128>,
    pub seller_payout: U128,
    pub resolved_at_ns: U64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SettleProgress {
    pub status: PoolStatus,
    /// Members processed so far (the settlement cursor).
    pub processed: u32,
    /// Members still to process.
    pub remaining: u32,
}

/// Pure resolver. Input: `(units, threshold)` per member, where a threshold means "only
/// if the group totals at least this many units (counting my own)". Output: which members
/// are in, and the group's total units.
///
/// The group is the largest set of members whose conditions all hold. Start with
/// everyone; while the highest remaining threshold exceeds the total, drop that member.
/// The union of two consistent sets is consistent, so this greatest fixed point is
/// unique and maximal.
pub fn resolve(members: &[(u32, Option<u32>)]) -> (Vec<bool>, u32) {
    let mut included = vec![true; members.len()];
    let mut total: u64 = members.iter().map(|(units, _)| u64::from(*units)).sum();
    let mut conditional: Vec<usize> =
        (0..members.len()).filter(|i| members[*i].1.is_some()).collect();
    conditional.sort_by(|a, b| members[*b].1.cmp(&members[*a].1));
    for i in conditional {
        let threshold = members[i].1.unwrap_or(0);
        if u64::from(threshold) > total {
            included[i] = false;
            total -= u64::from(members[i].0);
        } else {
            break;
        }
    }
    (included, u32::try_from(total).unwrap_or(u32::MAX))
}

impl Pool {
    /// First settle call: resolve and freeze the result.
    fn start_settlement(&mut self, offer: &Offer, now: u64) {
        let evaluation = self.evaluate(&offer.tiers);
        self.cutoff = evaluation.cutoff;
        let result = match evaluation.tier {
            Some((index, price)) => SettlementResult {
                units: evaluation.units,
                members_in: evaluation.members_in,
                tier_index: Some(index as u32),
                unit_price: Some(U128(price)),
                seller_payout: U128(u128::from(evaluation.units) * price),
                resolved_at_ns: U64(now),
            },
            None => SettlementResult {
                units: 0,
                members_in: 0,
                tier_index: None,
                unit_price: None,
                seller_payout: U128(0),
                resolved_at_ns: U64(now),
            },
        };
        events::pool_resolved(
            self.id,
            result.units,
            result.members_in,
            result.tier_index,
            result.unit_price.map(|p| p.0),
        );
        self.result = Some(result);
        self.phase = PoolPhase::Settling;
    }
}

/// Settles one member: moves budget, records the outcome and, for filled members, sends
/// the delivery batch. Returns true if the member was filled.
fn settle_member(
    pool: &mut Pool,
    offer: &Offer,
    agents: &mut near_sdk::store::IterableMap<AccountId, agent::AgentRecord>,
    index: u32,
) -> bool {
    let pool_id = pool.id;
    let unit_price = pool.result.as_ref().and_then(|r| r.unit_price).map(|p| p.0);
    let cutoff = pool.cutoff;
    let agent_id = pool
        .members
        .get(index)
        .cloned()
        .unwrap_or_else(|| env::panic_str("Settlement cursor out of range"));
    let membership = pool
        .memberships
        .get_mut(&agent_id)
        .unwrap_or_else(|| env::panic_str("Membership missing"));
    let agent = agents.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("Agent missing"));
    agent.budget_locked -= membership.locked;
    agent.active_pools.retain(|p| *p != pool_id);

    match unit_price {
        Some(price) if membership.threshold_units.is_none_or(|t| t <= cutoff) => {
            let paid = u128::from(membership.units) * price;
            let refunded = membership.locked - paid - STORAGE_RESERVE;
            agent.budget_available += refunded;
            membership.outcome = Some(Outcome::Filled);
            membership.paid = Some(paid);
            membership.refunded = Some(refunded);
            membership.delivery = Some(Delivery::Pending);
            let amount = u128::from(membership.units) * offer.unit_amount;
            events::member_filled(pool_id, &agent_id, membership.units, paid, refunded);
            delivery_promise(
                &offer.item_token,
                &agent_id,
                amount,
                &format!("co-op pool {pool_id}"),
                STORAGE_DEPOSIT_GAS,
                FT_TRANSFER_GAS,
            )
            .then(
                Coop::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_delivered(pool_id, agent_id, U128(amount)),
            )
            .detach();
            true
        }
        _ => {
            agent.budget_available += membership.locked;
            membership.outcome =
                Some(if unit_price.is_some() { Outcome::Excluded } else { Outcome::Refunded });
            membership.paid = Some(0);
            membership.refunded = Some(membership.locked);
            events::member_excluded(pool_id, &agent_id, membership.locked);
            false
        }
    }
}

/// Last step: pay the seller, return unsold inventory, close the offer.
fn finish(offer: &mut Offer, pool: &mut Pool, stats: &mut Stats) {
    let pool_id = pool.id;
    let result = pool.result.clone().unwrap_or_else(|| env::panic_str("Pool not resolved"));
    let payout = result.seller_payout.0;
    if payout > 0 {
        Promise::new(offer.seller.clone()).transfer(yocto(payout)).detach();
        events::seller_paid(pool_id, &offer.seller, payout);
    }
    let sold = u128::from(result.units) * offer.unit_amount;
    let unsold = offer.inventory_held.saturating_sub(sold);
    if unsold > 0 {
        Promise::new(offer.item_token.clone())
            .function_call(
                "ft_transfer".to_string(),
                json!({
                    "receiver_id": offer.seller,
                    "amount": unsold.to_string(),
                    "memo": format!("co-op pool {pool_id} unsold inventory"),
                })
                .to_string()
                .into_bytes(),
                NearToken::from_yoctonear(1),
                FT_TRANSFER_GAS,
            )
            .then(
                Coop::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_inventory_returned(pool_id, offer.seller.clone(), U128(unsold)),
            )
            .detach();
    }
    offer.inventory_held = 0;
    offer.status = OfferStatus::Closed;
    stats.volume += payout;
    if result.tier_index.is_some() {
        pool.phase = PoolPhase::Settled;
        stats.pools_settled += 1;
        events::pool_settled(pool_id);
    } else {
        pool.phase = PoolPhase::Refunded;
        stats.pools_refunded += 1;
        events::pool_refunded(pool_id);
    }
}

#[near]
impl Coop {
    /// Permissionless. Only at/after the deadline. Chunked and idempotent; call until
    /// the returned status is `Settled` or `Refunded`.
    pub fn settle(&mut self, pool_id: u64, max_members: Option<u32>) -> SettleProgress {
        let now = now_ns();
        let Coop { offers, pools, agents, stats, .. } = self;
        let offer = offers.get_mut(&pool_id).unwrap_or_else(|| env::panic_str("Pool not found"));
        let pool = pools.get_mut(&pool_id).unwrap_or_else(|| env::panic_str("Pool not found"));
        require!(now >= offer.deadline_ns, "Deadline has not passed");

        if pool.phase == PoolPhase::Active {
            pool.start_settlement(offer, now);
        }
        if matches!(pool.phase, PoolPhase::Settling) {
            let length = pool.members.len();
            let has_tier = pool.result.as_ref().is_some_and(|r| r.tier_index.is_some());
            let limit = max_members.unwrap_or(DEFAULT_CHUNK).max(1);
            let mut filled_estimate = FILLED_MEMBER_ESTIMATE;
            let mut processed_now = 0u32;
            while processed_now < limit && pool.settle_cursor < length {
                let required = if has_tier { filled_estimate } else { EXCLUDED_MEMBER_ESTIMATE };
                if gas_left() < required.saturating_add(FINISH_RESERVE) {
                    break;
                }
                let gas_before = env::used_gas();
                let index = pool.settle_cursor;
                let filled = settle_member(pool, offer, agents, index);
                pool.settle_cursor += 1;
                processed_now += 1;
                if filled {
                    let spent = env::used_gas().saturating_sub(gas_before);
                    if processed_now == 1 || spent > filled_estimate {
                        filled_estimate = spent;
                    }
                }
            }
            require!(
                processed_now > 0 || (pool.settle_cursor >= length && gas_left() >= FINISH_RESERVE),
                "Attach more gas to settle"
            );
            if pool.settle_cursor == length && gas_left() >= FINISH_RESERVE {
                finish(offer, pool, stats);
            }
        }
        SettleProgress {
            status: pool_status(pool, offer, now),
            processed: pool.settle_cursor,
            remaining: pool.members.len() - pool.settle_cursor,
        }
    }

    /// Callback of a member's delivery batch (`storage_deposit` + `ft_transfer`). Any
    /// failure makes the delivery `Claimable`: the units stay held by this contract.
    #[private]
    pub fn on_delivered(&mut self, pool_id: u64, agent_id: AccountId, amount: U128) {
        let delivered = promise_succeeded();
        let token = self.offer(pool_id).item_token.clone();
        let Coop { pools, claimable, stats, .. } = self;
        let membership = pools
            .get_mut(&pool_id)
            .and_then(|pool| pool.memberships.get_mut(&agent_id))
            .unwrap_or_else(|| env::panic_str("Membership missing"));
        if delivered {
            membership.delivery = Some(Delivery::Delivered);
            stats.units_delivered += u64::from(membership.units);
        } else {
            membership.delivery = Some(Delivery::Claimable);
            add_claimable(claimable, &agent_id, &token, amount.0, &[pool_id]);
            events::delivery_failed(pool_id, &agent_id, &token, amount.0);
        }
    }

    /// Callback of the unsold-inventory return. On failure the seller can `claim` it.
    #[private]
    pub fn on_inventory_returned(&mut self, pool_id: u64, seller: AccountId, amount: U128) {
        if !promise_succeeded() {
            let token = self.offer(pool_id).item_token.clone();
            add_claimable(&mut self.claimable, &seller, &token, amount.0, &[]);
            events::delivery_failed(pool_id, &seller, &token, amount.0);
        }
    }
}
