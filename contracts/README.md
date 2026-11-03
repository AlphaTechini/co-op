# Co-op contracts

Two NEAR contracts (near-sdk 5.30, Rust). Interface names and JSON shapes are pinned by `docs/SPEC.md`.

| Crate | Path | What it is |
|---|---|---|
| `coop` | `coop/` | Offers with price tiers, agent budgets, pools, conditional joins, chunked settlement |
| `credits_token` | `credits-token/` | Demo NEP-141 + NEP-145 voucher token (decimals 0) used as the seller's inventory |

Built artifacts and their checksums live in `res/` (`coop.wasm`, `credits_token.wasm`, `SHA256SUMS`).

## Build and test

```bash
cargo test                       # both crates, native unit tests (from the repo root)
cargo clippy --all-targets -- -D warnings
./contracts/build.sh             # builds both wasm files into contracts/res and writes SHA256SUMS
(cd contracts/res && sha256sum -c SHA256SUMS)   # verify the committed wasm
```

`build.sh` needs `cargo-near` 0.22.0 (`cargo install cargo-near --version 0.22.0 --locked`). It runs
`cargo near build non-reproducible-wasm --no-abi --out-dir res` in each crate: cargo-near applies the
flags near-sdk needs and runs `wasm-opt`. A plain `cargo build` of a contract is refused by near-sdk;
use `cargo check --target wasm32-unknown-unknown` to type-check without cargo-near. The wasm embeds
build paths, so a rebuild in another checkout can differ byte for byte; the committed hash is the hash
of the committed file.

## `coop` methods

Amounts are yoctoNEAR strings, times are nanosecond strings, ids are `u64`; ids start at 1 and `pool_id == offer_id`.

| Method | Who | Deposit | What it does |
|---|---|---|---|
| `new()` | deploy | | No admin, no owner |
| `create_offer(item_token, title, description, tiers, max_units, unit_amount, deadline_ns, lock_window_ns)` | seller | storage (excess refunded) | Validates tiers, creates offer + pool, returns id |
| `ft_on_transfer(sender_id, amount, msg)` | item token | | Seller's inventory deposit, `msg = {"offer_id":N}`; offer turns `Open` once `max_units * unit_amount` is held; anything unexpected is returned |
| `improve_offer(offer_id, tiers)` | seller | 1 yocto | Accepts only ladders that are no worse for buyers at any total; only before lock |
| `register_agent(agent_id, limits)` | owner | budget + storage | `agent_id` must be `<label>.<owner>`; storage is deducted, the rest is the budget |
| `fund_agent(agent_id)` / `withdraw(agent_id, amount?)` / `update_limits(agent_id, limits)` | owner | attached / 1 yocto / 1 yocto | Budget management |
| `join_pool(pool_id, units, threshold_units?, memo?)` | agent | none | Locks `units * lock_price + STORAGE_RESERVE` from the agent's budget, plus membership storage |
| `leave_pool(pool_id)` | agent | none | Before lock only; returns lock and storage |
| `settle(pool_id, max_members?)` | anyone | none | After the deadline; chunked, idempotent |
| `claim(agent_id, token)` | account or its owner | none | Retries a failed delivery or failed unsold-inventory return |
| views | anyone | | `get_offer`, `get_pool`, `list_pools`, `get_pool_members`, `projected_price`, `get_agent`, `list_agents`, `get_claimable`, `get_stats` |

Private callbacks: `on_delivered`, `on_inventory_returned`, `on_claimed`. Events are NEP-297 `EVENT_JSON:{"standard":"coop","version":"1.0.0",...}` (see `src/events.rs`).

Lock price: an unconditional member locks the entry tier price; a conditional member with threshold T
locks the price of the best tier with `min_units <= T`. The join is rejected if that price exceeds the
agent's `max_unit_price`, so no agent can ever be charged more than its own limit.

## Settlement algorithm (`src/settle.rs`, `src/offer.rs`)

1. **Resolve** (first `settle` call after the deadline, pure function `resolve`): the group is the largest
   set of members whose conditions all hold. Start with everyone in, total = all units. Sort conditional
   members by threshold, highest first; while the highest remaining threshold exceeds the total, drop that
   member and subtract its units. The union of two consistent sets is consistent, so this greatest fixed
   point is unique and maximal. Two conditional members of 25 units with threshold 50 both get in.
   A property test checks it against brute force over all subsets.
2. **Price**: `price_for(tiers, total)` is the last tier with `min_units <= total`. No tier: the pool becomes
   `Refunded`, every lock is returned, the seller is not paid and all inventory goes back.
3. **Chunks**: each `settle` call processes members from `settle_cursor` in join order, at most `max_members`
   (default `DEFAULT_CHUNK` = 10) and at most what the gas left in the call allows (measured with
   `env::used_gas()` after the first filled member, plus a reserve for the finish step).
   - Filled member: `paid = units * unit_price`, `refunded = locked - paid - STORAGE_RESERVE`, then one batch
     promise to the item token (`storage_deposit(registration_only)` with `STORAGE_RESERVE` attached, then
     `ft_transfer` with 1 yocto) and the private callback `on_delivered`. A failed batch marks the delivery
     `Claimable` and records the balance for `claim`; units are never lost.
   - Excluded member (group priced, member out) or any member of a refunded pool: the full lock returns to the budget.
4. **Finish** (the call that processes the last member, if gas remains; otherwise one more call): pay the
   seller `units * unit_price` NEAR, `ft_transfer` the unsold inventory back, close the offer, set `Settled`
   or `Refunded`. Calls after that return the final status and change nothing.

Per-member invariant (tested): `paid <= units * max_unit_price`, `paid + refunded + storage_spent == locked`
(`storage_spent` = `STORAGE_RESERVE` for filled members, 0 otherwise), and the sum of `paid` equals the seller payout.
A pool is capped at 100 members (`MAX_MEMBERS`).

### Storage accounting

- `create_offer`: measured storage delta (plus room for a full 8-tier ladder so `improve_offer` never needs a
  deposit) is charged from the deposit, the rest is refunded.
- `register_agent`: measured storage delta is deducted from the deposit; the remainder is `budget_available`.
- `join_pool`: measured storage delta (membership, tally, agent record) is charged from `budget_available`,
  recorded in the membership and returned by `leave_pool`. After settlement it stays spent.
- `STORAGE_RESERVE` (0.00125 NEAR) is spent per filled member. If the agent was already registered on the item
  token, the token refunds it to the contract account, so those refunds accrue to the contract. They also fund
  the retry in `claim` after a failed delivery.
- The seller payout is a plain NEAR transfer; it can only fail if the seller account no longer exists.

### Gas

Attached per filled member: `storage_deposit` 6 Tgas, `ft_transfer` 6 Tgas, callback 6 Tgas. With receipt fees
a filled member costs about 40 Tgas of the call's budget (native `used_gas` measurement), so a 300 Tgas
`settle` handles roughly 6 members. `DEFAULT_CHUNK` and the gas constants are in `src/settle.rs` and are meant
to be tuned from the sandbox measurements (`checks/04`).

## `credits_token`

`new(owner_id, total_supply, name, symbol)` registers the owner and mints the supply; decimals are 0, so one
token is one Co-op unit (`unit_amount = "1"`). `mint(account_id, amount)` is owner-only and needs exactly 1
yocto; it registers the recipient if needed, with that storage paid from the token contract's balance. Give it
a name that says it is a demo voucher. The NEP-145 minimum balance fits within Co-op's `STORAGE_RESERVE` (tested).
