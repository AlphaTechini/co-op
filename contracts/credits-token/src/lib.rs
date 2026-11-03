//! Demo NEP-141 "API credit voucher" token used as the seller's inventory in Co-op.
//!
//! NEP-141 + NEP-145 + metadata via `near-contract-standards`. Decimals are 0, so one
//! token is one Co-op unit (`unit_amount = "1"`). This is a demo token: it is not backed
//! by any real service.

use near_contract_standards::fungible_token::events::FtMint;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::store::LazyOption;
use near_sdk::{
    assert_one_yocto, env, log, near, require, AccountId, BorshStorageKey, NearToken,
    PanicOnDefault, PromiseOrValue,
};

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Token,
    Metadata,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct CreditsToken {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    owner_id: AccountId,
}

#[near]
impl CreditsToken {
    /// Mints `total_supply` to `owner_id` (registering it). Decimals are fixed at 0.
    #[init]
    pub fn new(owner_id: AccountId, total_supply: U128, name: String, symbol: String) -> Self {
        require!(!env::state_exists(), "Already initialized");
        require!(!name.is_empty() && !symbol.is_empty(), "name and symbol are required");
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name,
            symbol,
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 0,
        };
        metadata.assert_valid();
        let mut this = Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(metadata)),
            owner_id: owner_id.clone(),
        };
        this.token.internal_register_account(&owner_id);
        if total_supply.0 > 0 {
            this.token.internal_deposit(&owner_id, total_supply.0);
            FtMint { owner_id: &owner_id, amount: total_supply, memo: Some("initial supply") }
                .emit();
        }
        this
    }

    /// Owner-only restock. Requires exactly 1 yoctoNEAR. If `account_id` is not yet
    /// registered on this token, it is registered here and the (small) NEP-145 storage
    /// is paid from this contract's own balance, so the seller never has to pre-register.
    #[payable]
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        assert_one_yocto();
        require!(env::predecessor_account_id() == self.owner_id, "Only the owner can mint");
        require!(amount.0 > 0, "amount must be positive");
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.0);
        FtMint { owner_id: &account_id, amount, memo: Some("mint") }.emit();
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner_id.clone()
    }
}

#[near]
impl FungibleTokenCore for CreditsToken {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for CreditsToken {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token.internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            log!("Account @{} burned {}", sender_id, burned_amount);
        }
        used_amount.into()
    }
}

#[near]
impl StorageManagement for CreditsToken {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        if let Some((account_id, balance)) = self.token.internal_storage_unregister(force) {
            log!("Closed @{} with {}", account_id, balance);
            true
        } else {
            false
        }
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenMetadataProvider for CreditsToken {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().clone().unwrap_or_else(|| env::panic_str("Metadata missing"))
    }
}

#[cfg(test)]
mod tests {
    use near_sdk::test_utils::{get_logs, VMContextBuilder};
    use near_sdk::testing_env;

    use super::*;

    const OWNER: &str = "owner.near";

    fn acct(s: &str) -> AccountId {
        s.parse().unwrap()
    }

    fn env_as(pred: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(acct("credits.near"))
            .predecessor_account_id(acct(pred))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }

    fn token() -> CreditsToken {
        env_as(OWNER, 0);
        CreditsToken::new(acct(OWNER), U128(1000), "Co-op Demo Voucher".into(), "CVCH".into())
    }

    #[test]
    fn init_mints_supply_to_owner_with_zero_decimals() {
        let t = token();
        assert_eq!(t.ft_total_supply().0, 1000);
        assert_eq!(t.ft_balance_of(acct(OWNER)).0, 1000);
        let m = t.ft_metadata();
        assert_eq!((m.decimals, m.symbol.as_str(), m.spec.as_str()), (0, "CVCH", "ft-1.0.0"));
        assert_eq!(m.name, "Co-op Demo Voucher");
        assert_eq!(t.get_owner(), acct(OWNER));
        assert!(get_logs().iter().any(|l| l.contains("\"ft_mint\"")));
    }

    #[test]
    fn registration_bound_fits_the_coop_storage_reserve() {
        // Co-op attaches 0.00125 NEAR to every storage_deposit it sends.
        let t = token();
        let min = t.storage_balance_bounds().min.as_yoctonear();
        assert!(min <= 1_250_000_000_000_000_000_000, "min storage deposit {min} too high");
    }

    #[test]
    fn owner_mints_with_one_yocto_and_auto_registers() {
        let mut t = token();
        env_as(OWNER, 1);
        t.mint(acct("seller.near"), U128(50));
        assert_eq!(t.ft_balance_of(acct("seller.near")).0, 50);
        assert_eq!(t.ft_total_supply().0, 1050);
        assert!(t.storage_balance_of(acct("seller.near")).is_some());
        env_as(OWNER, 1);
        t.mint(acct("seller.near"), U128(7));
        assert_eq!(t.ft_balance_of(acct("seller.near")).0, 57);
    }

    #[test]
    #[should_panic(expected = "Requires attached deposit of exactly 1 yoctoNEAR")]
    fn mint_requires_one_yocto() {
        let mut t = token();
        env_as(OWNER, 0);
        t.mint(acct("seller.near"), U128(1));
    }

    #[test]
    #[should_panic(expected = "Only the owner can mint")]
    fn mint_is_owner_only() {
        let mut t = token();
        env_as("mallory.near", 1);
        t.mint(acct("mallory.near"), U128(1));
    }

    #[test]
    fn transfers_need_registration_and_one_yocto() {
        let mut t = token();
        // NEP-145 registration of the receiver, as Co-op does at delivery.
        env_as("coop.near", 1_250_000_000_000_000_000_000);
        t.storage_deposit(Some(acct("agent.near")), Some(true));
        env_as(OWNER, 1);
        t.ft_transfer(acct("agent.near"), U128(5), Some("co-op pool 1".into()));
        assert_eq!(t.ft_balance_of(acct("agent.near")).0, 5);
        assert_eq!(t.ft_balance_of(acct(OWNER)).0, 995);
    }

    #[test]
    #[should_panic(expected = "not registered")]
    fn transfer_to_unregistered_account_fails() {
        let mut t = token();
        env_as(OWNER, 1);
        t.ft_transfer(acct("nobody.near"), U128(5), None);
    }
}
