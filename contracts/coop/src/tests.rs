//! Native unit tests. Every money path is exercised through the public contract API with
//! explicit control of block time, deposits, prepaid gas and promise results.

use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{testing_env, Gas, NearToken, PromiseResult};

use crate::agent::AgentLimits;
use crate::offer::{is_improvement, price_for, validate_tiers, Tier};
use crate::pool::{Delivery, Outcome};
use crate::settle::{resolve, SettleProgress, DEFAULT_CHUNK};
use crate::views::PoolStatus;
use crate::*;

const NEAR: u128 = 1_000_000_000_000_000_000_000_000;
const SEC: u64 = 1_000_000_000;
const T0: u64 = 100 * SEC;
const LOCK_AT: u64 = T0 + 900 * SEC;
const DEADLINE: u64 = T0 + 1000 * SEC;
const LOCK_WINDOW: u64 = 100 * SEC;
const TOKEN: &str = "credits.near";
const SELLER: &str = "seller.near";
const OWNER: &str = "owner.near";

fn acct(s: &str) -> AccountId {
    s.parse().unwrap()
}

fn ctx(pred: &str, deposit: u128, ts: u64) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(acct("coop.near"))
        .predecessor_account_id(acct(pred))
        .signer_account_id(acct(pred))
        .block_timestamp(ts)
        .attached_deposit(NearToken::from_yoctonear(deposit));
    b
}

fn set_env(pred: &str, deposit: u128, ts: u64) {
    testing_env!(ctx(pred, deposit, ts).build());
}

fn set_env_gas(pred: &str, ts: u64, tgas: u64) {
    let mut b = ctx(pred, 0, ts);
    b.prepaid_gas(Gas::from_tgas(tgas));
    testing_env!(b.build());
}

fn set_env_promise(pred: &str, deposit: u128, ts: u64, results: Vec<PromiseResult>) {
    testing_env!(
        ctx(pred, deposit, ts).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

fn tiers() -> Vec<Tier> {
    vec![
        Tier { min_units: 1, unit_price: U128(NEAR) },
        Tier { min_units: 20, unit_price: U128(7 * NEAR / 10) },
        Tier { min_units: 50, unit_price: U128(NEAR / 2) },
    ]
}

fn limits(max_price: u128, max_units: u32) -> AgentLimits {
    AgentLimits {
        max_unit_price: U128(max_price),
        max_units_per_pool: max_units,
        allowed_sellers: None,
        expires_at_ns: None,
    }
}

struct Fx {
    c: Coop,
    /// Sum of budgets credited to agents at registration (after storage costs).
    credited: u128,
}

impl Fx {
    fn new() -> Fx {
        // Fresh blockchain (empty storage) for every fixture.
        near_sdk::env::set_blockchain_interface(near_sdk::MockedBlockchain::new(
            ctx("coop.near", 0, T0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            vec![],
            Default::default(),
            Default::default(),
            None,
        ));
        Fx { c: Coop::new(), credited: 0 }
    }

    /// Creates an offer with the standard ladder and deposits full inventory.
    fn offer(&mut self, max_units: u32) -> u64 {
        let ladder = tiers().into_iter().filter(|t| t.min_units <= max_units).collect();
        let id = self.offer_no_inventory(max_units, ladder);
        self.deposit_inventory(id, max_units as u128);
        id
    }

    fn offer_no_inventory(&mut self, max_units: u32, tiers: Vec<Tier>) -> u64 {
        set_env(SELLER, NEAR, T0);
        self.c.create_offer(
            acct(TOKEN),
            "API credits".into(),
            "Demo voucher".into(),
            tiers,
            max_units,
            U128(1),
            U64(DEADLINE),
            U64(LOCK_WINDOW),
        )
    }

    fn deposit_inventory(&mut self, id: u64, amount: u128) -> U128 {
        set_env(TOKEN, 0, T0);
        self.c.ft_on_transfer(acct(SELLER), U128(amount), format!("{{\"offer_id\":{id}}}"))
    }

    fn agent(&mut self, name: &str, budget: u128, max_price: u128, max_units: u32) -> AccountId {
        let id = acct(&format!("{name}.{OWNER}"));
        set_env(OWNER, budget, T0);
        self.c.register_agent(id.clone(), limits(max_price, max_units));
        self.credited += self.c.get_agent(id.clone()).unwrap().budget_available.0;
        id
    }

    fn join(&mut self, agent: &AccountId, pool: u64, units: u32, threshold: Option<u32>) {
        self.join_at(agent, pool, units, threshold, T0 + SEC);
    }

    fn join_at(&mut self, agent: &AccountId, pool: u64, units: u32, threshold: Option<u32>, ts: u64) {
        set_env(agent.as_str(), 0, ts);
        self.c.join_pool(pool, units, threshold, Some(format!("{agent} joins")));
    }

    fn settle(&mut self, pool: u64, max: Option<u32>) -> SettleProgress {
        set_env("anyone.near", 0, DEADLINE);
        self.c.settle(pool, max)
    }

    fn settle_all(&mut self, pool: u64) -> (u32, SettleProgress) {
        let mut calls = 0;
        loop {
            let p = self.settle(pool, None);
            calls += 1;
            if matches!(p.status, PoolStatus::Settled | PoolStatus::Refunded) {
                return (calls, p);
            }
            assert!(calls < 100, "settlement did not finish");
        }
    }

    fn members(&self, pool: u64) -> Vec<views::MemberView> {
        self.c.get_pool_members(pool, None, Some(100))
    }

    fn agent_view(&self, id: &AccountId) -> views::AgentView {
        self.c.get_agent(id.clone()).unwrap()
    }
}

/// Sum of NEAR transferred to `who` in the receipts of the current call.
fn transferred_to(who: &str) -> u128 {
    get_created_receipts()
        .iter()
        .filter(|r| r.receiver_id.as_str() == who)
        .flat_map(|r| r.actions.iter())
        .map(|a| match a {
            MockAction::Transfer { deposit, .. } => deposit.as_yoctonear(),
            _ => 0,
        })
        .sum()
}

/// Arguments of every function call to `method` on `receiver` in the current call.
fn calls_to(receiver: &str, method: &str) -> Vec<String> {
    get_created_receipts()
        .iter()
        .filter(|r| r.receiver_id.as_str() == receiver)
        .flat_map(|r| r.actions.iter())
        .filter_map(|a| match a {
            MockAction::FunctionCallWeight { method_name, args, .. }
                if method_name.as_slice() == method.as_bytes() =>
            {
                Some(String::from_utf8(args.clone()).unwrap())
            }
            _ => None,
        })
        .collect()
}

/// Deterministic xorshift PRNG (no external dependency).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        self.0 = x;
        x
    }
    fn range(&mut self, lo: u32, hi_inclusive: u32) -> u32 {
        lo + (self.next() % u64::from(hi_inclusive - lo + 1)) as u32
    }
}

// ---------------------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------------------

#[test]
fn price_for_picks_best_reached_tier() {
    let t = tiers();
    assert_eq!(price_for(&t, 0), None);
    assert_eq!(price_for(&t, 1), Some((0, NEAR)));
    assert_eq!(price_for(&t, 19), Some((0, NEAR)));
    assert_eq!(price_for(&t, 20), Some((1, 7 * NEAR / 10)));
    assert_eq!(price_for(&t, 49), Some((1, 7 * NEAR / 10)));
    assert_eq!(price_for(&t, 50), Some((2, NEAR / 2)));
    assert_eq!(price_for(&t, 10_000), Some((2, NEAR / 2)));
    // A ladder whose first tier needs more than 1 unit has no price below it.
    let high = vec![Tier { min_units: 5, unit_price: U128(9) }];
    assert_eq!(price_for(&high, 4), None);
    assert_eq!(price_for(&high, 5), Some((0, 9)));
}

#[test]
fn lock_price_uses_threshold_tier() {
    let t = tiers();
    assert_eq!(offer::lock_price(&t, None), NEAR);
    assert_eq!(offer::lock_price(&t, Some(5)), NEAR);
    assert_eq!(offer::lock_price(&t, Some(20)), 7 * NEAR / 10);
    assert_eq!(offer::lock_price(&t, Some(75)), NEAR / 2);
}

#[test]
fn resolve_basic_cases() {
    assert_eq!(resolve(&[]), (vec![], 0));
    assert_eq!(resolve(&[(3, None), (4, None)]), (vec![true, true], 7));
    // Conditional on a total the group reaches: in.
    assert_eq!(resolve(&[(5, None), (3, Some(8))]), (vec![true, true], 8));
    // Conditional on more than anyone can supply: out.
    assert_eq!(resolve(&[(5, None), (3, Some(9))]), (vec![true, false], 5));
    // Two conditionals of 25 with threshold 50 support each other.
    assert_eq!(resolve(&[(25, Some(50)), (25, Some(50))]), (vec![true, true], 50));
    // Dropping the highest threshold can make a lower one fail too (cascade).
    assert_eq!(
        resolve(&[(10, None), (5, Some(15)), (6, Some(22))]),
        (vec![true, true, false], 15)
    );
    assert_eq!(
        resolve(&[(10, None), (5, Some(22)), (6, Some(22))]),
        (vec![true, false, false], 10)
    );
}

/// Largest consistent subset by exhaustive search: the union of every consistent subset.
fn brute_force(members: &[(u32, Option<u32>)]) -> (Vec<bool>, u32) {
    let n = members.len();
    let mut union = vec![false; n];
    for mask in 0u32..(1 << n) {
        let total: u32 = (0..n).filter(|i| mask >> i & 1 == 1).map(|i| members[i].0).sum();
        let consistent = (0..n)
            .filter(|i| mask >> i & 1 == 1)
            .all(|i| members[i].1.is_none_or(|t| t <= total));
        if consistent {
            for (i, flag) in union.iter_mut().enumerate() {
                *flag |= mask >> i & 1 == 1;
            }
        }
    }
    let total = (0..n).filter(|i| union[*i]).map(|i| members[i].0).sum();
    (union, total)
}

#[test]
fn resolve_equals_largest_consistent_subset_property() {
    let mut rng = Rng(0x9E37_79B9_7F4A_7C15);
    for _ in 0..3000 {
        let n = rng.range(0, 10) as usize;
        let members: Vec<(u32, Option<u32>)> = (0..n)
            .map(|_| {
                let units = rng.range(1, 6);
                let threshold = if rng.range(0, 2) == 0 { None } else { Some(rng.range(1, 40)) };
                (units, threshold)
            })
            .collect();
        let (flags, total) = resolve(&members);
        let (expected_flags, expected_total) = brute_force(&members);
        assert_eq!(flags, expected_flags, "members {members:?}");
        assert_eq!(total, expected_total, "members {members:?}");
        // The result itself is consistent.
        for (i, (_, t)) in members.iter().enumerate() {
            if flags[i] {
                assert!(t.is_none_or(|t| t <= total));
            }
        }
    }
}

#[test]
fn validate_tiers_rules() {
    let ok = tiers();
    validate_tiers(&ok, 100);
    let bad = |t: Vec<Tier>, max: u32| std::panic::catch_unwind(|| validate_tiers(&t, max)).is_err();
    assert!(bad(vec![], 10));
    assert!(bad(vec![Tier { min_units: 0, unit_price: U128(5) }], 10));
    // Not ascending.
    assert!(bad(
        vec![
            Tier { min_units: 5, unit_price: U128(9) },
            Tier { min_units: 5, unit_price: U128(8) }
        ],
        10
    ));
    // Price not strictly descending.
    assert!(bad(
        vec![
            Tier { min_units: 1, unit_price: U128(9) },
            Tier { min_units: 5, unit_price: U128(9) }
        ],
        10
    ));
    // Last tier beyond max_units.
    assert!(bad(vec![Tier { min_units: 11, unit_price: U128(9) }], 10));
    // Zero price.
    assert!(bad(vec![Tier { min_units: 1, unit_price: U128(0) }], 10));
    // Nine tiers.
    let nine: Vec<Tier> = (0..9)
        .map(|i| Tier { min_units: i + 1, unit_price: U128(100 - u128::from(i)) })
        .collect();
    assert!(bad(nine, 100));
}

#[test]
fn is_improvement_cases() {
    let old = tiers();
    assert!(is_improvement(&old, &old, 100));
    // Lower price on every tier.
    let cheaper: Vec<Tier> =
        old.iter().map(|t| Tier { min_units: t.min_units, unit_price: U128(t.unit_price.0 - 1) }).collect();
    assert!(is_improvement(&old, &cheaper, 100));
    // New lower threshold tier added.
    let mut more = old.clone();
    more.insert(1, Tier { min_units: 10, unit_price: U128(8 * NEAR / 10) });
    assert!(is_improvement(&old, &more, 100));
    // Higher price at tier 1.
    let mut worse = old.clone();
    worse[1].unit_price = U128(9 * NEAR / 10);
    assert!(!is_improvement(&old, &worse, 100));
    // Higher min_units for a tier makes totals in between worse.
    let mut harder = old.clone();
    harder[1].min_units = 30;
    assert!(!is_improvement(&old, &harder, 100));
    // Dropping the last tier is worse.
    assert!(!is_improvement(&old, &old[..2], 100));
    // Raising the entry threshold (undefined where old was defined) is worse.
    let mut late = old.clone();
    late[0].min_units = 2;
    assert!(!is_improvement(&old, &late, 100));
}

// ---------------------------------------------------------------------------------------
// Offers and inventory
// ---------------------------------------------------------------------------------------

#[test]
fn create_offer_validates_and_refunds_excess() {
    let mut fx = Fx::new();
    set_env(SELLER, 5 * NEAR, T0);
    let id = fx.c.create_offer(
        acct(TOKEN),
        "t".into(),
        "d".into(),
        tiers(),
        100,
        U128(1),
        U64(DEADLINE),
        U64(LOCK_WINDOW),
    );
    assert_eq!(id, 1);
    let refund = transferred_to(SELLER);
    assert!(refund > 4 * NEAR && refund < 5 * NEAR, "refund {refund}");
    let offer = fx.c.get_offer(1).unwrap();
    assert_eq!(offer.status, offer::OfferStatus::AwaitingInventory);
    assert_eq!(offer.lock_at_ns.0, LOCK_AT);
    assert_eq!(fx.c.get_pool(1).unwrap().status, PoolStatus::AwaitingInventory);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"offer_created\"")));
}

#[test]
#[should_panic(expected = "Attached deposit must cover storage")]
fn create_offer_needs_storage_deposit() {
    let mut fx = Fx::new();
    set_env(SELLER, 1, T0);
    fx.c.create_offer(
        acct(TOKEN),
        "t".into(),
        "d".into(),
        tiers(),
        100,
        U128(1),
        U64(DEADLINE),
        U64(LOCK_WINDOW),
    );
}

#[test]
#[should_panic(expected = "deadline must be later")]
fn create_offer_rejects_short_deadline() {
    let mut fx = Fx::new();
    set_env(SELLER, NEAR, T0);
    fx.c.create_offer(
        acct(TOKEN),
        "t".into(),
        "d".into(),
        tiers(),
        100,
        U128(1),
        U64(T0 + LOCK_WINDOW),
        U64(LOCK_WINDOW),
    );
}

#[test]
#[should_panic(expected = "Title is longer")]
fn create_offer_rejects_long_title() {
    let mut fx = Fx::new();
    set_env(SELLER, NEAR, T0);
    fx.c.create_offer(
        acct(TOKEN),
        "x".repeat(65),
        "d".into(),
        tiers(),
        100,
        U128(1),
        U64(DEADLINE),
        U64(LOCK_WINDOW),
    );
}

#[test]
#[should_panic(expected = "max_units must be in 1..=10000")]
fn create_offer_rejects_too_many_units() {
    let mut fx = Fx::new();
    set_env(SELLER, NEAR, T0);
    fx.c.create_offer(
        acct(TOKEN),
        "t".into(),
        "d".into(),
        tiers(),
        10_001,
        U128(1),
        U64(DEADLINE),
        U64(LOCK_WINDOW),
    );
}

#[test]
fn offer_opens_only_after_full_inventory() {
    let mut fx = Fx::new();
    let id = fx.offer_no_inventory(100, tiers());
    assert_eq!(fx.deposit_inventory(id, 60).0, 0);
    let offer = fx.c.get_offer(id).unwrap();
    assert_eq!(offer.status, offer::OfferStatus::AwaitingInventory);
    assert_eq!(offer.inventory_held.0, 60);
    // Joining an offer that is still awaiting inventory is rejected.
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    set_env(a.as_str(), 0, T0 + SEC);
    let attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fx.c.join_pool(id, 1, None, None)
    }));
    assert!(attempt.is_err());
    assert_eq!(fx.deposit_inventory(id, 40).0, 0);
    let offer = fx.c.get_offer(id).unwrap();
    assert_eq!(offer.status, offer::OfferStatus::Open);
    assert_eq!(offer.inventory_held.0, 100);
    assert_eq!(fx.c.get_pool(id).unwrap().status, PoolStatus::Open);
    let logs = get_logs().join("\n");
    assert!(logs.contains("\"event\":\"offer_opened\""), "{logs}");
}

#[test]
fn ft_on_transfer_rejects_wrong_token_sender_and_message() {
    let mut fx = Fx::new();
    let id = fx.offer_no_inventory(100, tiers());
    // Wrong token contract.
    set_env("other-token.near", 0, T0);
    assert_eq!(fx.c.ft_on_transfer(acct(SELLER), U128(100), format!("{{\"offer_id\":{id}}}")).0, 100);
    // Wrong sender.
    set_env(TOKEN, 0, T0);
    assert_eq!(fx.c.ft_on_transfer(acct("mallory.near"), U128(100), format!("{{\"offer_id\":{id}}}")).0, 100);
    // Bad message, unknown offer.
    assert_eq!(fx.c.ft_on_transfer(acct(SELLER), U128(100), "nope".into()).0, 100);
    assert_eq!(fx.c.ft_on_transfer(acct(SELLER), U128(100), "{\"offer_id\":99}".into()).0, 100);
    assert_eq!(fx.c.get_offer(id).unwrap().inventory_held.0, 0);
    // Correct deposit works.
    assert_eq!(fx.c.ft_on_transfer(acct(SELLER), U128(100), format!("{{\"offer_id\":{id}}}")).0, 0);
    assert_eq!(fx.c.get_offer(id).unwrap().inventory_held.0, 100);
}

#[test]
fn ft_on_transfer_rejected_once_settlement_started() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    fx.settle_all(id);
    assert_eq!(fx.c.get_offer(id).unwrap().status, offer::OfferStatus::Closed);
    assert_eq!(fx.deposit_inventory(id, 5).0, 5);
}

#[test]
fn improve_offer_accepts_better_and_rejects_worse() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let mut better = tiers();
    better.insert(1, Tier { min_units: 10, unit_price: U128(8 * NEAR / 10) });
    better[3].unit_price = U128(NEAR / 3);
    set_env(SELLER, 1, T0 + SEC);
    fx.c.improve_offer(id, better.clone());
    assert_eq!(fx.c.get_offer(id).unwrap().tiers, better);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"offer_improved\"")));

    let mut worse = better.clone();
    worse[2].unit_price = U128(95 * NEAR / 100);
    set_env(SELLER, 1, T0 + SEC);
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        fx.c.improve_offer(id, worse.clone())
    }));
    assert!(result.is_err());
    assert_eq!(fx.c.get_offer(id).unwrap().tiers, better);
}

#[test]
#[should_panic(expected = "Only the seller")]
fn improve_offer_seller_only() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    set_env("mallory.near", 1, T0);
    fx.c.improve_offer(id, tiers());
}

#[test]
#[should_panic(expected = "Offer is locked")]
fn improve_offer_rejected_after_lock() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    set_env(SELLER, 1, LOCK_AT);
    fx.c.improve_offer(id, tiers());
}

#[test]
fn improved_tiers_are_used_for_settlement_prices() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 50 * NEAR, NEAR, 30);
    fx.join(&a, id, 25, None);
    let mut better = tiers();
    better[0].unit_price = U128(9 * NEAR / 10);
    better[1] = Tier { min_units: 20, unit_price: U128(6 * NEAR / 10) };
    set_env(SELLER, 1, T0 + SEC);
    fx.c.improve_offer(id, better);
    fx.settle_all(id);
    let m = &fx.members(id)[0];
    assert_eq!(m.paid.unwrap().0, 25 * 6 * NEAR / 10);
    assert!(m.paid.unwrap().0 <= m.locked.0);
}

// ---------------------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------------------

#[test]
fn register_agent_charges_storage_and_credits_budget() {
    let mut fx = Fx::new();
    set_env(OWNER, 10 * NEAR, T0);
    let id = acct("a1.owner.near");
    fx.c.register_agent(id.clone(), limits(NEAR, 5));
    let view = fx.agent_view(&id);
    assert_eq!(view.owner, acct(OWNER));
    let storage = 10 * NEAR - view.budget_available.0;
    assert!(storage > 0 && storage < NEAR / 100, "storage {storage}");
    assert_eq!(view.budget_locked.0, 0);
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"agent_registered\"")));
    assert_eq!(fx.c.get_stats().agents, 1);
    assert_eq!(fx.c.list_agents(None, None).len(), 1);
}

#[test]
fn register_agent_rejects_non_direct_subaccount() {
    for bad in ["other.near", "owner.near", "a1.other.near", "x.a1.owner.near", "owner.owner.near.x"] {
        let mut fx = Fx::new();
        set_env(OWNER, 10 * NEAR, T0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            fx.c.register_agent(acct(bad), limits(NEAR, 5))
        }));
        assert!(result.is_err(), "{bad} must be rejected");
    }
}

#[test]
#[should_panic(expected = "The Co-op contract cannot be an agent")]
fn register_agent_rejects_contract_account() {
    // Contract is coop.near (see ctx). Predecessor `near` makes coop.near a direct
    // sub-account, so only the contract-account check can reject it.
    let mut fx = Fx::new();
    set_env("near", 10 * NEAR, T0);
    fx.c.register_agent(acct("coop.near"), limits(NEAR, 5));
}

#[test]
#[should_panic(expected = "already registered")]
fn register_agent_twice_fails() {
    let mut fx = Fx::new();
    fx.agent("a1", NEAR, NEAR, 5);
    set_env(OWNER, NEAR, T0);
    fx.c.register_agent(acct("a1.owner.near"), limits(NEAR, 5));
}

#[test]
#[should_panic(expected = "must cover storage")]
fn register_agent_needs_storage_deposit() {
    let mut fx = Fx::new();
    set_env(OWNER, 1000, T0);
    fx.c.register_agent(acct("a1.owner.near"), limits(NEAR, 5));
}

#[test]
fn fund_withdraw_and_update_limits_are_owner_only_with_one_yocto() {
    let mut fx = Fx::new();
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    let before = fx.agent_view(&a).budget_available.0;

    set_env(OWNER, 2 * NEAR, T0);
    fx.c.fund_agent(a.clone());
    assert_eq!(fx.agent_view(&a).budget_available.0, before + 2 * NEAR);

    set_env(OWNER, 1, T0);
    fx.c.withdraw(a.clone(), Some(U128(NEAR)));
    assert_eq!(transferred_to(OWNER), NEAR);
    assert_eq!(fx.agent_view(&a).budget_available.0, before + NEAR);

    set_env(OWNER, 1, T0);
    fx.c.withdraw(a.clone(), None);
    assert_eq!(transferred_to(OWNER), before + NEAR);
    assert_eq!(fx.agent_view(&a).budget_available.0, 0);

    set_env(OWNER, 1, T0);
    fx.c.update_limits(a.clone(), limits(2 * NEAR, 9));
    assert_eq!(fx.agent_view(&a).limits.max_units_per_pool, 9);
}

fn panics<F: FnOnce()>(f: F) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err()
}

#[test]
fn owner_only_methods_require_one_yocto() {
    let mut fx = Fx::new();
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    // Zero deposit (what a function-call key sends) is rejected everywhere.
    set_env(OWNER, 0, T0);
    assert!(panics(|| fx.c.withdraw(a.clone(), None)));
    set_env(OWNER, 0, T0);
    assert!(panics(|| fx.c.update_limits(a.clone(), limits(NEAR, 5))));
    // More than 1 yocto is rejected as well.
    set_env(OWNER, 2, T0);
    assert!(panics(|| fx.c.withdraw(a.clone(), None)));
    // The agent itself and strangers cannot use them even with 1 yocto.
    set_env(a.as_str(), 1, T0);
    assert!(panics(|| fx.c.withdraw(a.clone(), None)));
    set_env("mallory.near", 1, T0);
    assert!(panics(|| fx.c.update_limits(a.clone(), limits(NEAR, 5))));
    set_env("mallory.near", NEAR, T0);
    assert!(panics(|| fx.c.fund_agent(a.clone())));
    let id = fx.offer(10);
    set_env(SELLER, 0, T0);
    assert!(panics(|| fx.c.improve_offer(id, tiers())));
    // Nothing moved.
    assert_eq!(fx.agent_view(&a).limits.max_units_per_pool, 5);
}

#[test]
#[should_panic(expected = "exceeds available budget")]
fn withdraw_cannot_exceed_available() {
    let mut fx = Fx::new();
    let a = fx.agent("a1", NEAR, NEAR, 5);
    set_env(OWNER, 1, T0);
    fx.c.withdraw(a, Some(U128(2 * NEAR)));
}

// ---------------------------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------------------------

#[test]
fn join_locks_budget_and_books_storage() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    let before = fx.agent_view(&a);
    fx.join(&a, id, 3, None);
    let after = fx.agent_view(&a);
    let locked = 3 * NEAR + STORAGE_RESERVE;
    assert_eq!(after.budget_locked.0, locked);
    assert_eq!(after.active_pools, vec![id]);
    let fee = before.budget_available.0 - after.budget_available.0 - locked;
    assert!(fee > 0 && fee < NEAR / 100, "membership storage fee {fee}");
    let m = &fx.members(id)[0];
    assert_eq!(m.locked.0, locked);
    assert_eq!(m.memo, "a1.owner.near joins");
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"pool_joined\"")));
    // Budget bookkeeping: available + locked + fee == before.
    assert_eq!(after.budget_available.0 + after.budget_locked.0 + fee, before.budget_available.0);
}

#[test]
fn lock_never_exceeds_budget() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    // Budget for 2 units only.
    let a = fx.agent("a1", 2 * NEAR + 2 * STORAGE_RESERVE, NEAR, 5);
    set_env(a.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 3, None, None)));
    let v = fx.agent_view(&a);
    assert_eq!(v.budget_locked.0, 0);
    assert!(v.active_pools.is_empty());
    assert_eq!(fx.c.get_pool(id).unwrap().member_count, 0);
    // After a successful join the invariant locked <= funded still holds.
    let b = fx.agent("b1", 3 * NEAR, NEAR, 5);
    fx.join(&b, id, 2, None);
    let v = fx.agent_view(&b);
    assert!(v.budget_locked.0 <= fx.credited);
    // Second join is not possible: not enough left.
    set_env(b.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 5, None, None)));
}

#[test]
fn join_rejected_when_lock_price_exceeds_max_unit_price() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    // Max price 0.8 NEAR: unconditional (lock 1.0) rejected, conditional at 20 (lock 0.7) ok.
    let a = fx.agent("a1", 20 * NEAR, 8 * NEAR / 10, 10);
    set_env(a.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 2, None, None)));
    assert!(panics(|| fx.c.join_pool(id, 2, Some(5), None)));
    fx.join(&a, id, 2, Some(20));
    assert_eq!(fx.members(id)[0].locked.0, 2 * 7 * NEAR / 10 + STORAGE_RESERVE);
}

#[test]
fn join_rejects_invalid_requests() {
    let mut fx = Fx::new();
    let id = fx.offer(10);
    let a = fx.agent("a1", 100 * NEAR, NEAR, 5);
    set_env(a.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 0, None, None)), "zero units");
    assert!(panics(|| fx.c.join_pool(id, 1, Some(0), None)), "zero threshold");
    assert!(panics(|| fx.c.join_pool(id, 6, None, None)), "over max_units_per_pool");
    assert!(panics(|| fx.c.join_pool(id, 1, None, Some("x".repeat(141)))), "long memo");
    assert!(panics(|| fx.c.join_pool(99, 1, None, None)), "unknown pool");
    set_env("stranger.near", 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 1, None, None)), "unregistered caller");
    // Already a member.
    fx.join(&a, id, 2, None);
    set_env(a.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 1, None, None)), "double join");
}

#[test]
fn join_respects_pool_capacity_and_member_cap() {
    let mut fx = Fx::new();
    let id = fx.offer(10);
    let a = fx.agent("a1", 100 * NEAR, NEAR, 10);
    let b = fx.agent("b1", 100 * NEAR, NEAR, 10);
    fx.join(&a, id, 8, None);
    set_env(b.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 3, Some(40), None)), "conditional units count too");
    fx.join(&b, id, 2, None);

    // Member cap of 100.
    let mut fx = Fx::new();
    let id = fx.offer(1000);
    for i in 0..MAX_MEMBERS {
        let a = fx.agent(&format!("m{i}"), 3 * NEAR, NEAR, 1);
        fx.join(&a, id, 1, None);
    }
    let extra = fx.agent("extra", 3 * NEAR, NEAR, 1);
    set_env(extra.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 1, None, None)));
    assert_eq!(fx.c.get_pool(id).unwrap().member_count, MAX_MEMBERS);
}

#[test]
fn join_respects_allowed_sellers() {
    let mut fx = Fx::new();
    let id = fx.offer(10);
    let a = fx.agent("a1", 100 * NEAR, NEAR, 5);
    let mut l = limits(NEAR, 5);
    l.allowed_sellers = Some(vec![acct("someone-else.near")]);
    set_env(OWNER, 1, T0);
    fx.c.update_limits(a.clone(), l.clone());
    set_env(a.as_str(), 0, T0 + SEC);
    assert!(panics(|| fx.c.join_pool(id, 1, None, None)));
    l.allowed_sellers = Some(vec![acct(SELLER)]);
    set_env(OWNER, 1, T0);
    fx.c.update_limits(a.clone(), l);
    fx.join(&a, id, 1, None);
}

#[test]
fn leave_before_lock_returns_lock_and_storage() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    let funded = fx.agent_view(&a).budget_available.0;
    fx.join(&a, id, 3, Some(20));
    set_env(a.as_str(), 0, LOCK_AT - 1);
    fx.c.leave_pool(id);
    let v = fx.agent_view(&a);
    assert_eq!(v.budget_available.0, funded);
    assert_eq!(v.budget_locked.0, 0);
    assert!(v.active_pools.is_empty());
    let p = fx.c.get_pool(id).unwrap();
    assert_eq!((p.member_count, p.units_conditional, p.units_unconditional), (0, 0, 0));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"pool_left\"")));
    // Can re-join afterwards.
    fx.join(&a, id, 1, None);
}

#[test]
fn leave_keeps_join_order_of_the_others() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let names = ["a", "b", "c", "d"];
    let ids: Vec<AccountId> = names.iter().map(|n| fx.agent(n, 5 * NEAR, NEAR, 5)).collect();
    for (i, a) in ids.iter().enumerate() {
        fx.join(a, id, 1, if i % 2 == 0 { None } else { Some(3) });
    }
    set_env(ids[1].as_str(), 0, T0 + 2 * SEC);
    fx.c.leave_pool(id);
    let order: Vec<AccountId> = fx.members(id).into_iter().map(|m| m.agent_id).collect();
    assert_eq!(order, vec![ids[0].clone(), ids[2].clone(), ids[3].clone()]);
    let p = fx.c.get_pool(id).unwrap();
    assert_eq!((p.units_unconditional, p.units_conditional, p.member_count), (2, 1, 3));
}

#[test]
#[should_panic(expected = "Pool is locked")]
fn leave_after_lock_rejected() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    fx.join(&a, id, 3, None);
    set_env(a.as_str(), 0, LOCK_AT);
    fx.c.leave_pool(id);
}

#[test]
#[should_panic(expected = "Pool is locked")]
fn join_after_lock_rejected() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    fx.join_at(&a, id, 3, None, LOCK_AT);
}

#[test]
fn expired_agent_cannot_join_but_existing_lock_stays_valid() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    let b = fx.agent("b1", 10 * NEAR, NEAR, 5);
    let expiry = T0 + 500 * SEC;
    for who in [&a, &b] {
        let mut l = limits(NEAR, 5);
        l.expires_at_ns = Some(U64(expiry));
        set_env(OWNER, 1, T0);
        fx.c.update_limits(who.clone(), l);
    }
    fx.join_at(&a, id, 2, None, expiry - 1);
    set_env(b.as_str(), 0, expiry);
    assert!(panics(|| fx.c.join_pool(id, 2, None, None)));
    // The existing lock survives expiry and is settled normally.
    fx.settle_all(id);
    let m = &fx.members(id)[0];
    assert_eq!(m.outcome, Some(Outcome::Filled));
    assert_eq!(m.paid.unwrap().0, 2 * NEAR);
    assert_eq!(fx.agent_view(&a).budget_locked.0, 0);
}

// ---------------------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------------------

#[test]
#[should_panic(expected = "Deadline has not passed")]
fn settle_before_deadline_rejected() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    set_env("anyone.near", 0, DEADLINE - 1);
    fx.c.settle(id, None);
}

#[test]
fn derived_statuses_follow_the_clock() {
    let mut fx = Fx::new();
    let id = fx.offer_no_inventory(100, tiers());
    assert_eq!(fx.c.get_pool(id).unwrap().status, PoolStatus::AwaitingInventory);
    fx.deposit_inventory(id, 100);
    let status_at = |ts: u64| {
        set_env("anyone.near", 0, ts);
        fx.c.get_pool(id).unwrap().status
    };
    assert_eq!(status_at(T0), PoolStatus::Open);
    assert_eq!(status_at(LOCK_AT - 1), PoolStatus::Open);
    assert_eq!(status_at(LOCK_AT), PoolStatus::Locked);
    assert_eq!(status_at(DEADLINE - 1), PoolStatus::Locked);
    assert_eq!(status_at(DEADLINE), PoolStatus::Expired);
    fx.settle_all(id);
    assert_eq!(fx.c.get_pool(id).unwrap().status, PoolStatus::Refunded);
}

#[test]
fn demo_story_conditionals_flip_in_and_group_reaches_20() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let eager: Vec<AccountId> = (0..5).map(|i| fx.agent(&format!("eager{i}"), 10 * NEAR, NEAR, 3)).collect();
    let bargain: Vec<AccountId> =
        (0..2).map(|i| fx.agent(&format!("bargain{i}"), 10 * NEAR, 7 * NEAR / 10, 3)).collect();
    for a in &eager {
        fx.join(a, id, 3, None);
    }
    // 15 unconditional units: tier 1 (price 1.0) only.
    let p = fx.c.get_pool(id).unwrap();
    assert_eq!(p.projected.units, 15);
    assert_eq!(p.projected.tier_index, Some(0));
    for b in &bargain {
        fx.join(b, id, 3, Some(20));
    }
    // The bargain agents lock at the 0.7 tier price, and the projection now sees 21 units.
    let p = fx.c.get_pool(id).unwrap();
    assert_eq!((p.units_unconditional, p.units_conditional), (15, 6));
    assert_eq!(p.projected.units, 21);
    assert_eq!(p.projected.members_in, 7);
    assert_eq!(p.projected.tier_index, Some(1));
    assert_eq!(p.projected.unit_price, Some(U128(7 * NEAR / 10)));
    assert!(fx.members(id).iter().all(|m| m.projected_in));
    assert_eq!(fx.c.projected_price(id), p.projected);

    let (_, done) = fx.settle_all(id);
    assert_eq!(done.status, PoolStatus::Settled);
    let pool = fx.c.get_pool(id).unwrap();
    let result = pool.result.unwrap();
    assert_eq!((result.units, result.members_in, result.tier_index), (21, 7, Some(1)));
    assert_eq!(result.seller_payout.0, 21 * 7 * NEAR / 10);
    // Eager agents locked 1.0 and pay 0.7: they get the difference back too.
    for m in fx.members(id) {
        assert_eq!(m.outcome, Some(Outcome::Filled));
        assert_eq!(m.paid.unwrap().0, 3 * 7 * NEAR / 10);
        assert_eq!(m.delivery, Some(Delivery::Pending));
    }
    assert_eq!(fx.c.get_offer(id).unwrap().status, offer::OfferStatus::Closed);
}

#[test]
fn conditional_threshold_not_reached_is_excluded() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    let b = fx.agent("b1", 10 * NEAR, NEAR, 5);
    let c = fx.agent("c1", 10 * NEAR, NEAR, 5);
    fx.join(&a, id, 5, None);
    fx.join(&b, id, 5, Some(40));
    fx.join(&c, id, 5, Some(5));
    let before_b = fx.agent_view(&b).budget_available.0;
    let locked_b = fx.members(id)[1].locked.0;
    let m = fx.members(id);
    assert!(m[0].projected_in && !m[1].projected_in && m[2].projected_in);
    fx.settle_all(id);
    let m = fx.members(id);
    assert_eq!(m[1].outcome, Some(Outcome::Excluded));
    assert_eq!(m[1].paid.unwrap().0, 0);
    assert_eq!(m[1].refunded.unwrap().0, locked_b);
    assert_eq!(m[1].delivery, None);
    assert_eq!(fx.agent_view(&b).budget_available.0, before_b + locked_b);
    assert_eq!(fx.agent_view(&b).budget_locked.0, 0);
    assert_eq!(m[0].outcome, Some(Outcome::Filled));
    assert_eq!(m[2].outcome, Some(Outcome::Filled));
    let result = fx.c.get_pool(id).unwrap().result.unwrap();
    assert_eq!(result.units, 10);
}

#[test]
fn two_conditional_25_unit_members_with_threshold_50_both_get_in() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 100 * NEAR, NEAR, 25);
    let b = fx.agent("b1", 100 * NEAR, NEAR, 25);
    fx.join(&a, id, 25, Some(50));
    fx.join(&b, id, 25, Some(50));
    // Locked at the 50-unit tier price.
    assert_eq!(fx.members(id)[0].locked.0, 25 * NEAR / 2 + STORAGE_RESERVE);
    let p = fx.c.get_pool(id).unwrap();
    assert_eq!((p.projected.units, p.projected.tier_index), (50, Some(2)));
    fx.settle_all(id);
    for m in fx.members(id) {
        assert_eq!(m.outcome, Some(Outcome::Filled));
        assert_eq!(m.paid.unwrap().0, 25 * NEAR / 2);
        assert_eq!(m.refunded.unwrap().0, 0);
    }
    let r = fx.c.get_pool(id).unwrap().result.unwrap();
    assert_eq!((r.units, r.members_in, r.seller_payout.0), (50, 2, 50 * NEAR / 2));
}

#[test]
fn cascading_exclusion_when_a_higher_threshold_drops() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let u = fx.agent("u", 100 * NEAR, NEAR, 30);
    let c1 = fx.agent("c1", 100 * NEAR, NEAR, 30);
    let c2 = fx.agent("c2", 100 * NEAR, NEAR, 30);
    fx.join(&u, id, 10, None);
    fx.join(&c1, id, 5, Some(15));
    fx.join(&c2, id, 6, Some(22));
    let p = fx.c.get_pool(id).unwrap();
    assert_eq!((p.projected.units, p.projected.members_in), (15, 2));
    fx.settle_all(id);
    let m = fx.members(id);
    assert_eq!(m[0].outcome, Some(Outcome::Filled));
    assert_eq!(m[1].outcome, Some(Outcome::Filled));
    assert_eq!(m[2].outcome, Some(Outcome::Excluded));
}

#[test]
fn no_tier_reached_refunds_everyone_and_pays_no_seller() {
    let mut fx = Fx::new();
    // First tier needs 5 units; the pool only reaches 4.
    let id = fx.offer_no_inventory(
        100,
        vec![Tier { min_units: 5, unit_price: U128(NEAR) }, Tier { min_units: 50, unit_price: U128(NEAR / 2) }],
    );
    fx.deposit_inventory(id, 100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    let b = fx.agent("b1", 10 * NEAR, NEAR, 5);
    let before: Vec<u128> = [&a, &b].iter().map(|x| fx.agent_view(x).budget_available.0).collect();
    fx.join(&a, id, 2, None);
    fx.join(&b, id, 2, Some(4));
    assert_eq!(fx.c.get_pool(id).unwrap().projected.tier_index, None);
    assert!(fx.members(id).iter().all(|m| !m.projected_in));

    set_env("anyone.near", 0, DEADLINE);
    let progress = fx.c.settle(id, None);
    assert_eq!(progress.status, PoolStatus::Refunded);
    assert_eq!((progress.processed, progress.remaining), (2, 0));
    // No payment to the seller, only the full inventory goes back.
    assert_eq!(transferred_to(SELLER), 0);
    let returns = calls_to(TOKEN, "ft_transfer");
    assert_eq!(returns.len(), 1);
    assert!(returns[0].contains("\"amount\":\"100\"") && returns[0].contains(SELLER));
    assert!(calls_to(TOKEN, "storage_deposit").is_empty());

    for (i, x) in [&a, &b].iter().enumerate() {
        let v = fx.agent_view(x);
        let fee = fx.c.pool(id).memberships.get(*x).unwrap().storage_fee;
        // Everything locked came back; only the membership storage fee was spent.
        assert_eq!(v.budget_available.0 + fee, before[i]);
        assert_eq!(v.budget_locked.0, 0);
    }
    for m in fx.members(id) {
        assert_eq!(m.outcome, Some(Outcome::Refunded));
        assert_eq!(m.refunded.unwrap().0, m.locked.0);
        assert_eq!(m.paid.unwrap().0, 0);
    }
    let pool = fx.c.get_pool(id).unwrap();
    assert_eq!(pool.status, PoolStatus::Refunded);
    assert_eq!(pool.result.unwrap().seller_payout.0, 0);
    let stats = fx.c.get_stats();
    assert_eq!((stats.pools_refunded, stats.pools_settled, stats.volume.0), (1, 0, 0));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"pool_refunded\"")));
}

#[test]
fn empty_pool_settles_in_one_call_and_returns_inventory() {
    let mut fx = Fx::new();
    let id = fx.offer(10);
    let p = fx.settle(id, None);
    assert_eq!(p.status, PoolStatus::Refunded);
    assert_eq!(calls_to(TOKEN, "ft_transfer").len(), 1);
}

#[test]
fn settle_twice_is_idempotent() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    fx.join(&a, id, 5, None);
    let first = fx.settle(id, None);
    assert_eq!(first.status, PoolStatus::Settled);
    let snapshot = (fx.agent_view(&a), fx.c.get_pool(id).unwrap(), fx.c.get_stats());
    let second = fx.settle(id, None);
    assert_eq!(second.status, PoolStatus::Settled);
    assert_eq!((second.processed, second.remaining), (1, 0));
    // No new receipts, no logs, no state change.
    assert!(get_created_receipts().is_empty());
    assert!(get_logs().is_empty());
    assert_eq!(snapshot, (fx.agent_view(&a), fx.c.get_pool(id).unwrap(), fx.c.get_stats()));
}

#[test]
fn settle_pays_seller_delivers_and_returns_unsold() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    let b = fx.agent("b1", 10 * NEAR, NEAR, 5);
    fx.join(&a, id, 5, None);
    fx.join(&b, id, 3, None);
    set_env("anyone.near", 0, DEADLINE);
    let p = fx.c.settle(id, None);
    assert_eq!(p.status, PoolStatus::Settled);
    // Seller gets 8 units at the entry price.
    assert_eq!(transferred_to(SELLER), 8 * NEAR);
    // One storage_deposit and one ft_transfer per member, plus the unsold return.
    let deposits = calls_to(TOKEN, "storage_deposit");
    assert_eq!(deposits.len(), 2);
    assert!(deposits[0].contains("\"registration_only\":true") && deposits[0].contains(a.as_str()));
    let transfers = calls_to(TOKEN, "ft_transfer");
    assert_eq!(transfers.len(), 3);
    assert!(transfers[0].contains("\"amount\":\"5\"") && transfers[0].contains(a.as_str()));
    assert!(transfers[0].contains("co-op pool 1"));
    assert!(transfers[1].contains("\"amount\":\"3\"") && transfers[1].contains(b.as_str()));
    assert!(transfers[2].contains("\"amount\":\"92\"") && transfers[2].contains(SELLER));
    // storage_deposit carries STORAGE_RESERVE, ft_transfer one yocto.
    let attached: Vec<u128> = get_created_receipts()
        .iter()
        .filter(|r| r.receiver_id.as_str() == TOKEN)
        .flat_map(|r| r.actions.iter())
        .filter_map(|a| match a {
            MockAction::FunctionCallWeight { attached_deposit, method_name, .. }
                if method_name.as_slice() == b"storage_deposit" =>
            {
                Some(attached_deposit.as_yoctonear())
            }
            _ => None,
        })
        .collect();
    assert_eq!(attached, vec![STORAGE_RESERVE, STORAGE_RESERVE]);
    let stats = fx.c.get_stats();
    assert_eq!((stats.pools_settled, stats.volume.0, stats.offers), (1, 8 * NEAR, 1));
    let logs = get_logs().join("\n");
    for event in ["pool_resolved", "member_filled", "seller_paid", "pool_settled"] {
        assert!(logs.contains(&format!("\"event\":\"{event}\"")), "missing {event}");
    }
    assert_eq!(fx.c.get_offer(id).unwrap().inventory_held.0, 0);
}

#[test]
fn events_follow_nep297_format() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    fx.join(&a, id, 2, Some(10));
    let log = get_logs().into_iter().find(|l| l.contains("pool_joined")).unwrap();
    let json = log.strip_prefix("EVENT_JSON:").expect("prefix");
    let v: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(json).unwrap();
    assert_eq!(v["standard"], "coop");
    assert_eq!(v["version"], "1.0.0");
    assert_eq!(v["event"], "pool_joined");
    let d = &v["data"][0];
    assert_eq!(d["pool_id"], id);
    assert_eq!(d["agent_id"], a.as_str());
    assert_eq!(d["units"], 2);
    assert_eq!(d["threshold_units"], 10);
    assert_eq!(d["locked"], (2 * NEAR + STORAGE_RESERVE).to_string());
    assert!(d["memo"].is_string());
}

type Snapshot =
    (Vec<views::MemberView>, Vec<views::AgentView>, Option<settle::SettlementResult>, views::StatsView);

fn snapshot(fx: &Fx, id: u64, agents: &[AccountId]) -> Snapshot {
    (
        fx.members(id),
        agents.iter().map(|a| fx.agent_view(a)).collect(),
        fx.c.get_pool(id).unwrap().result,
        fx.c.get_stats(),
    )
}

#[test]
fn chunked_settlement_matches_single_call() {
    // Same 25-member pool settled with max_members=10 (3 calls) and with a big chunk.
    fn build() -> (Fx, u64, Vec<AccountId>) {
        let mut fx = Fx::new();
        let id = fx.offer(100);
        let mut agents = Vec::new();
        for i in 0..25u32 {
            let a = fx.agent(&format!("m{i}"), 20 * NEAR, NEAR, 3);
            // Mix of unconditional, reachable and unreachable conditional members.
            let threshold = match i % 5 {
                0 | 1 => None,
                2 => Some(30),
                3 => Some(45),
                _ => Some(500),
            };
            fx.join(&a, id, 1 + i % 3, threshold);
            agents.push(a);
        }
        (fx, id, agents)
    }
    let (mut chunked, id, agents) = build();
    let mut progress = Vec::new();
    let mut transfers = 0;
    let mut seller_paid = 0;
    loop {
        let p = chunked.settle(id, Some(10));
        transfers += calls_to(TOKEN, "ft_transfer").len();
        seller_paid += transferred_to(SELLER);
        progress.push((p.processed, p.remaining));
        if matches!(p.status, PoolStatus::Settled | PoolStatus::Refunded) {
            break;
        }
    }
    assert_eq!(progress, vec![(10, 15), (20, 5), (25, 0)]);
    // Fixtures share one mocked blockchain, so capture the chunked outcome before building
    // the second pool.
    let chunked_snapshot = snapshot(&chunked, id, &agents);

    let (mut single, id2, _) = build();
    set_env("anyone.near", 0, DEADLINE);
    let p = single.c.settle(id2, Some(100));
    assert_eq!(p.status, PoolStatus::Settled);
    assert_eq!(p.processed, 25);
    let single_transfers = calls_to(TOKEN, "ft_transfer").len();
    let single_paid = transferred_to(SELLER);

    assert_eq!(chunked_snapshot, snapshot(&single, id2, &agents));
    assert_eq!(transfers, single_transfers);
    assert_eq!(seller_paid, single_paid);
    assert!(seller_paid > 0);
    // Mid-way status is Settling with a cursor.
    let (mut mid, id3, _) = build();
    let p = mid.settle(id3, Some(10));
    assert_eq!(p.status, PoolStatus::Settling);
    let view = mid.c.get_pool(id3).unwrap();
    assert_eq!((view.status, view.settle_cursor), (PoolStatus::Settling, 10));
    assert!(view.result.is_some());
}

#[test]
fn default_chunk_and_gas_limit_bound_members_per_call() {
    let mut fx = Fx::new();
    let id = fx.offer(200);
    for i in 0..25 {
        let a = fx.agent(&format!("m{i}"), 5 * NEAR, NEAR, 1);
        fx.join(&a, id, 1, None);
    }
    let p = fx.settle(id, None);
    assert_eq!(p.processed, DEFAULT_CHUNK);
    // With little prepaid gas fewer members fit per call and settlement still completes.
    let mut calls = 0;
    let mut last_processed = DEFAULT_CHUNK;
    loop {
        set_env_gas("anyone.near", DEADLINE, 120);
        let p = fx.c.settle(id, Some(100));
        calls += 1;
        assert!(p.processed > last_processed || p.remaining == 0, "no progress");
        assert!(p.processed - last_processed < 10, "gas bound must limit the chunk");
        last_processed = p.processed;
        if p.status == PoolStatus::Settled {
            break;
        }
        assert!(calls < 20);
    }
    assert!(calls >= 3);
    assert_eq!(fx.c.get_stats().pools_settled, 1);
}

#[test]
#[should_panic(expected = "Attach more gas")]
fn settle_with_hopeless_gas_is_rejected() {
    let mut fx = Fx::new();
    let id = fx.offer(10);
    let a = fx.agent("a1", 5 * NEAR, NEAR, 1);
    fx.join(&a, id, 1, None);
    set_env_gas("anyone.near", DEADLINE, 30);
    fx.c.settle(id, None);
}

#[test]
fn finishing_waits_for_one_more_call_when_gas_runs_out() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    let a = fx.agent("a1", 5 * NEAR, NEAR, 1);
    fx.join(&a, id, 1, None);
    // Enough gas to process the member but not to finish.
    let mut finished_in_first = false;
    for tgas in (60..=120).step_by(2) {
        let (mut f, pid, _) = {
            let mut f = Fx::new();
            let pid = f.offer(100);
            let a = f.agent("a1", 5 * NEAR, NEAR, 1);
            f.join(&a, pid, 1, None);
            (f, pid, a)
        };
        set_env_gas("anyone.near", DEADLINE, tgas);
        let attempt = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f.c.settle(pid, None)));
        let Ok(p) = attempt else { continue };
        if p.status == PoolStatus::Settling {
            assert_eq!((p.processed, p.remaining), (1, 0));
            // The follow-up call finishes without reprocessing anything.
            let p2 = f.settle(pid, None);
            assert_eq!(p2.status, PoolStatus::Settled);
            assert_eq!(transferred_to(SELLER), NEAR);
            return;
        }
        finished_in_first = true;
    }
    assert!(finished_in_first, "settle never succeeded in the tested gas range");
}

#[test]
fn invariant_over_30_random_members() {
    for seed in [1u64, 7, 42, 2024] {
        let mut rng = Rng(seed.wrapping_mul(0x2545_F491_4F6C_DD1D) | 1);
        let mut fx = Fx::new();
        let id = fx.offer(100);
        let mut agents = Vec::new();
        let mut spec: Vec<(u32, Option<u32>)> = Vec::new();
        for i in 0..30 {
            let max_price = NEAR;
            let a = fx.agent(&format!("r{i}"), 50 * NEAR, max_price, 3);
            let units = rng.range(1, 3);
            let threshold = if rng.range(0, 1) == 0 { None } else { Some(rng.range(3, 60)) };
            fx.join(&a, id, units, threshold);
            agents.push(a);
            spec.push((units, threshold));
        }
        let (_, done) = fx.settle_all(id);
        let pool = fx.c.get_pool(id).unwrap();
        let result = pool.result.clone().unwrap();

        // Independent oracle: iterate "drop anyone whose threshold exceeds the total".
        let mut inn = [true; 30];
        loop {
            let total: u32 = (0..30).filter(|i| inn[*i]).map(|i| spec[i].0).sum();
            match (0..30).find(|i| inn[*i] && spec[*i].1.is_some_and(|t| t > total)) {
                Some(i) => inn[i] = false,
                None => break,
            }
        }
        let total: u32 = (0..30).filter(|i| inn[*i]).map(|i| spec[i].0).sum();
        let oracle_tier = price_for(&tiers(), total);

        let members = fx.members(id);
        let (mut sum_paid, mut sum_spent) = (0u128, 0u128);
        let mut conserved = 0u128;
        for (i, m) in members.iter().enumerate() {
            let agent = fx.agent_view(&agents[i]);
            let fee = fx.c.pool(id).memberships.get(&agents[i]).unwrap().storage_fee;
            let paid = m.paid.unwrap().0;
            let refunded = m.refunded.unwrap().0;
            assert_eq!(agent.budget_locked.0, 0);
            conserved += agent.budget_available.0;
            sum_paid += paid;
            sum_spent += fee;
            if oracle_tier.is_some() && inn[i] {
                assert_eq!(m.outcome, Some(Outcome::Filled), "seed {seed} member {i}");
                // Never more than the agent's own limit, never more than the lock.
                assert!(paid <= u128::from(m.units) * NEAR);
                assert!(paid <= m.locked.0);
                assert_eq!(paid + refunded + STORAGE_RESERVE, m.locked.0);
                assert_eq!(paid, u128::from(m.units) * oracle_tier.map_or(0, |t| t.1));
                sum_spent += STORAGE_RESERVE;
            } else {
                assert_eq!(m.outcome, Some(Outcome::Excluded), "seed {seed} member {i}");
                assert_eq!((paid, refunded), (0, m.locked.0));
            }
        }
        assert_eq!(result.seller_payout.0, sum_paid);
        match oracle_tier {
            Some((index, price)) => {
                assert_eq!(done.status, PoolStatus::Settled);
                assert_eq!(result.units, total);
                assert_eq!(result.tier_index, Some(index as u32));
                assert_eq!(result.unit_price, Some(U128(price)));
            }
            None => {
                assert_eq!(done.status, PoolStatus::Refunded);
                assert_eq!(sum_paid, 0);
            }
        }
        // Budgets conserve: what the agents were credited is now in their budgets, the
        // seller payout, the spent storage reserves, or membership storage fees.
        assert_eq!(fx.credited, conserved + sum_paid + sum_spent, "seed {seed}");
    }
}

// ---------------------------------------------------------------------------------------
// Failed deliveries and claims
// ---------------------------------------------------------------------------------------

fn settled_single(fx: &mut Fx) -> (u64, AccountId) {
    let id = fx.offer(100);
    let a = fx.agent("a1", 10 * NEAR, NEAR, 5);
    fx.join(&a, id, 4, None);
    fx.settle_all(id);
    (id, a)
}

#[test]
fn successful_delivery_callback_marks_delivered() {
    let mut fx = Fx::new();
    let (id, a) = settled_single(&mut fx);
    set_env_promise("coop.near", 0, DEADLINE, vec![PromiseResult::Successful(vec![])]);
    fx.c.on_delivered(id, a.clone(), U128(4));
    assert_eq!(fx.members(id)[0].delivery, Some(Delivery::Delivered));
    assert!(fx.c.get_claimable(a).is_empty());
    assert_eq!(fx.c.get_stats().units_delivered, 4);
}

#[test]
fn failed_delivery_becomes_claimable_and_can_be_claimed() {
    let mut fx = Fx::new();
    let (id, a) = settled_single(&mut fx);
    set_env_promise("coop.near", 0, DEADLINE, vec![PromiseResult::Failed]);
    fx.c.on_delivered(id, a.clone(), U128(4));
    assert_eq!(fx.members(id)[0].delivery, Some(Delivery::Claimable));
    let claimable = fx.c.get_claimable(a.clone());
    assert_eq!(claimable.len(), 1);
    assert_eq!((claimable[0].token.as_str(), claimable[0].amount.0), (TOKEN, 4));
    assert!(get_logs().iter().any(|l| l.contains("\"event\":\"delivery_failed\"")));
    assert_eq!(fx.c.get_stats().units_delivered, 0);

    // A stranger cannot claim; the agent and its owner can.
    set_env("mallory.near", 0, DEADLINE);
    assert!(panics(|| {
        fx.c.claim(a.clone(), acct(TOKEN)).detach();
    }));
    set_env(OWNER, 0, DEADLINE);
    fx.c.claim(a.clone(), acct(TOKEN)).detach();
    let deposits = calls_to(TOKEN, "storage_deposit");
    let transfers = calls_to(TOKEN, "ft_transfer");
    assert_eq!((deposits.len(), transfers.len()), (1, 1));
    assert!(transfers[0].contains("\"amount\":\"4\"") && transfers[0].contains(a.as_str()));
    // Optimistically cleared so it cannot be claimed twice concurrently.
    assert!(fx.c.get_claimable(a.clone()).is_empty());
    set_env(a.as_str(), 0, DEADLINE);
    assert!(panics(|| {
        fx.c.claim(a.clone(), acct(TOKEN)).detach();
    }));

    // The retry fails again: the balance is restored.
    set_env_promise("coop.near", 0, DEADLINE, vec![PromiseResult::Failed]);
    assert!(!fx.c.on_claimed(a.clone(), acct(TOKEN), U128(4), vec![id]));
    assert_eq!(fx.c.get_claimable(a.clone())[0].amount.0, 4);

    // Claim again and this time it works.
    set_env(a.as_str(), 0, DEADLINE);
    fx.c.claim(a.clone(), acct(TOKEN)).detach();
    set_env_promise("coop.near", 0, DEADLINE, vec![PromiseResult::Successful(vec![])]);
    assert!(fx.c.on_claimed(a.clone(), acct(TOKEN), U128(4), vec![id]));
    assert!(fx.c.get_claimable(a.clone()).is_empty());
    assert_eq!(fx.members(id)[0].delivery, Some(Delivery::Delivered));
    assert_eq!(fx.c.get_stats().units_delivered, 4);
}

#[test]
fn failed_unsold_return_becomes_claimable_for_the_seller() {
    let mut fx = Fx::new();
    let (id, _) = settled_single(&mut fx);
    set_env_promise("coop.near", 0, DEADLINE, vec![PromiseResult::Failed]);
    fx.c.on_inventory_returned(id, acct(SELLER), U128(96));
    let claimable = fx.c.get_claimable(acct(SELLER));
    assert_eq!((claimable[0].token.as_str(), claimable[0].amount.0), (TOKEN, 96));
    set_env(SELLER, 0, DEADLINE);
    fx.c.claim(acct(SELLER), acct(TOKEN)).detach();
    assert_eq!(calls_to(TOKEN, "ft_transfer").len(), 1);
}

// ---------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------

#[test]
fn list_pools_is_newest_first_with_paging() {
    let mut fx = Fx::new();
    for _ in 0..5 {
        fx.offer(10);
    }
    let all = fx.c.list_pools(None, None);
    assert_eq!(all.iter().map(|p| p.id).collect::<Vec<_>>(), vec![5, 4, 3, 2, 1]);
    let page = fx.c.list_pools(Some(1), Some(2));
    assert_eq!(page.iter().map(|p| p.id).collect::<Vec<_>>(), vec![4, 3]);
    assert!(fx.c.get_pool(6).is_none() && fx.c.get_offer(0).is_none());
    assert_eq!(fx.c.get_stats().offers, 5);
}

#[test]
fn member_paging_and_json_shapes() {
    let mut fx = Fx::new();
    let id = fx.offer(100);
    for i in 0..4 {
        let a = fx.agent(&format!("p{i}"), 5 * NEAR, NEAR, 2);
        fx.join(&a, id, 1, None);
    }
    assert_eq!(fx.c.get_pool_members(id, Some(1), Some(2)).len(), 2);
    assert_eq!(fx.c.get_pool_members(id, Some(10), None).len(), 0);
    let view = fx.c.get_pool(id).unwrap();
    let json = near_sdk::serde_json::to_value(&view).unwrap();
    assert_eq!(json["status"], "Open");
    assert_eq!(json["offer"]["status"], "Open");
    assert_eq!(json["offer"]["tiers"][1]["unit_price"], (7 * NEAR / 10).to_string());
    assert_eq!(json["offer"]["deadline_ns"], DEADLINE.to_string());
    assert_eq!(json["projected"]["tier_index"], 0);
    assert!(json["result"].is_null());
    let member = near_sdk::serde_json::to_value(&fx.members(id)[0]).unwrap();
    assert_eq!(member["owner"], OWNER);
    assert!(member["outcome"].is_null() && member["delivery"].is_null());
}
