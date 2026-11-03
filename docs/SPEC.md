# Co-op: Interface Spec

This file is the contract between the components (Rust contract, TypeScript agents, Fastify server, SvelteKit web). `docs/PRD.md` explains *why*; this file pins down *exact names and shapes*. If code and this file disagree, fix one of them in the same commit.

## 0. Conventions

- NEAR amounts are yoctoNEAR, JSON-encoded as decimal strings (`U128`).
- Timestamps are nanoseconds since epoch, JSON-encoded as decimal strings (`U64`).
- Ids (`offer_id`, `pool_id`) are `u64` JSON numbers. `pool_id == offer_id` (every offer has exactly one pool, created with it). Ids start at 1.
- Unit counts are `u32` JSON numbers.
- Item token amounts are `U128` strings in the token's base units. `unit_amount` = token base units per unit.
- Enum statuses serialize as their variant name string, e.g. `"Open"`.

## 1. Contract `coop` (contracts/coop)

`#[init] new()`: no admin, no owner. Nobody can change the rules after deploy.

### 1.1 Types

```text
Tier            { min_units: u32, unit_price: U128 }
AgentLimits     { max_unit_price: U128, max_units_per_pool: u32,
                  allowed_sellers: Option<Vec<AccountId>>, expires_at_ns: Option<U64> }
```

Tiers: non-empty, strictly ascending `min_units` (first `min_units >= 1`), strictly descending `unit_price`, last `min_units <= max_units`, max 8 tiers.

### 1.2 Views

`get_offer(offer_id) -> Option<OfferView>`
```text
OfferView {
  id, seller, item_token, title, description,
  tiers: Vec<Tier>, max_units, unit_amount: U128, inventory_held: U128,
  deadline_ns: U64, lock_window_ns: U64, lock_at_ns: U64,   // lock_at = deadline - lock_window
  status: "AwaitingInventory" | "Open" | "Closed",
  created_at_ns: U64
}
```

`get_pool(pool_id) -> Option<PoolView>`, `list_pools(from_index: Option<u32>, limit: Option<u32>) -> Vec<PoolView>` (newest first, default limit 20, max 50)
```text
PoolView {
  id, offer: OfferView,
  status: "AwaitingInventory" | "Open" | "Locked" | "Expired" | "Settling" | "Settled" | "Refunded",
      // Locked  = now >= lock_at && now < deadline (derived in the view)
      // Expired = now >= deadline, settle() not yet called (derived in the view)
  member_count: u32,
  units_unconditional: u32, units_conditional: u32,
  projected: Projection,            // what settle() would do right now
  result: Option<SettlementResult>, // set once settle() has resolved the pool
  settle_cursor: u32,               // members processed so far
}
Projection       { units: u32, members_in: u32, tier_index: Option<u32>, unit_price: Option<U128> }
SettlementResult { units: u32, members_in: u32, tier_index: Option<u32>, unit_price: Option<U128>,
                   seller_payout: U128, resolved_at_ns: U64 }
```

`get_pool_members(pool_id, from_index: Option<u32>, limit: Option<u32>) -> Vec<MemberView>` (join order, default 50, max 100)
```text
MemberView {
  agent_id, owner, units, threshold_units: Option<u32>, locked: U128, memo: String,
  joined_at_ns: U64,
  projected_in: bool,                                   // in the group if settled now
  outcome: Option<"Filled" | "Excluded" | "Refunded">,  // set during settlement
  paid: Option<U128>, refunded: Option<U128>,
  delivery: Option<"Pending" | "Delivered" | "Claimable">
}
```

`projected_price(pool_id) -> Projection`

`get_agent(agent_id) -> Option<AgentView>`, `list_agents(from_index, limit) -> Vec<AgentView>`
```text
AgentView { agent_id, owner, budget_available: U128, budget_locked: U128, limits: AgentLimits,
            active_pools: Vec<u64>, registered_at_ns: U64 }
```

`get_claimable(account_id) -> Vec<{ token: AccountId, amount: U128 }>`

`get_stats() -> { offers: u64, pools_settled: u64, pools_refunded: u64, agents: u64, volume: U128, units_delivered: u64 }`

### 1.3 Change methods

| Method | Caller | Deposit | Behaviour |
|---|---|---|---|
| `create_offer(item_token, title, description, tiers, max_units, unit_amount, deadline_ns, lock_window_ns) -> u64` | seller | storage (excess refunded) | Validates tiers, `title <= 64` chars, `description <= 280`, `deadline > now + lock_window`, `max_units <= 10_000`. Creates offer + pool (status `AwaitingInventory`). |
| `ft_on_transfer(sender_id, amount, msg) -> U128` | item token | — | `msg = {"offer_id": N}`. Rejects (returns full amount) unless predecessor == offer.item_token and sender == offer.seller and offer not closed. Adds to `inventory_held`; offer becomes `Open` once `inventory_held >= max_units * unit_amount`. Returns `"0"`. |
| `improve_offer(offer_id, tiers)` (P1) | seller | 1 yocto | Accept only if, for every total `t` in `1..=max_units`, new price(t) <= old price(t) (undefined = infinity) and new tiers are valid. Only before `lock_at`. |
| `register_agent(agent_id, limits)` | owner | budget + storage | `agent_id` must be `<label>.<predecessor>` with no dot in label. Storage cost measured and deducted; rest becomes `budget_available`. Fails if already registered. |
| `fund_agent(agent_id)` | owner | amount | Adds to `budget_available`. |
| `update_limits(agent_id, limits)` | owner | 1 yocto | Replaces limits (does not affect existing locks). |
| `withdraw(agent_id, amount: Option<U128>)` | owner | 1 yocto | Sends up to `budget_available` (all if `None`) to the owner. |
| `join_pool(pool_id, units, threshold_units: Option<u32>, memo: Option<String>)` | agent | **none** (works with function-call key) | See 1.4. |
| `leave_pool(pool_id)` | agent | none | Only before `lock_at`. Lock and membership storage returned to budget. |
| `settle(pool_id, max_members: Option<u32>) -> SettleProgress` | anyone | — | Only at/after `deadline`. Chunked, idempotent. See 1.5. |
| `claim(agent_id, token)` | agent or its owner | none | Retries delivery of a claimable balance. |

`SettleProgress { status, processed: u32, remaining: u32 }` (`processed` is the cumulative cursor, not this call's count; `remaining == 0` with status `Settling` means one more call finishes: seller payout + unsold inventory return)

### 1.4 join_pool rules

Rejects if: caller not a registered agent; offer not `Open`; `now >= lock_at`; agent expired; seller not in `allowed_sellers` (if set); already a member; `units == 0`; `units > max_units_per_pool`; pool total units + units > `max_units`; member count would exceed `MAX_MEMBERS` (100); memo > 140 chars; `threshold_units == Some(0)`.

Lock price: unconditional -> `tiers[0].unit_price`; conditional with threshold T -> price of the best tier with `min_units <= T` (or `tiers[0]` if none). Reject if lock price > `limits.max_unit_price`.

`locked = units * lock_price + STORAGE_RESERVE` (`STORAGE_RESERVE` = 0.00125 NEAR covers NEP-145 registration on the item token). Membership storage cost is charged from `budget_available` too (returned on leave). Reject if `budget_available` is insufficient.

### 1.5 Settlement

1. **Resolve** (first call after deadline): the group is the **largest set of members whose conditions all hold**. Algorithm: start with *all* members, total = sum of units; sort conditional members by threshold descending; while the highest remaining threshold > total, remove that member and subtract its units. (Union of consistent sets is consistent, so this greatest fixed point is unique and maximal. It is better than growing from unconditional members: two conditional agents of 25 units each with threshold 50 both get in.) Tier = best tier with `min_units <= total`. If no tier: pool `Refunded`. Else `Settling`, `unit_price` fixed. `projected` uses the same function.
2. **Process members** in chunks of `max_members` (default `DEFAULT_CHUNK`, measured by `checks/04`):
   - Filled: `paid = units * unit_price`; `refunded = locked - paid - STORAGE_RESERVE_SPENT`; agent `budget_locked -= locked`, `budget_available += refunded`. One batch promise to the item token: `storage_deposit(account_id=agent, registration_only=true)` with `STORAGE_RESERVE` attached, then `ft_transfer(agent, units*unit_amount)` with 1 yocto; callback `on_delivered` (private). Failure -> `Claimable` balance (never lost).
   - Excluded / Refunded pool: full `locked` returned to `budget_available`, outcome `Excluded` or `Refunded`.
3. **Finish** (call that processes the last member): transfer `seller_payout = units * unit_price` NEAR to the seller, `ft_transfer` unsold inventory back to the seller, status `Settled` (or `Refunded`, where all inventory returns). Calls after that are no-ops returning the final status.

**Invariant (tested):** for every member, `paid <= units * limits.max_unit_price` at join time and `paid + refunded + storage_spent == locked`; seller is paid only if a tier is reached; sum over members of `paid` == `seller_payout`.

### 1.6 Events (NEP-297)

`EVENT_JSON:{"standard":"coop","version":"1.0.0","event":<name>,"data":[{...}]}`

| event | data |
|---|---|
| `offer_created` | offer_id, seller, item_token, max_units, deadline_ns |
| `inventory_deposited` | offer_id, amount, inventory_held |
| `offer_opened` | offer_id |
| `offer_improved` | offer_id, tiers |
| `agent_registered` | agent_id, owner, budget |
| `agent_funded` / `agent_withdrew` | agent_id, amount |
| `pool_joined` | pool_id, agent_id, units, threshold_units, locked, memo |
| `pool_left` | pool_id, agent_id, released |
| `pool_resolved` | pool_id, units, members_in, tier_index, unit_price |
| `member_filled` | pool_id, agent_id, units, paid, refunded |
| `member_excluded` | pool_id, agent_id, released |
| `delivery_failed` | pool_id, agent_id, token, amount |
| `seller_paid` | pool_id, seller, amount |
| `pool_settled` / `pool_refunded` | pool_id |

## 2. Contract `credits-token` (contracts/credits-token)

Standard NEP-141 + NEP-145 + metadata via `near-contract-standards`. `new(owner_id, total_supply, name, symbol)`, decimals 0, so 1 token = 1 unit (`unit_amount = "1"`). `mint(account_id, amount)` owner-only (1 yocto) so the demo seller can restock. Metadata name says it is a demo voucher.

## 3. Off-chain packages (pnpm workspace)

| Package | Path | Purpose |
|---|---|---|
| `@coop/agents` | `agents/` | Chain client, policy engine, agent archetypes, runtime, scenario runner, sandbox harness |
| `@coop/checks` | `checks/` | Capability checks 01-06 |
| `@coop/server` | `server/` | Fastify API: spawn agent, activity log, config; hosts the agent runtime |
| `@coop/web` | `web/` | SvelteKit dashboard (static adapter, SPA fallback) |

Shared env vars (see `.env.example`): `NEAR_NETWORK` (`sandbox` / `testnet`), `NEAR_RPC_URL`, `COOP_CONTRACT_ID`, `CREDITS_TOKEN_ID`, `OPERATOR_ACCOUNT_ID`, `OPERATOR_PRIVATE_KEY`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, `PORT`, `SPAWN_MAX_AGENTS`, `SPAWN_MAX_BUDGET_NEAR`, `PUBLIC_RPC_URL`, `PUBLIC_COOP_CONTRACT_ID`, `PUBLIC_API_URL`, `PUBLIC_NETWORK`.

### 3.1 Server HTTP API (`server/`, default port 8787)

| Route | Response |
|---|---|
| `GET /api/health` | `{ ok: true, network, contractId, llm: "on" \| "off" }` |
| `GET /api/config` | `{ network, rpcUrl, contractId, tokenId, explorerTxBase, explorerAccountBase, spawn: { enabled, maxBudgetNear, remaining } }` |
| `GET /api/activity?pool_id=&limit=` | `ActivityEntry[]` newest first |
| `GET /api/stream` | SSE, one `ActivityEntry` per `data:` line |
| `GET /api/agents` | spawned agents `{ agent_id, archetype, brief, policy, created_at, status }[]` |
| `POST /api/agents` | body `{ name, brief, budget_near }` -> `{ agent_id, policy, parser: "llm" \| "rules", txs: TxRef[] }`; 400 / 429 / 503 with `{ error }` |

```text
ActivityEntry { id, ts (ms), kind: "offer_created"|"pool_joined"|"pool_left"|"decision"|"settle"|"pool_settled"|"pool_refunded"|"spawned"|"error",
                pool_id?, agent_id?, message, reason?, tx?: TxRef }
TxRef { hash, signer, receiver, method, explorer_url? }
```

The web app must work without the server (state comes straight from RPC views); the server adds the activity feed, tx hashes and spawning.

## 4. Implementation notes (contract)

- A pool with no reachable tier has `result = { units: 0, members_in: 0, seller_payout: "0", ... }`; members get `outcome = "Refunded"` and a `member_excluded` event; status goes `Settling` -> `Refunded` on the finishing call.
- `ft_on_transfer` refuses deposits once settlement has started; a malformed `msg` returns the full amount.
- Membership storage is charged from the agent's budget at join (returned on leave, spent after settlement) and is not part of `locked`.
- NEP-145 refunds for already-registered accounts accrue to the contract balance and fund `claim` retries.
- `claim` / `get_claimable` also cover the seller (failed unsold-inventory return).
- Gas: a filled member costs roughly 40 Tgas of a `settle` call (18 Tgas attached to the token batch + callback, plus receipt overhead), so one 300 Tgas call settles about 6 members; `settle` sizes chunks from remaining gas, `DEFAULT_CHUNK` is a ceiling.
