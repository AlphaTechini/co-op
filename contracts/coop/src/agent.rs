//! Agents: registration, budgets, limits, withdrawals and claimable (undelivered) balances.

use near_sdk::serde_json::json;

use crate::pool::Delivery;
use crate::*;

const CLAIM_STORAGE_GAS: Gas = Gas::from_tgas(15);
const CLAIM_TRANSFER_GAS: Gas = Gas::from_tgas(15);
const CLAIM_CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [json, borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentLimits {
    pub max_unit_price: U128,
    pub max_units_per_pool: u32,
    pub allowed_sellers: Option<Vec<AccountId>>,
    pub expires_at_ns: Option<U64>,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct AgentRecord {
    pub owner: AccountId,
    pub budget_available: u128,
    pub budget_locked: u128,
    pub limits: AgentLimits,
    pub active_pools: Vec<u64>,
    pub registered_at_ns: u64,
}

/// An item-token balance the contract holds for `account` because a transfer failed.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct ClaimableEntry {
    pub token: AccountId,
    pub amount: u128,
    /// Pools whose membership delivery is `Claimable` for this token (empty for sellers).
    pub pools: Vec<u64>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ClaimableView {
    pub token: AccountId,
    pub amount: U128,
}

fn validate_limits(limits: &AgentLimits, now: u64) {
    require!(limits.max_unit_price.0 > 0, "max_unit_price must be positive");
    require!(limits.max_units_per_pool > 0, "max_units_per_pool must be positive");
    if let Some(sellers) = &limits.allowed_sellers {
        require!(sellers.len() <= MAX_ALLOWED_SELLERS, "At most 32 allowed_sellers");
    }
    if let Some(expires) = limits.expires_at_ns {
        require!(expires.0 > now, "expires_at_ns must be in the future");
    }
}

/// One batch promise to the item token: register `receiver` (NEP-145, funded with
/// `STORAGE_RESERVE`; the token refunds it to us if the account was already registered)
/// and then `ft_transfer` the goods. The batch succeeds or fails as a unit.
pub(crate) fn delivery_promise(
    token: &AccountId,
    receiver: &AccountId,
    amount: u128,
    memo: &str,
    storage_gas: Gas,
    transfer_gas: Gas,
) -> Promise {
    Promise::new(token.clone())
        .function_call(
            "storage_deposit".to_string(),
            json!({ "account_id": receiver, "registration_only": true }).to_string().into_bytes(),
            yocto(STORAGE_RESERVE),
            storage_gas,
        )
        .function_call(
            "ft_transfer".to_string(),
            json!({ "receiver_id": receiver, "amount": amount.to_string(), "memo": memo })
                .to_string()
                .into_bytes(),
            NearToken::from_yoctonear(1),
            transfer_gas,
        )
}

pub(crate) fn add_claimable(
    claimable: &mut LookupMap<AccountId, Vec<ClaimableEntry>>,
    account: &AccountId,
    token: &AccountId,
    amount: u128,
    pools: &[u64],
) {
    if claimable.get(account).is_none() {
        claimable.insert(account.clone(), Vec::new());
    }
    let entries = claimable.get_mut(account).unwrap_or_else(|| env::panic_str("Claimable"));
    match entries.iter_mut().find(|e| &e.token == token) {
        Some(entry) => {
            entry.amount += amount;
            entry.pools.extend_from_slice(pools);
        }
        None => entries.push(ClaimableEntry { token: token.clone(), amount, pools: pools.to_vec() }),
    }
}

impl Coop {
    fn agent_owned_by_caller(&mut self, agent_id: &AccountId) -> &mut AgentRecord {
        let caller = env::predecessor_account_id();
        let agent = self
            .agents
            .get_mut(agent_id)
            .unwrap_or_else(|| env::panic_str("Agent not found"));
        require!(agent.owner == caller, "Only the agent's owner can do this");
        agent
    }
}

#[near]
impl Coop {
    /// The attached deposit funds the agent: storage is deducted, the rest becomes
    /// `budget_available`. `agent_id` must be a direct sub-account of the caller.
    #[payable]
    pub fn register_agent(&mut self, agent_id: AccountId, limits: AgentLimits) {
        let owner = env::predecessor_account_id();
        let now = now_ns();
        let label = agent_id.as_str().strip_suffix(&format!(".{owner}"));
        require!(
            matches!(label, Some(l) if !l.is_empty() && !l.contains('.')),
            "agent_id must be a direct sub-account of the caller"
        );
        require!(agent_id != env::current_account_id(), "The Co-op contract cannot be an agent");
        require!(!self.agents.contains_key(&agent_id), "Agent is already registered");
        validate_limits(&limits, now);

        let before = env::storage_usage();
        self.agents.insert(
            agent_id.clone(),
            AgentRecord {
                owner: owner.clone(),
                budget_available: 0,
                budget_locked: 0,
                limits,
                active_pools: Vec::new(),
                registered_at_ns: now,
            },
        );
        self.agents.flush();
        let cost = storage_cost(before, env::storage_usage());
        let deposit = env::attached_deposit().as_yoctonear();
        require!(deposit >= cost, format!("Attached deposit must cover storage: {cost} yoctoNEAR"));
        let budget = deposit - cost;
        let agent = self.agents.get_mut(&agent_id).unwrap_or_else(|| env::panic_str("Agent"));
        agent.budget_available = budget;
        events::agent_registered(&agent_id, &owner, budget);
    }

    /// Adds the attached deposit to the agent's available budget.
    #[payable]
    pub fn fund_agent(&mut self, agent_id: AccountId) {
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0, "Attach a deposit to fund the agent");
        let agent = self.agent_owned_by_caller(&agent_id);
        agent.budget_available += amount;
        events::agent_funded(&agent_id, amount);
    }

    /// Replaces the limits. Existing locks are unaffected. Requires 1 yoctoNEAR.
    #[payable]
    pub fn update_limits(&mut self, agent_id: AccountId, limits: AgentLimits) {
        near_sdk::assert_one_yocto();
        validate_limits(&limits, now_ns());
        let agent = self.agent_owned_by_caller(&agent_id);
        agent.limits = limits;
    }

    /// Sends up to `budget_available` (all if `amount` is `None`) to the owner.
    /// Requires 1 yoctoNEAR so a function-call key can never call it.
    #[payable]
    pub fn withdraw(&mut self, agent_id: AccountId, amount: Option<U128>) {
        near_sdk::assert_one_yocto();
        let agent = self.agent_owned_by_caller(&agent_id);
        let amount = amount.map_or(agent.budget_available, |a| a.0);
        require!(amount <= agent.budget_available, "Amount exceeds available budget");
        agent.budget_available -= amount;
        let owner = agent.owner.clone();
        if amount > 0 {
            Promise::new(owner).transfer(yocto(amount)).detach();
        }
        events::agent_withdrew(&agent_id, amount);
    }

    /// Retries delivery of a claimable item-token balance (failed delivery or failed
    /// inventory return). Callable by the account itself or, for agents, by its owner.
    pub fn claim(&mut self, agent_id: AccountId, token: AccountId) -> Promise {
        let caller = env::predecessor_account_id();
        let authorised = caller == agent_id
            || self.agents.get(&agent_id).is_some_and(|agent| agent.owner == caller);
        require!(authorised, "Only the account or its owner can claim");
        require!(
            gas_left() >= CLAIM_STORAGE_GAS.saturating_add(CLAIM_TRANSFER_GAS).saturating_add(CLAIM_CALLBACK_GAS).saturating_add(Gas::from_tgas(15)),
            "Attach more gas to claim"
        );
        let entries = self
            .claimable
            .get_mut(&agent_id)
            .unwrap_or_else(|| env::panic_str("Nothing to claim"));
        let position = entries
            .iter()
            .position(|e| e.token == token && e.amount > 0)
            .unwrap_or_else(|| env::panic_str("Nothing to claim"));
        let entry = entries.remove(position);

        delivery_promise(
            &token,
            &agent_id,
            entry.amount,
            "co-op claim",
            CLAIM_STORAGE_GAS,
            CLAIM_TRANSFER_GAS,
        )
        .then(
            Self::ext(env::current_account_id())
                .with_static_gas(CLAIM_CALLBACK_GAS)
                .on_claimed(agent_id, token, U128(entry.amount), entry.pools),
        )
    }

    /// Callback of `claim`. Returns whether the delivery succeeded; on failure the
    /// balance is claimable again.
    #[private]
    pub fn on_claimed(
        &mut self,
        agent_id: AccountId,
        token: AccountId,
        amount: U128,
        pools: Vec<u64>,
    ) -> bool {
        let delivered = promise_succeeded();
        if delivered {
            let mut units = 0u64;
            for pool_id in &pools {
                if let Some(membership) =
                    self.pools.get_mut(pool_id).and_then(|p| p.memberships.get_mut(&agent_id))
                {
                    membership.delivery = Some(Delivery::Delivered);
                    units += u64::from(membership.units);
                }
            }
            self.stats.units_delivered += units;
        } else {
            add_claimable(&mut self.claimable, &agent_id, &token, amount.0, &pools);
            events::delivery_failed(pools.first().copied().unwrap_or(0), &agent_id, &token, amount.0);
        }
        delivered
    }
}
