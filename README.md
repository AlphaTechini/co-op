# Co-op

**Co-op lets AI buying agents pool their orders on NEAR so a group of small buyers gets the bulk price, with the contract guaranteeing that no agent ever pays more than its own limit.**

**The product: rooms.** Open a room for what you need (LLM API credits, GPU hours, dataset seats), send your agents in from your own NEAR wallet, and share the 6-character code. Every agent that joins pushes the price down for the whole group; at the deadline the contract settles everyone at the tier the group reached.

It is for people and teams who run AI agents that buy the same digital goods in small quantities (API credits, compute hours, data access, licences, tickets), and for sellers who offer volume pricing but never meet a buyer big enough to reach it.

Built for NEAR HACKATHON. Tracks: **AI Swarms** (`swarms`, primary) and **Agent Economy** (`agents`).

Everything in this repository was built and verified against a **local NEAR sandbox** (nearcore 2.14.0, via the `near-sandbox` npm package) and is also **deployed on NEAR testnet**, with a 12-agent testnet run on record and a hosted demo. The section below links each piece.

**Try it.**
- Hosted, testnet: https://coop.cyberpunkinc.xyz. Open a room, connect a testnet wallet, spawn agents, share the code; no wallet needed for the server-paid demo spawn.
- Local, no keys: `make verify` (Linux or Apple Silicon, Node 22+, pnpm; about 1 minute, plus install and a first-time download of the nearcore binary). It deploys the committed wasm to a local sandbox, runs 10 agents to settlement and recomputes the invariants.
- Proof in the repo: [`evidence/`](evidence/README.md) (testnet deploy, the 12-agent testnet run with 64 tx hashes, the rooms and wallet-spawn check) and [`docs/CLAIMS.md`](docs/CLAIMS.md) (every claim with `file:line` and its proof).

**In short.** A seller posts an offer with price tiers and deposits the goods in the contract. Buyer agents, each holding only a restricted function-call key, lock a budget in the contract and join the pool, outright or conditionally ("only if the group reaches N units"). After the deadline anyone calls `settle`: the contract finds the largest group whose conditions all hold, charges each member the tier price that group reached, pays the seller, delivers the goods and refunds the difference. If no tier is reached, everyone is refunded. **Invariant: no agent pays more than its own limit, and the seller is paid only if the group reaches a price tier.** Run `make verify` (Node 22+ and pnpm, no Rust, no keys) to see a 10-agent pool settle on a local sandbox and the invariants recomputed from chain views.

## Live deployment

| Item | Value | Status |
|---|---|---|
| Testnet Co-op contract | [`coop.coop-alpha.testnet`](https://testnet.nearblocks.io/address/coop.coop-alpha.testnet) | Deployed; on-chain code hash matches `contracts/res/SHA256SUMS` ([`evidence/testnet-deploy.md`](evidence/testnet-deploy.md)) |
| Testnet demo token | [`credits.coop-alpha.testnet`](https://testnet.nearblocks.io/address/credits.coop-alpha.testnet) | Deployed, same evidence file |
| Rooms, wallet spawn, withdraw | [`evidence/check-07-wallet-spawn.txt`](evidence/check-07-wallet-spawn.txt) | Checked on testnet against the hosted server by [`checks/07-wallet-spawn.ts`](checks/07-wallet-spawn.ts) |
| Extra room items | [`gpu-hours.coop-alpha.testnet`](https://testnet.nearblocks.io/address/gpu-hours.coop-alpha.testnet), [`dataset-seats.coop-alpha.testnet`](https://testnet.nearblocks.io/address/dataset-seats.coop-alpha.testnet) | Deployed from the same token wasm ([`evidence/testnet-items.md`](evidence/testnet-items.md)) |
| Hosted demo URL | https://coop.cyberpunkinc.xyz (API: https://34-138-43-239.sslip.io/api/health) | Live. Site on Vercel, server on a GCP free-tier VM: [deploy/README.md](deploy/README.md) |
| Testnet run log (12+ agents, every tx hash) | [`evidence/testnet-run-2026-11-05T11-55-16-789Z.md`](evidence/testnet-run-2026-11-05T11-55-16-789Z.md) | Done: 12 agents, 64 transactions, settled at tier 2, all invariants hold. Produced by `pnpm --filter @coop/agents scenario --agents 12 --network testnet --prefix run2` (`--prefix` gives a re-run fresh agent names) |
| Demo video (X post) | https://x.com/ApexSys_Dev/status/2118893440066830717 | Live |
| Other project by the same builder | Handover: [repo](https://github.com/AlphaTechini/handover), [live](https://handover-blush.vercel.app) | Live |

To see Co-op work on your own machine: `make verify` (one command, section 7) and `make demo` (full stack, section 8).

## 2. Track fit

| Track brief item | Where Co-op does it | File |
|---|---|---|
| Collective purchasing | Pools aggregate many agents' small orders into one tiered purchase | [`contracts/coop/src/pool.rs`](contracts/coop/src/pool.rs) (`join_pool` line 200, `leave_pool` line 291) |
| Coordination markets | Agents read open pools, compare the projected price with their limit, join now, join conditionally, or skip | [`agents/src/policy.ts`](agents/src/policy.ts) (`decide` line 204), [`agents/src/runtime.ts`](agents/src/runtime.ts) (`AgentRuntime` line 74) |
| Intent-based settlement | A conditional join ("in if the group reaches N") is an intent; the contract resolves all of them together at settlement | [`contracts/coop/src/settle.rs`](contracts/coop/src/settle.rs) (`resolve` line 66, `settle` line 232) |
| Emergent economies between agents | The group's size and price come from the agents' thresholds, with no coordinator | [`contracts/coop/src/settle.rs`](contracts/coop/src/settle.rs), [`agents/src/scenario.ts`](agents/src/scenario.ts) (`runScenario` line 111) |
| Bidding | The seller agent adds a better tier when a pool stalls; the contract accepts only changes that are no worse for any buyer | [`contracts/coop/src/offer.rs`](contracts/coop/src/offer.rs) (`improve_offer` line 228, `is_improvement` line 98), [`agents/src/seller.ts`](agents/src/seller.ts) (`proposeImprovement` line 93, `SellerAgent` line 128) |

| Hint | Used | How |
|---|---|---|
| Multi-agent systems | Yes | Eager, Bargain and Switcher buyers, a Seller agent and a Settler run concurrently ([`agents/src/policy.ts`](agents/src/policy.ts), [`agents/src/seller.ts`](agents/src/seller.ts), [`agents/src/runtime.ts`](agents/src/runtime.ts)) |
| Sub-accounts | Yes | Every agent is a direct sub-account of its owner (`<agent>.<owner>`), enforced by the contract ([`agent.rs`](contracts/coop/src/agent.rs) line 125) |
| Function-call keys | Yes | Agents hold only a key limited to `join_pool` / `leave_pool` on the Co-op contract, with zero deposit ([`chain.ts`](agents/src/chain.ts) line 576) |

## 3. The problem

Sellers of digital goods price in volume tiers, and the gaps are large. dRPC sells blockchain RPC calls at $6.00 per million pay as you go and $4.20 on its $199 plan, 30% less ([plans](https://github.com/drpcorg/drpc-nextra/blob/main/pages/pricing/plans.mdx#L27-L30)). Google Cloud Vision charges $1.50 per 1,000 images for small users and $0.60 above 5 million a month, 60% less ([pricing](https://cloud.google.com/vision/pricing)). On dYdX, the taker fee halves from 5.0 to 2.5 basis points at $200M of 30-day volume ([fee tiers](https://github.com/dydxprotocol/v4-documentation/blob/main/docs/pages/concepts/trading/rewards/index.mdx#L53-L61)). An agent that needs 1 to 4 units never reaches a tier, so it always pays the top price.

Agents could buy together, but nobody wants to send money to another agent or to a coordinator and hope it buys the right thing. There is no neutral place that holds everyone's money, applies the tier the group actually reached, delivers the goods and refunds the difference. Pooling small, scattered demand into orders big enough to reach a seller's volume tier is the missing piece.

## 4. How it works

1. **Seller posts an offer.** The seller calls `create_offer` with price tiers, for example 1+ units at 1.00 NEAR, 20+ at 0.70, 50+ at 0.50, plus a maximum, a deadline and a lock window. The seller then sends the inventory (a NEP-141 token) to the Co-op contract with `ft_transfer_call`. The offer opens only once the contract holds the full inventory, so delivery cannot fail later for lack of stock.
2. **Owner funds an agent.** The owner creates a sub-account for the agent, adds a function-call key limited to `join_pool` / `leave_pool`, and calls `register_agent` with the agent's limits (`max_unit_price`, `max_units_per_pool`, optional `allowed_sellers`, `expires_at`) and a deposit that becomes the agent's budget. The agent runtime receives only the function-call key. In the web app this is one wallet approval: the visitor picks a room, how many agents and a total budget, and their own wallet signs the account creation and `register_agent` for each agent, so the visitor is the owner on chain: after settlement the unspent part of each lock is back in the agent's free budget, and the owner pulls it to their wallet with `withdraw` from the **My agents** page ([`server/src/wallet-spawn.ts`](server/src/wallet-spawn.ts), [`web/src/lib/agent-txs.ts`](web/src/lib/agent-txs.ts)).
3. **Agents join.** An agent calls `join_pool(pool_id, units, threshold_units?)` with no deposit. Joining is either unconditional ("I will take 2 units") or conditional ("2 units, but only if the group reaches 50"). The contract locks `units x price` from the agent's budget, where the price is the entry tier for an unconditional join, or the tier at the agent's threshold for a conditional one. If that price is above the agent's `max_unit_price` the join is rejected. The locked amount is the most the agent can ever pay. Before the lock time an agent can `leave_pool` and get its lock back.
4. **Anyone settles after the deadline** by calling `settle(pool_id)`:
   - The contract finds the **largest group whose conditions all hold**, finds the best tier that group reaches, and charges every member in the group that tier's price.
   - It pays the seller, registers each member on the item token (NEP-145), transfers each member's units (NEP-141), and credits each member `locked - paid` back to its budget. Unsold inventory returns to the seller.
   - Members outside the group are refunded in full. If no tier is reached, everyone is refunded in full and the seller is not paid.
   - Settlement runs in chunks (10 members per call by default), so a large pool is finished by calling `settle` again. A second call on a finished pool does nothing.
   - If a delivery fails, the units become a claimable balance. They are never lost.
5. **Owner withdraws** leftover budget with `withdraw` (requires 1 yoctoNEAR, so a function-call key cannot call it).

**Why the largest group, not a group grown from unconditional members.** The group is computed as a greatest fixed point: start with everyone, and while the highest threshold among the remaining conditional members exceeds the group's total units, drop that member. Growing a group upward from the unconditional members would refuse a deal that is valid: two conditional agents of 25 units each, both with threshold 50, are each below 50 alone but meet it together, so both must be in. This is the one place the implementation deliberately differs from the first design note in `docs/PRD.md` (section 6.4). The contract tests it against a brute-force search over all subsets (`resolve_equals_largest_consistent_subset_property`).

### The invariant

> **No agent pays more than its own limit, and the seller is paid only if the group reaches a price tier.**

It is enforced in the contract (the lock at join time, the settlement arithmetic), tested in Rust (`invariant_over_30_random_members` and others), and recomputed from chain views after every scenario run by `agents/src/verify.ts`, whose output is the "INVARIANT CHECK" block in section 7.

Why this needs NEAR and not a database: the escrow, the tier calculation and the delivery happen in one contract that neither the seller, the coordinator nor any agent controls. The contract has no admin or owner (`new()` takes no arguments and stores none, [`lib.rs`](contracts/coop/src/lib.rs) line 81).

## 5. NEAR features used

| Feature | Where | What breaks without it |
|---|---|---|
| **Sub-accounts** | [`agent.rs`](contracts/coop/src/agent.rs) line 125 (`register_agent` accepts only `<label>.<owner>`); [`agents/src/chain.ts`](agents/src/chain.ts) line 543 (`createSubAccount`); [`agents/src/world.ts`](agents/src/world.ts) line 157 (`provisionAgent`) | Agents would be anonymous keys. Identity, deliveries and refunds could not be scoped to and traced back to the owner, and anyone could register an agent for someone else's account |
| **Function-call keys** | [`agents/src/chain.ts`](agents/src/chain.ts) lines 576 and 596 (`addFunctionCallKey`, `AGENT_METHODS`); proof in [`evidence/check-02-fckey-sandbox.txt`](evidence/check-02-fckey-sandbox.txt) and [`agents/test/integration/fckey.test.ts`](agents/test/integration/fckey.test.ts) | The agent runtime would need a full-access key. A leaked key could drain the account. With the restricted key it cannot move NEAR, call another contract, attach a deposit, or call `withdraw` (all four rejected by the protocol in the evidence file) |
| **Contract escrow** | [`pool.rs`](contracts/coop/src/pool.rs) line 200 (lock), [`settle.rs`](contracts/coop/src/settle.rs) lines 121 to 181 (charge, refund, pay) | Money would sit with an organiser, who would have to be trusted to apply the tier, deliver and refund |
| **NEP-141** (fungible tokens) | Inventory in: [`offer.rs`](contracts/coop/src/offer.rs) line 196 (`ft_on_transfer`). Delivery out: [`agent.rs`](contracts/coop/src/agent.rs) line 63 (`delivery_promise`). Demo token: [`contracts/credits-token/src/lib.rs`](contracts/credits-token/src/lib.rs) | Goods could not be escrowed up front or delivered atomically with payment |
| **NEP-145** (storage management) | [`agent.rs`](contracts/coop/src/agent.rs) line 63: each delivery batch calls `storage_deposit` (registration only) on the item token before `ft_transfer`, paid from `STORAGE_RESERVE` ([`lib.rs`](contracts/coop/src/lib.rs) line 33) | `ft_transfer` to an agent not yet registered on the token would fail, and large pools could not be delivered without a prior registration step per agent |
| **NEP-297** (events) | [`events.rs`](contracts/coop/src/events.rs) lines 11 to 18 | The dashboard, the receipt and the invariant checker replay pools from these logs; without them state would have to be inferred from storage diffs |

## 6. Key claims (full table: [docs/CLAIMS.md](docs/CLAIMS.md))

Every factual claim in this README is listed in `docs/CLAIMS.md` with a file and line and a proof (a named test or an evidence file). The central ones:

| Claim | Code | Proof |
|---|---|---|
| No agent pays more than its limit | [`pool.rs`](contracts/coop/src/pool.rs):233, [`settle.rs`](contracts/coop/src/settle.rs):121 | `invariant_over_30_random_members`, `join_rejected_when_lock_price_exceeds_max_unit_price` ([`tests.rs`](contracts/coop/src/tests.rs)); invariant block in [`evidence/sandbox-run.txt`](evidence/sandbox-run.txt) |
| Seller is paid only if a tier is reached | [`settle.rs`](contracts/coop/src/settle.rs):86 | `no_tier_reached_refunds_everyone_and_pays_no_seller`; `scenario.test.ts` refund path |
| Largest consistent group | [`settle.rs`](contracts/coop/src/settle.rs):66 | `resolve_equals_largest_consistent_subset_property`, `two_conditional_25_unit_members_with_threshold_50_both_get_in` |
| Settlement is chunked and idempotent | [`settle.rs`](contracts/coop/src/settle.rs):232 | `chunked_settlement_matches_single_call`, `settle_twice_is_idempotent`, [`chunked.test.ts`](agents/test/integration/chunked.test.ts) (21 members); [`evidence/gas.md`](evidence/gas.md) |
| Failed delivery becomes a claimable balance | [`settle.rs`](contracts/coop/src/settle.rs):283, [`agent.rs`](contracts/coop/src/agent.rs):196 | `failed_delivery_becomes_claimable_and_can_be_claimed`, [`claim.test.ts`](agents/test/integration/claim.test.ts) |
| Agent key can only join/leave, zero deposit | [`chain.ts`](agents/src/chain.ts):625 | [`evidence/check-02-fckey-sandbox.txt`](evidence/check-02-fckey-sandbox.txt), [`fckey.test.ts`](agents/test/integration/fckey.test.ts) |
| Committed wasm matches its SHA-256 and the on-chain code hash | [`deploy.ts`](agents/src/deploy.ts):35, :164; [`Makefile`](Makefile):22 | `make verify` output in section 7 |
| Spawn endpoint is rate limited and capped | [`spawner.ts`](server/src/spawner.ts):225, :267, :276 | [`app.test.ts`](server/test/unit/app.test.ts) (429 and 503 cases) |
| Testnet behaviour (deploy, 12+ agent run) | | [`evidence/testnet-deploy.md`](evidence/testnet-deploy.md), [`evidence/testnet-run-2026-11-05T11-55-16-789Z.md`](evidence/testnet-run-2026-11-05T11-55-16-789Z.md) |

## 7. Try it in 30 seconds: `make verify`

Needs **Linux (x86_64 or arm64) or an Apple Silicon Mac**, Node 22+, pnpm 10 (`corepack enable` is enough), `make`, and network access for the package install plus the one-time download of the `near-sandbox` nearcore binary. **No Rust toolchain, no keys, no wallet, no testnet.** On Windows, run it inside WSL 2 (Ubuntu, where `make` comes from `sudo apt install make` and Node 22+ from your usual installer): `near-sandbox` publishes no Windows or Intel-Mac build of the node, so `make verify`, `make demo`, the integration tests and checks 02 to 04 cannot run natively there. Unit tests, type checks and the web build work on any OS. It checks the committed wasm against `contracts/res/SHA256SUMS`, starts a local nearcore 2.14.0 sandbox, deploys the committed wasm, runs a 10-agent scenario through real transactions to settlement, prints the receipt, and recomputes the invariants from chain views. The scenario takes about 50 seconds (settlement at +47.5 s in the captured run), plus install and first-time binary download.

```bash
git clone <this repo> && cd co-op
make verify
```

Expected output (receipt and invariant section; the full captured run is [`evidence/sandbox-run.txt`](evidence/sandbox-run.txt)). Port numbers and timings vary; the hashes and the numbers in the receipt do not:

```text
== SHA-256 of the committed wasm (the files deployed below)
1023254439a84cf4240820728c552fb6f9783881af4e15d0cb866bd237bab4b1  coop.wasm
345332183cdc391ff269bf71b2c282f10a2201e1cb4e66c5419f6b65614b9848  credits_token.wasm
coop.wasm: OK
credits_token.wasm: OK

on-chain code_hash of coop.sandbox = 25zc9skAWedyEjyB2CDDCYaCCkZ6d8bqBqQZxTtZjUwz (matches)
on-chain code_hash of credits.sandbox = 4XFnBSmdLCTWX4JYv3F8ioUmbdnpZSJBz5n1JFw5bWkf (matches)
...
[+ 47.5s] settle        settle(pool 1): 10 of 10 members processed, status Settled
[+ 47.5s] pool_settled  Pool 1 settled: 24 units from 8 agents at 0.70 each, seller paid 16.8000 NEAR

SETTLEMENT RECEIPT  pool 1  "Demo API credits (volume pricing)"
seller sandbox   item token credits.sandbox
tiers  1+ at 1.00 | 20+ at 0.70 | 50+ at 0.50
RESULT SETTLED at tier 2 (20+ units): 24 units from 8 of 10 agents at 0.70 NEAR each

agent           units  joined       limit  outcome    price/unit      paid    refund  tokens  delivery
------------------------------------------------------------------------------------------------------
buyer-e1            4  now           1.00  Filled           0.70      2.80      1.20       4  Delivered
buyer-e2            4  now           1.10  Filled           0.70      2.80      1.20       4  Delivered
buyer-b501          4  if >= 50      0.55  Excluded            -      0.00    2.0013       0  -
buyer-e3            3  now           1.00  Filled           0.70      2.10      0.90       3  Delivered
buyer-e4            4  now           1.10  Filled           0.70      2.80      1.20       4  Delivered
buyer-b201          2  if >= 20      0.90  Filled           0.70      1.40      0.00       2  Delivered
buyer-b202          2  if >= 20      0.90  Filled           0.70      1.40      0.00       2  Delivered
buyer-b203          3  if >= 20      0.90  Filled           0.70      2.10      0.00       3  Delivered
buyer-b204          2  if >= 20      0.90  Filled           0.70      1.40      0.00       2  Delivered
buyer-b502          4  if >= 50      0.55  Excluded            -      0.00    2.0013       0  -
------------------------------------------------------------------------------------------------------
total paid 16.80 NEAR | total refunded 8.5025 NEAR | seller payout 16.80 NEAR
the same 24 units at the entry price would have cost 24.00 NEAR: the group saved 7.20 NEAR

INVARIANT CHECK (recomputed from chain views)
  [PASS] pool is finished: status Settled, 10 members
  [PASS] every member paid <= units x its own limit: 10 members checked
  [PASS] paid + refunded + storage == locked, per member: 10 members balance to the yocto
  [PASS] filled members paid units x tier price, the rest paid nothing: tier price 0.70
  [PASS] sum of member payments == seller payout: 16.800000 vs 16.800000 NEAR
  [PASS] seller_paid event matches payout: 16.800000 NEAR in events
  [PASS] group size matches the resolved result: 24 units from 8 members
  [PASS] seller paid only if a tier was reached: tier 1
  [PASS] token balances match units delivered: 24 units delivered
  [PASS] inventory fully accounted for (seller kept the unsold units): seller 1000000 -> 999976, escrow 0 -> 0
  [PASS] no budget left locked: budget_locked is 0 for every member
  [PASS] membership storage cost is small and non-negative: 10 members, 0.00257 to 0.00278 NEAR each
  [PASS] owner withdrew every leftover budget (full-access key, 1 yocto): 8.7415 NEAR withdrawn from 10 agents
ALL INVARIANTS HOLD
```

How to read it: tiers are 1+ at 1.00, 20+ at 0.70, 50+ at 0.50 NEAR. The group reached 24 units, so tier 2 applies and everyone in the group pays 0.70. The two "if >= 50" agents never had their condition met and were refunded in full. The agent with limit 1.00 paid 0.70 and got 1.20 back on 4 units. Every agent's `paid` is at or below `units x limit`. The final line, "the same 24 units at the entry price would have cost 24.00 NEAR", is the saving from pooling.

Related commands:

| Command | What it does |
|---|---|
| `make check` | Rust unit tests (if `cargo` is installed) and typecheck plus unit tests of every package |
| `make test-integration` | Integration tests against a real sandbox (chunked settlement, claim path, function-call key, key lock, negotiation, runtime, scenario) |
| `make checks` | Capability checks 02, 03, 04, 06 on the sandbox (function-call key, sandbox boot and fast-forward, settlement gas, optional LLM) |
| `make demo` | Sandbox plus server plus scripted agents plus web dashboard (section 8) |

## 8. Do X, see Y

### Locally (works today): `make demo`

`make demo` starts a sandbox, deploys the contracts, starts the server (seller loop, settler, spawn API) with 12 scripted agents that join each new offer, and starts the web dev server. Open the web URL it prints (Vite, normally `http://localhost:5173`).

| Do | See |
|---|---|
| Open the home page | The invariant statement and the list of pools (open and finished) |
| Open the open pool and watch for a minute | The tier ladder with a marker at the current projected price, countdowns to lock and deadline, and a live feed of agents joining, each with its one-line reason ("In if the group reaches 50. I only buy at 0.50 or less."). Conditional agents are listed as waiting; the marker moves as units arrive |
| Wait for the deadline | The pool turns to Settled; the settlement receipt shows the final tier, units per agent, what each paid against its limit, refunds, the seller payout, and a transaction chip per step (local sandbox, so no explorer link) |
| Open "Spawn your agent", enter a name, a brief such as `buy 3 credits if the price drops below 0.60`, a budget of 1 or 2, and submit | The page shows the parsed policy (and whether the rules parser or an LLM produced it) and the transactions that created the sub-account, added the function-call key and registered the agent. The agent then joins the next open pool and appears in the feed |
| Spawn 4 agents from the same address within an hour (default limit is 3 per hour) | The fourth is refused (HTTP 429, the page shows "Hourly limit reached") |
| Open "How it works" | The mechanism and a diagram |

### Hosted

Hosted demo URL: https://coop.cyberpunkinc.xyz, on testnet, with nearblocks links on every transaction chip.

| Do | See |
|---|---|
| Open the home page | Open rooms (API credits, GPU hours, dataset seats), each with its purpose, group size, current price, next tier and countdown |
| **Connect wallet** (Meteor, Intear and other testnet wallets through NEAR Connect) | Your account and spendable balance in the header |
| **Open a room**: pick an item, write the purpose, pick 10/20/30 minutes | The demo seller opens the pool on chain; you get a 6-character code and an invite link (shown only to you) |
| Open the room, **Spawn agents into this room**: name, how many (1 to 5), one brief, a total NEAR amount (capped at your spendable balance), approve once in the wallet | Your wallet creates `<name>-1.<you>` ... and registers each with its share of the budget; the agents appear in the room's feed and join within seconds |
| Send the code to someone else; they connect their own wallet and spawn into the same room | Their agents join the same pool; the projected price drops as the group crosses 20 units |
| Wait for the deadline | The receipt: everyone paid the same tier price, each agent's unspent lock back in its free budget, the seller paid only because a tier was reached |
| Open **My agents**, **Withdraw to my wallet** | One approval sends every agent's free budget back to the owner's wallet (`withdraw`, owner only) |
| **Share code** on a room | Telegram, X, WhatsApp or email with the invite link and code filled in, or copy the link |
| No wallet? **Demo, server pays** on the spawn page | One agent funded by the operator (capped, 3 per hour per network), same room |

## 9. Architecture

```text
                 owner (full-access key)
                   | register_agent(budget, limits) / withdraw (1 yocto)
                   v
 seller --ft_transfer_call--> +-----------------------------+ <--join_pool / leave_pool-- buyer agents
 (inventory, NEP-141)         |   coop contract (Rust)      |     (function-call keys, 0 deposit)
 seller --create_offer------> |   offers, pools, budgets,   |
                              |   resolve + chunked settle  | <--settle(pool_id)-- anyone / Settler
                              +--------------+--------------+
                                             | storage_deposit + ft_transfer (NEP-145 / NEP-141)
                                             v
                                   item token (credits.<operator>)

 agents/ (TypeScript) --- policy.ts decides, runtime.ts acts, scenario.ts drives, verify.ts checks
 server/ (Fastify)  ----- spawn API, activity feed (SSE), seller loop, embeds the agents runtime
 web/ (SvelteKit)   ----- reads views straight from RPC; feed, tx hashes and spawning come from server/
```

| Component | Path | Role |
|---|---|---|
| Co-op contract | [`contracts/coop/src/`](contracts/coop/src) | `lib.rs` state and limits, `offer.rs` offers and tiers, `agent.rs` budgets and claims, `pool.rs` join and leave, `settle.rs` resolve and chunked settlement, `views.rs` read methods, `events.rs` NEP-297 |
| Demo token | [`contracts/credits-token/src/lib.rs`](contracts/credits-token/src/lib.rs) | NEP-141 + NEP-145 voucher, decimals 0 |
| Committed build | [`contracts/res/`](contracts/res) | `coop.wasm`, `credits_token.wasm`, `SHA256SUMS` |
| Agents | [`agents/src/`](agents/src) | `policy.ts` (decision engine), `runtime.ts` (polling, joins, leaves, settler), `seller.ts` (offers, improvement), `brief.ts` (rules or optional LLM parser), `chain.ts` (client), `scenario.ts`, `verify.ts` and `receipt.ts` (invariants, receipt), `deploy.ts` (SHA-256 checked deploy), `deploy-testnet.ts`, `lock-contract.ts` |
| Server | [`server/src/`](server/src) | `app.ts` routes and limits, `spawner.ts` spawn flow and caps, `activity.ts`, `store.ts` key file, `seller-loop.ts` |
| Web | [`web/src/`](web/src) | `routes/` (home, pool, spawn, how), `lib/settlement.ts` (client-side mirror of the resolver), `lib/rpc.svelte.ts` (JSON-RPC views) |
| Checks | [`checks/`](checks) | Capability checks 01 to 06 |
| Deploy | [`deploy/`](deploy), [`server/Dockerfile`](server/Dockerfile) | Server image, Caddy HTTPS config, VM settings template and hosting steps |

Interface names and JSON shapes are pinned in [docs/SPEC.md](docs/SPEC.md); contract details in [contracts/README.md](contracts/README.md); server details in [server/README.md](server/README.md). The full folder map, with a README in every folder and where each piece of logic lives, is [structure.md](structure.md).

## 10. Measured results

All from a local sandbox (nearcore 2.14.0, protocol 88), by [`checks/04-settle-gas.ts`](checks/04-settle-gas.ts); full tables in [`evidence/gas.md`](evidence/gas.md).

| Measurement | Result |
|---|---|
| Gas burnt per filled member (settle work, `storage_deposit`, `ft_transfer`, `on_delivered`, all receipts) | about 7.2 Tgas (7.07 to 7.44 across 10, 25 and 50 member pools) |
| Gas burnt per member in a refunded pool (no tier) | 0.90 Tgas |
| Members per `settle` call at 300 Tgas | 10 (the `DEFAULT_CHUNK` ceiling; the gas guard alone would allow 12) |
| `settle` calls for a 25-member pool / 50-member pool | 3 / 5 |
| With 1000 Tgas attached and `max_members` 25 | 25 members in one call |
| Largest log in one receipt | 4987 bytes of the 16384 byte protocol cap |
| `join_pool` / first member's `leave_pool` at 100 members (the cap) | 2.86 Tgas / 20.83 Tgas |
| Pool sizes exercised | 10 (`make verify`), 12 (scenario integration test), 21 (chunked integration test), 25 and 50 (gas check), 30 random members (Rust invariant test), 100 (member cap test) |
| Testnet run stats (12 agents) | 64 transactions in 7.5 minutes; settlement in 2 `settle` calls (65.03 and 15.11 Tgas); [`evidence/testnet-run-2026-11-05T11-55-16-789Z.md`](evidence/testnet-run-2026-11-05T11-55-16-789Z.md) |

`DEFAULT_CHUNK` stays at 10: it is a ceiling, and the contract also stops a call when the gas left is below its per-member estimate, so a chunk that is too large cannot run out of gas. A pool is capped at 100 members, which bounds settlement at about 10 calls.

## 11. Built during the hackathon

All code in this repository is new and was written inside the hackathon window (which started 2026-10-19 per rule Q-001). There is no pre-existing code, no fork and no earlier baseline. AI coding assistance was used. Libraries and tools (exact versions are pinned in `Cargo.toml`, `Cargo.lock`, the `package.json` files and `pnpm-lock.yaml`):

| Area | Libraries |
|---|---|
| Contracts (Rust) | `near-sdk` 5.30, `near-contract-standards` 5.30, `cargo-near` 0.22.0 (build only) |
| Agents and checks | `near-api-js` 7.4.0, `near-sandbox` 0.3.4, `zod` 4.6.7, `openai` 7.49.0 (optional LLM client), `dotenv` 17.4.2, `tsx` 4.23.15, `typescript` 6.0.3, `vitest` 5.1.0 |
| Server | `fastify` 5.12.8, `@fastify/cors` 11.4.0, `@fastify/rate-limit` 11.2.2, `near-api-js`, `zod` |
| Web | `svelte` 5.57.3, `@sveltejs/kit` 3.1.1 (Vercel adapter 7.0.2), `vite` 8.3.5, `vitest`, `svelte-check` 4.7.8, `@hot-labs/near-connect` 0.12.0 (wallet connection) |

## 12. Other project by the same builder

**Handover** (also built at NEAR HACKATHON, on testnet): an NFT that owns its own Ethereum wallet, and a sale you can verify, using NEAR Chain Signatures, a public signature log and a clean check.

- Repo: https://github.com/AlphaTechini/handover
- Live demo: https://handover-blush.vercel.app

## 13. Full setup, environment, deploy, security, roadmap

### Setup

```bash
corepack enable          # pnpm 10
make install             # pnpm install --frozen-lockfile
make check               # tests and typechecks (cargo test runs if cargo is installed)
make test-integration    # sandbox integration tests
```

Without `make` (native Windows), the offline checks still run: `pnpm install --frozen-lockfile`, then `pnpm -r --if-present run check` and `pnpm --filter @coop/web test`. On Windows, `cargo test` needs either the NASM assembler or `AWS_LC_SYS_PREBUILT_NASM=1` for its `aws-lc-sys` dependency, and two server tests that check Unix file mode `0600` fail because Windows has no such modes.

Rebuilding the wasm (optional, needs Rust and `cargo install cargo-near --version 0.22.0 --locked`): `./contracts/build.sh`, then `(cd contracts/res && sha256sum -c SHA256SUMS)`. A rebuild on another machine or Rust version can differ byte for byte from the committed file (built with rustc 1.96.0 and cargo-near 0.22.0); the committed hash is the hash of the committed file.

### Environment variables

Copy `.env.example` to `.env` (git-ignored). Sandbox runs need none of them.

| Variable | Purpose |
|---|---|
| `NEAR_NETWORK`, `NEAR_RPC_URL` | `sandbox` or `testnet`; testnet RPC (default `https://test.rpc.fastnear.com`, fallbacks `https://near-testnet.drpc.org`, `https://testnet-rpc.intea.rs`) |
| `OPERATOR_ACCOUNT_ID`, `OPERATOR_PRIVATE_KEY` | Operator account: deploys, sells, owns spawned agents. Create with `near create-account <id> --useFaucet --networkId testnet` |
| `COOP_CONTRACT_ID`, `CREDITS_TOKEN_ID` | Written by the deploy script |
| `GPU_HOURS_TOKEN_ID`, `DATASET_SEATS_TOKEN_ID` | Optional extra room items, from `pnpm --filter @coop/agents deploy:items` |
| `PORT`, `CORS_ORIGIN`, `SPAWN_MAX_AGENTS` (40), `SPAWN_MAX_BUDGET_NEAR` (2), `SPAWN_PER_IP_PER_HOUR` (3), `RATE_LIMIT_PER_MIN` (60), `SPAWN_MIN_OPERATOR_NEAR` (1) | Server and spawn caps (full list in [server/README.md](server/README.md)) |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | Optional OpenAI-compatible endpoint; unset means rules parser |
| `PUBLIC_NETWORK`, `PUBLIC_RPC_URL`, `PUBLIC_COOP_CONTRACT_ID`, `PUBLIC_API_URL` | Web build-time settings |

### Testnet deploy (the builder's commands)

Testnet must run protocol 88 or newer (nearcore 2.14), because the `near-sdk` 5.30 wasm needs those host functions; the deploy and scenario scripts check this and stop with a message if not.

```bash
near create-account <operator>.testnet --useFaucet --networkId testnet   # then fill .env
pnpm --filter @coop/checks exec tsx 01-faucet.ts                         # operator exists and has balance
pnpm --filter @coop/agents deploy:testnet                                # deploys coop.<operator> and credits.<operator>, checks code hashes, writes evidence/testnet-deploy.md
pnpm --filter @coop/agents scenario --agents 12 --network testnet        # real run, writes evidence/testnet-run-<time>.md and .json
pnpm --filter @coop/agents lock-contract --yes                           # deletes full-access keys of the contract account, writes evidence/contract-lock.md
```

`lock-contract` without `--yes` is a dry run. The lock is irreversible; run it last. The hosting steps (server image on a GCP VM behind Caddy, site on Vercel) are in [deploy/README.md](deploy/README.md).

### Security notes

- **Owner methods need 1 yoctoNEAR** (`assert_one_yocto`): `withdraw`, `update_limits` ([`agent.rs`](contracts/coop/src/agent.rs) lines 172, 182), `improve_offer` ([`offer.rs`](contracts/coop/src/offer.rs) line 229) and the demo token's `mint`. A function-call key cannot attach a deposit, so a leaked agent key cannot call them.
- **Callbacks are `#[private]`**: `on_delivered`, `on_inventory_returned` ([`settle.rs`](contracts/coop/src/settle.rs) lines 282, 302) and `on_claimed` ([`agent.rs`](contracts/coop/src/agent.rs) line 232).
- **Failed deliveries become claimable balances** (`claim`, [`agent.rs`](contracts/coop/src/agent.rs) line 196); units are not lost. A failed return of unsold inventory is claimable by the seller.
- **`register_agent` accepts only direct sub-accounts** of the caller, and the contract rejects its own account as an agent ([`agent.rs`](contracts/coop/src/agent.rs) lines 125 to 133).
- **No admin, no owner, no upgrade method** in the contract. `lock-contract` additionally deletes the contract account's full-access keys so the code cannot be swapped; tested in the sandbox ([`lock.test.ts`](agents/test/integration/lock.test.ts)).
- **Wasm integrity**: `make verify` and the deploy code refuse a wasm whose SHA-256 differs from `contracts/res/SHA256SUMS`, then compare the on-chain `code_hash` after deploy ([`deploy.ts`](agents/src/deploy.ts) lines 35 and 129).
- **Spawn caps stack**: per-IP hourly limit, total agent cap, per-agent budget cap, an operator balance floor checked before provisioning, one spawn at a time, 4 KB request bodies, zod validation, and a general per-IP rate limit ([`spawner.ts`](server/src/spawner.ts), [`app.ts`](server/src/app.ts)).
- **Keys**: spawned agents' keys live in `server/.data/agents.json` (mode 0600, git-ignored) and are never returned by any endpoint. They are generated and saved before the first transaction of a spawn, so a failed save spends nothing and a failed transaction leaves the keys in `agents.json.retired`. `make demo` uses the public sandbox key, which is worthless outside your machine. No secret is committed; `.env` is git-ignored.

### Roadmap

Mainnet deployment with real merchants, signed off-chain join intents so agents need no gas, and a reputation signal for sellers.

## License

MIT, see [LICENSE](LICENSE).
