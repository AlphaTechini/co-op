//! NEP-297 events. Every event is `EVENT_JSON:{"standard":"coop","version":"1.0.0",...}`.

use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

use crate::offer::Tier;

pub const STANDARD: &str = "coop";
pub const VERSION: &str = "1.0.0";

fn emit(event: &str, data: Value) {
    let payload = json!({
        "standard": STANDARD,
        "version": VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{payload}"));
}

pub fn offer_created(
    offer_id: u64,
    seller: &AccountId,
    item_token: &AccountId,
    max_units: u32,
    deadline_ns: u64,
) {
    emit(
        "offer_created",
        json!({
            "offer_id": offer_id,
            "seller": seller,
            "item_token": item_token,
            "max_units": max_units,
            "deadline_ns": deadline_ns.to_string(),
        }),
    );
}

pub fn inventory_deposited(offer_id: u64, amount: u128, inventory_held: u128) {
    emit(
        "inventory_deposited",
        json!({
            "offer_id": offer_id,
            "amount": amount.to_string(),
            "inventory_held": inventory_held.to_string(),
        }),
    );
}

pub fn offer_opened(offer_id: u64) {
    emit("offer_opened", json!({ "offer_id": offer_id }));
}

pub fn offer_improved(offer_id: u64, tiers: &[Tier]) {
    emit("offer_improved", json!({ "offer_id": offer_id, "tiers": tiers }));
}

pub fn agent_registered(agent_id: &AccountId, owner: &AccountId, budget: u128) {
    emit(
        "agent_registered",
        json!({ "agent_id": agent_id, "owner": owner, "budget": budget.to_string() }),
    );
}

pub fn agent_funded(agent_id: &AccountId, amount: u128) {
    emit("agent_funded", json!({ "agent_id": agent_id, "amount": amount.to_string() }));
}

pub fn agent_withdrew(agent_id: &AccountId, amount: u128) {
    emit("agent_withdrew", json!({ "agent_id": agent_id, "amount": amount.to_string() }));
}

pub fn pool_joined(
    pool_id: u64,
    agent_id: &AccountId,
    units: u32,
    threshold_units: Option<u32>,
    locked: u128,
    memo: &str,
) {
    emit(
        "pool_joined",
        json!({
            "pool_id": pool_id,
            "agent_id": agent_id,
            "units": units,
            "threshold_units": threshold_units,
            "locked": locked.to_string(),
            "memo": memo,
        }),
    );
}

pub fn pool_left(pool_id: u64, agent_id: &AccountId, released: u128) {
    emit(
        "pool_left",
        json!({ "pool_id": pool_id, "agent_id": agent_id, "released": released.to_string() }),
    );
}

pub fn pool_resolved(
    pool_id: u64,
    units: u32,
    members_in: u32,
    tier_index: Option<u32>,
    unit_price: Option<u128>,
) {
    emit(
        "pool_resolved",
        json!({
            "pool_id": pool_id,
            "units": units,
            "members_in": members_in,
            "tier_index": tier_index,
            "unit_price": unit_price.map(|p| p.to_string()),
        }),
    );
}

pub fn member_filled(pool_id: u64, agent_id: &AccountId, units: u32, paid: u128, refunded: u128) {
    emit(
        "member_filled",
        json!({
            "pool_id": pool_id,
            "agent_id": agent_id,
            "units": units,
            "paid": paid.to_string(),
            "refunded": refunded.to_string(),
        }),
    );
}

/// Emitted for members left out of the group and for every member of a refunded pool.
pub fn member_excluded(pool_id: u64, agent_id: &AccountId, released: u128) {
    emit(
        "member_excluded",
        json!({ "pool_id": pool_id, "agent_id": agent_id, "released": released.to_string() }),
    );
}

pub fn delivery_failed(pool_id: u64, agent_id: &AccountId, token: &AccountId, amount: u128) {
    emit(
        "delivery_failed",
        json!({
            "pool_id": pool_id,
            "agent_id": agent_id,
            "token": token,
            "amount": amount.to_string(),
        }),
    );
}

pub fn seller_paid(pool_id: u64, seller: &AccountId, amount: u128) {
    emit(
        "seller_paid",
        json!({ "pool_id": pool_id, "seller": seller, "amount": amount.to_string() }),
    );
}

pub fn pool_settled(pool_id: u64) {
    emit("pool_settled", json!({ "pool_id": pool_id }));
}

pub fn pool_refunded(pool_id: u64) {
    emit("pool_refunded", json!({ "pool_id": pool_id }));
}
