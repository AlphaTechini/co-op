# Co-op: Product Requirements Document

**Status:** ready to build · **Written:** 2026-11-03 · **Deadline:** 2026-11-14 23:59 UTC (repo public + X demo post + one submission)
**Builder:** solo · **Network:** NEAR testnet only · **Spend:** zero (testnet funds, free tiers only)

This PRD is the single source of truth for the coding agent building Co-op. Read it top to bottom before writing code, then read `docs/HACKATHON.md` (snapshot of the official rules). Where this PRD and the live rules disagree, the live rules at https://nearhackathon.com/HACKATHON.md win.

---

## 1. One-liner

**Co-op lets AI buying agents pool their orders on NEAR so a group of small buyers gets the bulk price, with the contract guaranteeing no agent ever pays more than its own limit.**

Who it's for: people and teams running AI agents that buy the same digital goods (API credits, compute hours, data access, licences, tickets) in small quantities, and sellers who offer volume pricing but never see buyers big enough to reach it.

## 2. The problem

- Sellers of digital goods price in volume tiers (1 unit at full price, 50+ units at a discount). A single agent buying 1-3 units never reaches a tier, so it always pays the top price.
- Agents could buy together, but nobody wants to send money to another agent or a coordinator and hope it buys the right thing. There is no neutral place to hold everyone's money, apply the tier the group actually reached, deliver the goods, and refund the difference.
- Agent marketplaces on NEAR already show the demand side is the weak side: a public review of agent marketplaces found heavy seller oversupply (188 bids on a single $5 task) and few funded buyers (https://dev.to/nuncius-ghost/i-checked-the-platforms-where-ai-agents-supposedly-get-paid-the-names-are-real-the-demand-isnt-5eha). Pooling small, scattered demand into orders worth bidding on is the missing piece. **Agent task:** before writing the README, re-open this source and confirm the figure; if it can't be confirmed, drop it rather than paraphrase from memory.

## 3. The mechanism (say this in one breath)

A seller posts an offer with price tiers. Buyer agents join a pool for that offer, either outright ("I'll take 2 units") or conditionally ("I'll take 2 units, but only if the group reaches 50"). At the deadline the contract finds the largest group whose conditions all hold, charges everyone the tier price that group reached, pays the seller, delivers the goods to each agent, and refunds the rest. If no tier is reached, everyone is refunded in full.

**Invariant (state it in the README, test it, show it in the demo):** *No agent pays more than its own limit, and the seller is paid only if the group reaches a price tier.*

Why this needs NEAR, not a database: the escrow, the tier calculation and the delivery happen in one contract that neither the seller, the coordinator nor any agent controls. Remove the contract and you're back to "send your money to the organiser and trust them".

## 4. Track fit

Primary track: **`swarms` (AI Swarms)**. Secondary: **`agents` (Agent Economy)**. Select both in the submission.

| Track brief item | Where Co-op does it | File (target path) |
|---|---|---|
| Collective purchasing | Pools that aggregate many agents' small orders into one tiered purchase | `contracts/coop/src/pool.rs` |
| Coordination markets | Agents discover open pools, compare projected price vs their limit, join or wait | `agents/src/buyer.ts` |
| Intent-based settlement | Conditional joins ("in if ≥ N units") are intents; the contract resolves them all at settlement | `contracts/coop/src/settle.rs` |
| Emergent economies between agents | Conditional agents only commit once enough others do; the group's size and price emerge from their thresholds, not from a coordinator | `contracts/coop/src/settle.rs`, `agents/src/scenario.ts` |
| Bidding (P1) | Seller agent adds better tiers when a pool stalls; tiers can only improve for buyers | `contracts/coop/src/offer.rs`, `agents/src/seller.ts` |

| Hint | Used? | How |
|---|---|---|
| Multi-agent systems | Yes | Buyer, seller and (P1) scout agents run concurrently with different goals |
| Sub-accounts | Yes | Every agent is a sub-account of its owner (`<agent>.<owner>.testnet`), so its identity, deliveries and refunds are scoped and traceable to the owner |
| Function-call keys (security hint, bonus) | Yes | Agents only hold a function-call key limited to `join_pool` / `leave_pool` on the Co-op contract. The key cannot move NEAR or call anything else |
| NEAR Intents | **No, stated openly** | NEAR Intents has no testnet (Q-007) and this project is zero-spend. Settlement runs in our own contract on testnet. Cross-chain settlement via Intents is roadmap only |

## 5. Users and roles

| Role | What they do | How they act on chain |
|---|---|---|
| **Owner** (human or team) | Creates agents, funds each agent's budget, sets its limits, withdraws leftovers | Full-access key of their own account |
| **Buyer agent** | Watches pools, decides whether and how to join, may leave before lock | Function-call key on its sub-account, restricted to `join_pool` / `leave_pool`, zero deposit |
| **Seller** (human or seller agent) | Posts offers with tiers, deposits inventory up front, receives payment at settlement | Its own account; deposits inventory with `ft_transfer_call` |
| **Anyone** | Calls `settle(pool_id)` after the deadline (permissionless; the hosted runtime does it automatically) | Any account |

## 6. Core flows

### 6.1 Seller posts an offer
1. Seller deploys or already owns a NEP-141 token that represents the goods (for the demo: `credits.<operator>.testnet`, an "API credit voucher" token we deploy and label clearly as a demo seller).
2. Seller calls `create_offer` with: item token contract, price tiers (`[{min_units: 1, unit_price: 1.0 NEAR}, {min_units: 20, unit_price: 0.7}, {min_units: 50, unit_price: 0.5}]`), max units, deadline, lock window.
3. Seller sends inventory to the Co-op contract with `ft_transfer_call(msg = {"offer_id": ...})`. The offer only opens once inventory ≥ max units is held. Delivery can't fail later for lack of stock.

### 6.2 Owner creates and funds an agent
1. Owner creates sub-account `<name>.<owner>.testnet` and adds a function-call key to it with `receiver_id = coop contract`, `method_names = ["join_pool", "leave_pool"]`, and a small gas allowance.
2. Owner calls `register_agent(agent_id, limits)` with an attached deposit = the agent's budget. Limits: `max_unit_price`, `max_units_per_pool`, optional `allowed_sellers`, `expires_at`.
3. The agent runtime gets only the function-call private key. It cannot spend outside the budget or limits because the contract enforces both.

### 6.3 Agent joins a pool
1. Agent reads open pools (contract view `list_pools`).
2. Its policy decides: join now (unconditional), join conditionally at threshold N, or skip.
3. Agent calls `join_pool(pool_id, units, threshold_units?)` with no deposit. The contract checks the caller is a registered agent, checks limits, and **locks** `units × (price of the tier at the agent's threshold, or the entry tier if unconditional)` from the agent's budget. That locked amount is the most the agent can ever pay.
4. Before `deadline - lock_window`, an agent may `leave_pool`; its lock returns to its budget. After that, membership is frozen to prevent last-second griefing.

### 6.4 Settlement (the heart of the product)
1. After the deadline, anyone calls `settle(pool_id)`.
2. **Resolve conditions (fixed point):** start with all unconditional members. Repeatedly add any conditional member whose threshold ≤ current total units (including its own units). Stop when nothing changes. This is monotone, so it always terminates. Members still excluded are refunded in full.
3. Find the best tier the final total reaches. If none, refund everyone and mark the pool `Refunded`.
4. Otherwise mark `Settled` and, in bounded chunks: pay the seller `total_units × tier_price`; register storage for each member on the item token (NEP-145 `storage_deposit`, paid from that member's refund); `ft_transfer` each member its units; credit each member `locked − units × tier_price` back to its budget. Return unsold inventory to the seller.
5. Emit NEP-297 events at every step so the dashboard and evidence log can replay the pool.

**Edge cases the contract must handle and test:** pool settled twice (idempotent, second call is a no-op); a member's FT transfer fails (callback retries it as a claimable balance, never loses the units); more members than fit in one transaction's gas (settle in chunks with a cursor; `settle` can be called repeatedly until done); agent budget expired mid-pool (lock stays valid until settlement); seller tries to change tiers to worse terms (rejected).

### 6.5 Owner withdraws
`withdraw(agent_id, amount)`, callable only by the agent's owner (the parent account), returns unlocked budget.

### 6.6 "Spawn your own agent" (the real-user path)
The hosted demo has a form: agent name, a one-line brief ("buy 3 API credits if the price drops below 0.6"), budget (capped, e.g. 2 testnet NEAR). The backend (an operator account funded from the faucet) creates the sub-account, adds the function-call key, registers and funds the agent, and starts it in the runtime. Judges and other builders become **real participants in a live pool**, not spectators. Rate-limit by IP and cap total spawned agents so the operator account can't be drained.

## 7. Agents (off-chain swarm)

TypeScript, Node 22+, `near-api-js` v7 (single package; v7.4.0 at time of writing).

| Agent | Goal | Behaviour |
|---|---|---|
| **Buyer: Eager** | Get the item soon | Joins unconditionally if entry price ≤ its limit |
| **Buyer: Bargain** | Only buy at a discount | Joins conditionally at the threshold of the cheapest tier within its limit |
| **Buyer: Switcher** (P1) | Best price across pools | Leaves a pool before lock if another pool for the same item projects a lower price |
| **Seller** (P1 negotiation) | Sell inventory | If a pool stalls short of a tier near the deadline, calls `improve_offer` to add a lower threshold. The contract only accepts changes that make the deal better for buyers |
| **Settler** | Housekeeping | Calls `settle` on expired pools |

**Policy engine first, LLM second.** Every decision is made by a deterministic policy (`agents/src/policy.ts`) from structured limits. An LLM is optional and only used to turn a natural-language brief into that structured policy and to write a one-line "why I joined" explanation for the dashboard. The product must work fully with the LLM off.

LLM provider: any OpenAI-compatible endpoint via the `openai` npm package. Default target is NEAR AI Cloud (`https://cloud-api.near.ai/v1`), but **NEAR AI Cloud requires purchased credits** (per its quickstart), which breaks the zero-spend rule unless the hackathon provides credits. So: `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` env vars; if unset, the deterministic brief parser (regex/keyword) is used and the UI says "LLM off". Never fake LLM output.

Scenario runner (`agents/src/scenario.ts`): spawns N buyers with mixed archetypes and budgets against one or two offers, runs to settlement, writes a JSON log of every decision and transaction. This is what `make verify` and the demo video use.

## 8. Smart contract spec

Rust, `near-sdk` 5.x (5.30.0 at time of writing), built with `cargo-near` (0.22.0). Use `near-contract-standards` for the demo FT. Commit the built `.wasm` and its SHA-256 so judges can verify without a Rust toolchain.

**Storage (sketch, adapt as needed):**
- `offers: IterableMap<OfferId, Offer>`: `seller, item_token, tiers: Vec<Tier>, max_units, inventory_held, deadline_ns, lock_window_ns, status`
- `pools: IterableMap<PoolId, Pool>`: `offer_id, members: IterableMap<AccountId, Membership>, status, settle_cursor`
- `agents: LookupMap<AccountId, AgentRecord>`: `owner, budget_available, budget_locked, limits`
- `Membership { units, threshold_units: Option<u32>, locked }`

**Methods:**

| Method | Caller | Deposit | Notes |
|---|---|---|---|
| `create_offer(item_token, tiers, max_units, deadline_ns, lock_window_ns)` | seller | storage | tiers strictly ascending in `min_units`, strictly descending in price |
| `ft_on_transfer(sender_id, amount, msg)` | item token | — | inventory deposit; reject unknown tokens |
| `improve_offer(offer_id, new_tier)` (P1) | seller | — | reject if any existing buyer's outcome gets worse |
| `register_agent(agent_id, limits)` | owner | budget + storage | `agent_id` must be a direct sub-account of the caller |
| `fund_agent(agent_id)` / `withdraw(agent_id, amount)` | owner | budget / 1 yocto | `withdraw` requires 1 yocto (full-access key confirmation) |
| `join_pool(pool_id, units, threshold_units)` | agent | none | must work with a function-call key (zero deposit) |
| `leave_pool(pool_id)` | agent | none | before lock only |
| `settle(pool_id)` | anyone | — | chunked; idempotent |
| views: `get_offer`, `list_pools`, `get_pool`, `get_agent`, `projected_price(pool_id)` | anyone | — | |

**Security requirements:**
- Every money path has a test: lock never exceeds budget; settlement charge ≤ lock for every member; sum of seller payment + refunds + storage = sum of locks.
- `register_agent` checks `agent_id` ends with `.{predecessor}` (direct sub-account), so nobody can register someone else's agent.
- Owner-only methods require 1 yoctoNEAR (`assert_one_yocto`) so a leaked function-call key can't call them.
- Promise callbacks are `#[private]`; failed transfers become claimable balances.
- After final testnet deploy, the operator removes the contract account's full-access keys and records that in `evidence/` (shows judges nobody can swap the code).

## 9. Frontend

Svelte 5 (SvelteKit, static adapter), reading state directly from testnet RPC with `near-api-js` `JsonRpcProvider`. No wallet needed to watch.

Screens:
1. **Live pool:** the tier ladder as a vertical bar, a marker at the current projected price, a live feed of agents joining/leaving with their one-line reason, countdown to lock and deadline.
2. **Settlement receipt:** final tier, units per agent, what each paid vs its limit (the invariant made visible: "paid 0.5, limit 0.9"), refunds, seller payout, every tx linked to `https://testnet.nearblocks.io/txns/<hash>`.
3. **Spawn your agent:** the form from 6.6.
4. **How it works:** the mechanism paragraph and a diagram.

Design: clean and readable. Load the `frontend-design` skill if available. Must work at phone width.

## 10. Repository layout (target)

```
co-op/
  README.md                 # written last, see section 13
  LICENSE                   # MIT
  Makefile                  # make verify, make check, make demo
  .env.example
  contracts/
    coop/                   # main contract (Rust)
    credits-token/          # demo NEP-141 voucher token
    res/                    # built .wasm + sha256 (committed)
  agents/                   # TypeScript swarm runtime + scenario runner
  server/                   # Fastify: spawn-agent API, scenario control
  web/                      # SvelteKit dashboard
  checks/                   # capability-check scripts (section 11)
  evidence/                 # committed testnet run logs, tx hashes, gas measurements
  docs/
    PRD.md                  # this file
    HACKATHON.md            # rules snapshot
    CLAIMS.md               # every README claim -> file -> proof
```

## 11. Capability checks (do these BEFORE major code)

Write small scripts in `checks/`, each printing PASS/FAIL with the evidence (tx hash, gas used). Commit them with `.env.example` so the human can clone, fill `.env` and run them locally. Do not build the main product until 1-4 pass.

1. **Testnet funding.** `checks/01-faucet.ts`: confirm the operator account exists and has balance. The human must create it first with `near create-account <id> --useFaucet --networkId testnet` (near-cli-rs 0.30.x). **The human must personally confirm the faucet works before anything else.**
2. **Sub-account + function-call key with zero deposit.** `checks/02-fckey.ts`: create `agent1.<operator>.testnet`, add a function-call key limited to one method on a tiny test contract, call that method with the key and zero deposit (expect success), then try with a 1 yocto deposit (expect failure). Proves the agent security model.
3. **Sandbox boots and time travels.** `checks/03-sandbox.ts`: start the `near-sandbox` npm package (0.3.x) or the Rust `near-sandbox` crate (0.4.x), deploy a wasm, `fast_forward` blocks. `make verify` depends on this.
4. **Settlement gas.** `checks/04-settle-gas.ts`: on sandbox, settle a pool with 10, 25 and 50 members including `storage_deposit` + `ft_transfer` per member; record gas per chunk in `evidence/gas.md`. Decide the chunk size from the numbers, not a guess.
5. **RPC rate limits.** `checks/05-rpc.ts`: poll `https://test.rpc.fastnear.com` at the planned dashboard rate for 5 minutes; record errors. Fallbacks from https://docs.near.org/api/rpc/providers: `https://near-testnet.drpc.org`, `https://testnet-rpc.intea.rs`. Don't use `archival-rpc.testnet.near.org` (listed as severely rate limited).
6. **LLM (optional).** `checks/06-llm.ts`: if `LLM_API_KEY` is set, one structured-output call that turns a brief into policy JSON. If not set, print SKIP. Ask in the NEAR Discord whether NEAR AI Cloud credits are available for hackathon builders.

## 12. Scope tiers

**P0 (must ship, in this order):**
1. Capability checks 1-5
2. Demo voucher token + Co-op contract: offers, inventory deposit, agents and budgets, join/leave, conditional thresholds, chunked settlement, refunds, events
3. Contract tests for the invariant and every edge case in 6.4 (Rust unit tests + sandbox integration tests)
4. Agent runtime with Eager, Bargain and Settler agents; deterministic policy engine; scenario runner
5. `make verify` (section 13)
6. Testnet deploy + one full real run of 12+ agents, logged to `evidence/testnet-run-*.md` with every tx hash
7. Svelte dashboard: live pool, settlement receipt
8. Spawn-your-agent endpoint + form, hosted (free tier), kept up until 2026-11-25
9. README, CLAIMS.md, LICENSE

**P1 (only after P0 is fully done):** seller `improve_offer` negotiation; Switcher agent across two pools; LLM brief parsing and explanations; signed off-chain join intents relayed in batches (agents need no gas at all; verify with `env::ed25519_verify` against the agent's registered key).

**Never (this hackathon):** mainnet deploy; real money; NEAR Intents settlement (mainnet-only); our own token or points; a generic agent framework; anything presented as working that isn't.

**Kill criteria:**
- If check 4 shows settlement can't handle 20+ members even in chunks by end of 2026-11-06, cap pools at the measured max and say so in the README.
- If the hosted spawn endpoint can't be funded or kept up, keep spawn local-only, show it in the video, and say so.
- If check 2 fails (function-call key can't call `join_pool` with zero deposit), stop and redesign the agent key model before writing the contract.

## 13. README and evidence requirements

The hackathon's AI screeners (Claude Code and Codex) check that the project runs and does what the README says (Q-017). So every README claim must map to code and to proof committed in the repo.

**README order:**
1. Name, one-liner, who it's for
2. "Built for NEAR HACKATHON, tracks: AI Swarms, Agent Economy" + the track-fit table from section 4 with real file paths
3. The problem, with the sourced number (section 2)
4. How it works, step by step (section 3 + 6.4 in plain words) + the invariant
5. NEAR features used, each with file path and what breaks without it (sub-accounts, function-call keys, contract escrow, NEP-141, NEP-145, NEP-297)
6. Claims table: claim → file:line → proof (test name, testnet tx hash, or log in `evidence/`)
7. What's mocked or not built: the demo seller and its voucher token are ours; NEAR Intents not used (no testnet); LLM optional/off by default
8. **Try it in 30 seconds:** `make verify`, which installs deps, starts a local sandbox, deploys the committed wasm, runs a 10-agent scenario to settlement, and prints the receipt. No keys, no wallet, no network beyond package installs, under 3 minutes. Paste the expected output. Then the hosted demo link and the testnet contract account.
9. "Do X, see Y" steps for the hosted demo (as HACKATHON.md asks)
10. Architecture with file paths
11. Measured results: gas per settlement chunk, members per pool tested, testnet run stats
12. Built during the hackathon vs pre-existing (all new; list libraries per Q-005)
13. **Other project by the same builder: Handover** (required by Q-015, one line with its repo link)
14. Full setup, env vars, deploy, security notes, roadmap (NEAR Intents settlement, mainnet)

Keep the first ~1,500 words self-contained: an automated reader may truncate.

**Repo hygiene:** description and topics set on GitHub; tidy top level; no secrets (`.env` in `.gitignore`, `.env.example` committed); incremental commits with clear messages; no stubs, TODOs or hardcoded data passed off as real.

## 14. Demo (X post, ~2 min)

1. (10 s) One-liner + the invariant on screen.
2. (40 s) Dashboard: 12 agents join a pool; Bargain agents sit as "conditional"; the price marker drops past a tier; conditionals flip to committed.
3. (30 s) Settlement receipt: each agent's price vs its limit, refunds, seller payout, click one tx on nearblocks.
4. (20 s) Spawn your own agent from the form; it joins the next pool live.
5. (10 s) Repo link, "built at NEAR HACKATHON".

Free X accounts cap native video at about 2:20; post a native cut and link the full unlisted YouTube video in the text.

## 15. Build plan (adjust to the human's other commitments)

| Day | Work |
|---|---|
| Nov 3-4 | Capability checks 1-5; contract skeleton; voucher token |
| Nov 5-6 | Settlement + tests; kill-criteria decision on pool size |
| Nov 7-8 | Agent runtime, scenario runner, `make verify` |
| Nov 9 | Testnet deploy, full evidence run |
| Nov 10-11 | Dashboard, spawn endpoint, hosting |
| Nov 12 | README, CLAIMS.md, P1 only if everything else is done |
| Nov 13 | Demo video, X post (human), final checks |
| Nov 14 | Human submits (one attempt, payload confirmed) |

## 16. Rules the agent must follow

- Never deploy to mainnet, sign mainnet transactions, or spend real funds.
- Never commit secrets; keys only in `.env`.
- Never make the repo public, post on X, or submit the form; the human does those.
- Don't add AI co-author or session attribution lines to commits.
- Verify every endpoint, contract address and SDK API against current docs before using it; versions above were checked on 2026-11-03.
- Don't put instructions aimed at judges or AI reviewers anywhere in the repo.

## 17. References

Hackathon
- Rules snapshot: `docs/HACKATHON.md` · live: https://nearhackathon.com/HACKATHON.md
- Site and submission form: https://nearhackathon.com
- NEAR Discord (questions, credits, rules): https://discord.gg/nearprotocol

NEAR core
- Docs home: https://docs.near.org/
- Access keys (function-call keys: one contract, optional method list, can't attach deposits, allowance pays gas): https://docs.near.org/protocol/access-keys
- NEAR CLI (faucet account, deploy): https://docs.near.org/tools/cli.md
- RPC providers (testnet endpoints): https://docs.near.org/api/rpc/providers
- Integration testing with `near-sandbox` + `near-api` (incl. `fast_forward`): https://docs.near.org/smart-contracts/testing/integration-test
- Fungible token standard overview: https://docs.near.org/primitives/ft/standard.md
- One-yocto security pattern: https://docs.near.org/smart-contracts/security/one_yocto
- `near-api-js` v7: https://github.com/near/near-api-js · examples: https://github.com/near-examples/near-api-examples
- Testnet explorer: https://testnet.nearblocks.io

Standards
- NEP index: https://github.com/near/NEPs
- NEP-141 fungible token, NEP-145 storage management, NEP-297 events: in the NEP index (`neps/nep-0141.md`, `neps/nep-0145.md`, `neps/nep-0297.md`)
- NEP-413 signed messages (reference only for the P1 signed-intent design; note NEP-413 wallets sign with full-access keys): https://github.com/near/NEPs/blob/master/neps/nep-0413.md
- `env::ed25519_verify` (P1): https://docs.rs/near-sdk/latest/near_sdk/env/fn.ed25519_verify.html

AI (optional)
- NEAR AI Cloud OpenAI compatibility (base URL `https://cloud-api.near.ai/v1`, tool calling, structured outputs): https://docs.near.ai/cloud/guides/openai-compatibility.md
- NEAR AI Cloud quickstart (API key, credits are purchased): https://docs.near.ai/cloud/quickstart

Roadmap only (not used: mainnet-only)
- NEAR Intents docs: https://docs.near-intents.org/
