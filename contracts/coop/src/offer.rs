//! Offers: price tiers, inventory deposits (`ft_on_transfer`) and `improve_offer`.

use near_sdk::serde::Deserialize;

use crate::*;

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Tier {
    pub min_units: u32,
    pub unit_price: U128,
}

#[near(serializers = [json, borsh])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OfferStatus {
    AwaitingInventory,
    Open,
    Closed,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Offer {
    pub id: u64,
    pub seller: AccountId,
    pub item_token: AccountId,
    pub title: String,
    pub description: String,
    pub tiers: Vec<Tier>,
    pub max_units: u32,
    /// Item-token base units per unit.
    pub unit_amount: u128,
    pub inventory_held: u128,
    pub deadline_ns: u64,
    pub lock_window_ns: u64,
    pub status: OfferStatus,
    pub created_at_ns: u64,
}

impl Offer {
    /// Membership freezes at this timestamp.
    pub fn lock_at_ns(&self) -> u64 {
        self.deadline_ns - self.lock_window_ns
    }

    /// Inventory (in token base units) needed before the offer opens.
    pub fn required_inventory(&self) -> u128 {
        u128::from(self.max_units) * self.unit_amount
    }
}

/// Validates a tier ladder (SPEC 1.1). Panics with a reason on failure.
pub fn validate_tiers(tiers: &[Tier], max_units: u32) {
    require!(!tiers.is_empty(), "At least one tier is required");
    require!(tiers.len() <= MAX_TIERS, "At most 8 tiers are allowed");
    require!(tiers[0].min_units >= 1, "First tier min_units must be >= 1");
    for pair in tiers.windows(2) {
        require!(pair[1].min_units > pair[0].min_units, "Tier min_units must be strictly ascending");
        require!(
            pair[1].unit_price.0 < pair[0].unit_price.0,
            "Tier unit_price must be strictly descending"
        );
    }
    let last = &tiers[tiers.len() - 1];
    require!(last.min_units <= max_units, "Last tier min_units must be <= max_units");
    require!(last.unit_price.0 > 0, "Tier unit_price must be positive");
    require!(
        tiers[0].unit_price.0.checked_mul(u128::from(max_units)).is_some(),
        "Tier unit_price too large"
    );
}

/// Best tier reached by `total` units: the last tier with `min_units <= total`.
/// Returns `(tier index, unit price)` or `None` if even the first tier is out of reach.
pub fn price_for(tiers: &[Tier], total: u32) -> Option<(usize, u128)> {
    tiers
        .iter()
        .enumerate()
        .rev()
        .find(|(_, tier)| tier.min_units <= total)
        .map(|(index, tier)| (index, tier.unit_price.0))
}

/// Price an agent locks per unit: unconditional members lock the entry tier; a
/// conditional member with threshold T locks the price of the best tier with
/// `min_units <= T` (the entry tier if none).
pub fn lock_price(tiers: &[Tier], threshold: Option<u32>) -> u128 {
    match threshold {
        None => tiers[0].unit_price.0,
        Some(t) => price_for(tiers, t).map_or(tiers[0].unit_price.0, |(_, price)| price),
    }
}

/// True if for every total `t` in `1..=max_units` the new price is no higher than the
/// old price (an undefined old price counts as infinity). Both price functions are step
/// functions, so checking at every breakpoint of either ladder is exhaustive.
pub fn is_improvement(old: &[Tier], new: &[Tier], max_units: u32) -> bool {
    old.iter().chain(new.iter()).map(|tier| tier.min_units).filter(|t| *t <= max_units).all(|t| {
        match price_for(old, t) {
            None => true,
            Some((_, old_price)) => {
                matches!(price_for(new, t), Some((_, new_price)) if new_price <= old_price)
            }
        }
    })
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde")]
struct DepositMsg {
    offer_id: u64,
}

/// Bytes a tier occupies in storage; `create_offer` reserves room for a full ladder so
/// `improve_offer` never needs a deposit to grow it.
const TIER_BYTES: u64 = 4 + 16;

#[near]
impl Coop {
    /// Creates an offer and its pool. The attached deposit covers storage; the excess is
    /// refunded. Returns the id (`pool_id == offer_id`).
    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn create_offer(
        &mut self,
        item_token: AccountId,
        title: String,
        description: String,
        tiers: Vec<Tier>,
        max_units: u32,
        unit_amount: U128,
        deadline_ns: U64,
        lock_window_ns: U64,
    ) -> u64 {
        let seller = env::predecessor_account_id();
        let now = now_ns();
        require!(title.chars().count() <= MAX_TITLE_CHARS, "Title is longer than 64 characters");
        require!(
            description.chars().count() <= MAX_DESCRIPTION_CHARS,
            "Description is longer than 280 characters"
        );
        require!((1..=MAX_UNITS).contains(&max_units), "max_units must be in 1..=10000");
        require!(unit_amount.0 > 0, "unit_amount must be positive");
        require!(
            unit_amount.0.checked_mul(u128::from(max_units)).is_some(),
            "unit_amount too large"
        );
        validate_tiers(&tiers, max_units);
        require!(
            deadline_ns.0 > now.saturating_add(lock_window_ns.0),
            "deadline must be later than now + lock_window"
        );

        let spare_tiers = (MAX_TIERS - tiers.len()) as u64;
        let tier_reserve = u128::from(spare_tiers * TIER_BYTES)
            * env::storage_byte_cost().as_yoctonear();

        let before = env::storage_usage();
        let id = self.next_id;
        self.next_id += 1;
        self.offers.insert(
            id,
            Offer {
                id,
                seller: seller.clone(),
                item_token: item_token.clone(),
                title,
                description,
                tiers,
                max_units,
                unit_amount: unit_amount.0,
                inventory_held: 0,
                deadline_ns: deadline_ns.0,
                lock_window_ns: lock_window_ns.0,
                status: OfferStatus::AwaitingInventory,
                created_at_ns: now,
            },
        );
        self.pools.insert(id, Pool::new(id));
        self.offers.flush();
        self.flush_pool(id);
        let cost = storage_cost(before, env::storage_usage()) + tier_reserve;

        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= cost, format!("Attached deposit must cover storage: {cost} yoctoNEAR"));
        if deposit > cost {
            Promise::new(seller.clone()).transfer(yocto(deposit - cost)).detach();
        }
        events::offer_created(id, &seller, &item_token, max_units, deadline_ns.0);
        id
    }

    /// NEP-141 receiver: the seller deposits inventory with `msg = {"offer_id": N}`.
    /// Returns the amount NOT used (`"0"` when accepted, the full amount when rejected).
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let Ok(DepositMsg { offer_id }) = near_sdk::serde_json::from_str::<DepositMsg>(&msg) else {
            return amount;
        };
        let token = env::predecessor_account_id();
        let Some(offer) = self.offers.get_mut(&offer_id) else {
            return amount;
        };
        if token != offer.item_token || sender_id != offer.seller || offer.status == OfferStatus::Closed
        {
            return amount;
        }
        // Inventory is frozen once settlement has started.
        match self.pools.get(&offer_id) {
            Some(pool) if pool.phase == pool::PoolPhase::Active => {}
            _ => return amount,
        }
        let Some(held) = offer.inventory_held.checked_add(amount.0) else {
            return amount;
        };
        offer.inventory_held = held;
        events::inventory_deposited(offer_id, amount.0, held);
        if offer.status == OfferStatus::AwaitingInventory && held >= offer.required_inventory() {
            offer.status = OfferStatus::Open;
            events::offer_opened(offer_id);
        }
        U128(0)
    }

    /// Seller replaces the ladder with one that is at least as good for buyers at every
    /// possible total. Only before the lock time. Requires 1 yoctoNEAR.
    #[payable]
    pub fn improve_offer(&mut self, offer_id: u64, tiers: Vec<Tier>) {
        near_sdk::assert_one_yocto();
        let now = now_ns();
        let caller = env::predecessor_account_id();
        let offer = self.offers.get_mut(&offer_id).unwrap_or_else(|| env::panic_str("Offer not found"));
        require!(caller == offer.seller, "Only the seller can improve the offer");
        require!(offer.status != OfferStatus::Closed, "Offer is closed");
        require!(now < offer.lock_at_ns(), "Offer is locked");
        validate_tiers(&tiers, offer.max_units);
        require!(
            is_improvement(&offer.tiers, &tiers, offer.max_units),
            "New tiers must not be worse for buyers at any total"
        );
        offer.tiers = tiers;
        events::offer_improved(offer_id, &offer.tiers);
    }
}
