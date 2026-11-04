# contracts/coop/src

| File | Purpose |
|---|---|
| [lib.rs](lib.rs) | Contract state, limits (`MAX_MEMBERS`, `STORAGE_RESERVE`) and `new()` |
| [offer.rs](offer.rs) | Offers, price tiers, inventory deposits (`ft_on_transfer`), `improve_offer` and the "no worse for any buyer" check |
| [agent.rs](agent.rs) | Agent registration (direct sub-accounts only), budgets, limits, withdrawals, claimable balances and delivery promises |
| [pool.rs](pool.rs) | `join_pool` / `leave_pool`, conditional joins and the tally the resolver uses |
| [settle.rs](settle.rs) | `resolve` (largest consistent group) and chunked, idempotent `settle` |
| [views.rs](views.rs) | Read-only views and their structs |
| [events.rs](events.rs) | NEP-297 events |
| [tests.rs](tests.rs) | Native unit tests, including the brute-force check of `resolve` |

## Logic map

- To find who gets into the group at settlement visit [settle.rs](settle.rs) (`resolve`).
- To find the lock taken at join time, which caps what an agent can pay, visit [pool.rs](pool.rs) (`join_pool`) and [offer.rs](offer.rs) (lock price).
- To find seller payout, refunds and delivery visit [settle.rs](settle.rs) (`settle`) and [agent.rs](agent.rs) (`delivery_promise`).
- To find the invariant tests visit [tests.rs](tests.rs) (`invariant_over_30_random_members`, `resolve_equals_largest_consistent_subset_property`).
- The item-token connection (NEP-141 transfers, NEP-145 registration) can be found in [agent.rs](agent.rs) and [offer.rs](offer.rs).
