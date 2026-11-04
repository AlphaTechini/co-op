# Claims

Every factual claim made in `README.md`, with where it is implemented (`file:line`) and what proves it. Line numbers refer to the files as committed with this document. A proof is one of:

- **unit test**: a Rust test in `contracts/coop/src/tests.rs` (native, no chain) or a vitest unit test;
- **integration test**: a vitest test that runs against a real local near-sandbox (nearcore 2.14.0), run with `make test-integration`;
- **evidence**: a committed output file in `evidence/`;
- **pending testnet run**: needs the testnet deploy that has not been done (NEAR testnet was not reachable from the build environment);
- **not proven by an automated test**: stated as such; the claim rests on reading the code.

Paths below are relative to the repository root. `tests.rs` means `contracts/coop/src/tests.rs`.

## 1. The invariant and settlement

| # | Claim | Code | Proof |
|---|---|---|---|
| 1 | No agent pays more than its own limit: a join is rejected if the lock price per unit exceeds `max_unit_price`, and an included member is charged at most the tier at its threshold | `contracts/coop/src/pool.rs:233`, `contracts/coop/src/offer.rs:88`, `contracts/coop/src/settle.rs:121` | unit tests `join_rejected_when_lock_price_exceeds_max_unit_price` (`tests.rs:745`), `invariant_over_30_random_members` (`tests.rs:1329`); evidence `evidence/sandbox-run.txt` ("every member paid <= units x its own limit", 10 members); check in `agents/src/verify.ts:109` |
| 2 | A lock never exceeds the agent's budget | `contracts/coop/src/pool.rs:249`, `:279` | unit test `lock_never_exceeds_budget` (`tests.rs:723`) |
| 3 | `paid + refunded + storage == locked` for every member, and the sum of member payments equals the seller payout | `contracts/coop/src/settle.rs:121` to `:152` | unit tests `invariant_over_30_random_members` (`tests.rs:1329`), `settle_pays_seller_delivers_and_returns_unsold` (`tests.rs:1117`); evidence `evidence/sandbox-run.txt` (checks "paid + refunded + storage == locked, per member" and "sum of member payments == seller payout"); `agents/src/verify.ts:112`, `:122`; integration tests `scenario.test.ts:16`, `chunked.test.ts:20` |
| 4 | The seller is paid only if a tier is reached | `contracts/coop/src/settle.rs:86` to `:116`, `:183` | unit test `no_tier_reached_refunds_everyone_and_pays_no_seller` (`tests.rs:1042`); integration test `agents/test/integration/scenario.test.ts:34` (refund path); `agents/src/verify.ts:135` |
| 5 | Group = largest set of members whose conditions all hold (greatest fixed point: start with everyone, drop the highest-threshold conditional while its threshold exceeds the total) | `contracts/coop/src/settle.rs:66`, `contracts/coop/src/pool.rs:153` | unit tests `resolve_basic_cases` (`tests.rs:243`), `resolve_equals_largest_consistent_subset_property` (brute force over all subsets, `tests.rs:283`), `cascading_exclusion_when_a_higher_threshold_drops` (`tests.rs:1023`); the web mirror `web/src/lib/settlement.test.ts:9`, `:35` |
| 6 | Two conditional members of 25 units with threshold 50 are both in (why the group is not grown from unconditional members) | `contracts/coop/src/settle.rs:66` | unit test `two_conditional_25_unit_members_with_threshold_50_both_get_in` (`tests.rs:1001`); `web/src/lib/settlement.test.ts:9` |
| 7 | A conditional member whose threshold is not reached is excluded and refunded in full | `contracts/coop/src/settle.rs:170` to `:178` | unit test `conditional_threshold_not_reached_is_excluded` (`tests.rs:973`); evidence `evidence/sandbox-run.txt` (the two "if >= 50" agents, outcome Excluded) |
| 8 | Group price = the best (last) tier whose `min_units` the total reaches | `contracts/coop/src/offer.rs:76` | unit test `price_for_picks_best_reached_tier` (`tests.rs:218`) |
| 9 | Lock price: entry tier if unconditional, the tier at the threshold if conditional | `contracts/coop/src/offer.rs:88` | unit test `lock_price_uses_threshold_tier` (`tests.rs:234`) |
| 10 | If no tier is reached, every member is refunded in full, the seller is not paid and all inventory returns | `contracts/coop/src/settle.rs:86`, `:183` | unit test `no_tier_reached_refunds_everyone_and_pays_no_seller` (`tests.rs:1042`); integration test `scenario.test.ts:34`; evidence `evidence/gas.md` ("50 members, pool refunded (no tier)") |
| 11 | `settle` is idempotent: a second call on a finished pool changes nothing | `contracts/coop/src/settle.rs:232`, `:239`, `:242` | unit test `settle_twice_is_idempotent` (`tests.rs:1099`); integration test `agents/test/integration/fckey.test.ts:95` |
| 12 | `settle` is refused before the deadline | `contracts/coop/src/settle.rs:237` | unit test `settle_before_deadline_rejected` (`tests.rs:904`); integration test `fckey.test.ts:95` |
| 13 | Settlement is chunked (default 10 members per call, also bounded by gas left); a pool of any size is finished by repeated calls, and the result equals a single-call settlement | `contracts/coop/src/settle.rs:21`, `:232` to `:280` | unit tests `chunked_settlement_matches_single_call` (`tests.rs:1197`), `default_chunk_and_gas_limit_bound_members_per_call` (`tests.rs:1257`), `settle_with_hopeless_gas_is_rejected` (`tests.rs:1287`), `finishing_waits_for_one_more_call_when_gas_runs_out` (`tests.rs:1297`); integration test `agents/test/integration/chunked.test.ts:20` (21 members over several transactions, all invariants hold); evidence `evidence/gas.md` |
| 14 | Unsold inventory returns to the seller | `contracts/coop/src/settle.rs:183` to `:225` | unit test `settle_pays_seller_delivers_and_returns_unsold` (`tests.rs:1117`); evidence `evidence/sandbox-run.txt` ("inventory fully accounted for", seller 1000000 -> 999976) |
| 15 | An empty pool settles in one call and returns inventory | `contracts/coop/src/settle.rs:232` | unit test `empty_pool_settles_in_one_call_and_returns_inventory` (`tests.rs:1090`) |
| 16 | A budget that expires mid-pool keeps its existing lock valid until settlement; an expired agent cannot join | `contracts/coop/src/pool.rs:227` | unit test `expired_agent_cannot_join_but_existing_lock_stays_valid` (`tests.rs:875`) |
| 17 | A failed delivery becomes a claimable balance and units are not lost; `claim` retries and pays out | `contracts/coop/src/settle.rs:283`, `contracts/coop/src/agent.rs:88`, `:196`, `:233` | unit tests `failed_delivery_becomes_claimable_and_can_be_claimed` (`tests.rs:1429`), `successful_delivery_callback_marks_delivered` (`tests.rs:1418`); integration test `agents/test/integration/claim.test.ts:31` |
| 18 | A failed return of unsold inventory is claimable by the seller | `contracts/coop/src/settle.rs:303` | unit test `failed_unsold_return_becomes_claimable_for_the_seller` (`tests.rs:1475`) |
| 19 | Members leave before the lock time with their lock and storage returned; not after; join order of the others is kept | `contracts/coop/src/pool.rs:291`, `:216` | unit tests `leave_before_lock_returns_lock_and_storage` (`tests.rs:818`), `leave_keeps_join_order_of_the_others` (`tests.rs:838`), `leave_after_lock_rejected` (`tests.rs:856`), `join_after_lock_rejected` (`tests.rs:867`); integration test `fckey.test.ts:63` |
| 20 | Pools are capped at 100 members and `max_units`; one membership per agent; `allowed_sellers` is honoured | `contracts/coop/src/lib.rs:35`, `contracts/coop/src/pool.rs:229`, `:238` to `:243` | unit tests `join_respects_pool_capacity_and_member_cap` (`tests.rs:777`), `join_respects_allowed_sellers` (`tests.rs:801`), `join_rejects_invalid_requests` (`tests.rs:758`) |

## 2. Offers and inventory

| # | Claim | Code | Proof |
|---|---|---|---|
| 21 | An offer opens only once the contract holds the full inventory (`max_units * unit_amount`) | `contracts/coop/src/offer.rs:196` to `:222` | unit test `offer_opens_only_after_full_inventory` (`tests.rs:466`) |
| 22 | Inventory deposits from the wrong token, the wrong sender, a malformed message, or after settlement started are returned | `contracts/coop/src/offer.rs:196` | unit tests `ft_on_transfer_rejects_wrong_token_sender_and_message` (`tests.rs:490`), `ft_on_transfer_rejected_once_settlement_started` (`tests.rs:509`) |
| 23 | Tiers must be strictly ascending in units, strictly descending in price, at most 8 | `contracts/coop/src/offer.rs:54` | unit test `validate_tiers_rules` (`tests.rs:308`) |
| 24 | The seller can only improve tiers: a new ladder must be no worse for buyers at any total; seller-only, 1 yocto, before the lock | `contracts/coop/src/offer.rs:98`, `:228` | unit tests `is_improvement_cases` (`tests.rs:342`), `improve_offer_accepts_better_and_rejects_worse` (`tests.rs:518`), `improve_offer_seller_only` (`tests.rs:541`), `improve_offer_rejected_after_lock` (`tests.rs:550`), `improved_tiers_are_used_for_settlement_prices` (`tests.rs:558`); integration test `agents/test/integration/negotiation.test.ts:16` |
| 25 | `create_offer` charges measured storage and refunds the excess; rejects short deadlines, long titles, too many units | `contracts/coop/src/offer.rs:125` | unit tests `create_offer_validates_and_refunds_excess` (`tests.rs:374`), `create_offer_needs_storage_deposit` (`tests.rs:399`), `create_offer_rejects_short_deadline` (`tests.rs:416`), `create_offer_rejects_long_title` (`tests.rs:433`), `create_offer_rejects_too_many_units` (`tests.rs:450`) |

## 3. Agents, keys and security

| # | Claim | Code | Proof |
|---|---|---|---|
| 26 | Every agent is a sub-account of its owner; `register_agent` accepts only a direct sub-account (`<label>.<caller>`, no dot in the label) | `contracts/coop/src/agent.rs:125` to `:132` | unit test `register_agent_rejects_non_direct_subaccount` (`tests.rs:595`); evidence `evidence/check-02-fckey-sandbox.txt` ("register_agent accepted the direct sub-account"); integration test `server/test/integration/spawn.test.ts:38` |
| 27 | The contract rejects its own account as an agent | `contracts/coop/src/agent.rs:133` | unit test `register_agent_rejects_contract_account` (`tests.rs:608`) |
| 28 | An agent cannot be registered twice; storage is charged from the deposit | `contracts/coop/src/agent.rs:134`, `:150` | unit tests `register_agent_twice_fails` (`tests.rs:618`), `register_agent_charges_storage_and_credits_budget` (`tests.rs:579`), `register_agent_needs_storage_deposit` (`tests.rs:627`) |
| 29 | The agent runtime holds only a function-call key limited to `join_pool` / `leave_pool` on the Co-op contract | `agents/src/chain.ts:575`, `:595`, `agents/src/world.ts:161` | evidence `evidence/check-02-fckey-sandbox.txt` (key permission `{"FunctionCall":{"allowance":null,"method_names":["join_pool","leave_pool"],"receiver_id":"coop.sandbox"}}`); integration test `agents/test/integration/fckey.test.ts:26`, `:86` |
| 30 | `join_pool` with that key and zero deposit succeeds (2.87 Tgas in the check) | `contracts/coop/src/pool.rs:200` (no `#[payable]`) | evidence `evidence/check-02-fckey-sandbox.txt`; integration test `fckey.test.ts:26` |
| 31 | With the key, attaching 1 yocto, calling `withdraw`, sending a plain NEAR transfer, and calling another contract are all rejected by the protocol | enforced by nearcore access-key rules; key built at `agents/src/chain.ts:575` | evidence `evidence/check-02-fckey-sandbox.txt` (four PASS lines); integration test `fckey.test.ts:26` |
| 32 | The key can `leave_pool` before the lock and not after | `contracts/coop/src/pool.rs:291` | integration test `fckey.test.ts:63`; evidence `evidence/check-02-fckey-sandbox.txt` ("leave_pool with the key returns the lock to the budget") |
| 33 | Owner methods require 1 yoctoNEAR: `withdraw`, `update_limits`, `improve_offer`, and the demo token's `mint` | `contracts/coop/src/agent.rs:172`, `:182`, `contracts/coop/src/offer.rs:229`, `contracts/credits-token/src/lib.rs:75` | unit tests `fund_withdraw_and_update_limits_are_owner_only_with_one_yocto` (`tests.rs:634`), `owner_only_methods_require_one_yocto` (`tests.rs:663`), `withdraw_cannot_exceed_available` (`tests.rs:690`); token test `mint_requires_one_yocto` (`contracts/credits-token/src/lib.rs:238`) |
| 34 | Owner-only methods are callable only by the agent's owner | `contracts/coop/src/agent.rs:109` to `:118` | unit test `fund_withdraw_and_update_limits_are_owner_only_with_one_yocto` (`tests.rs:634`) |
| 35 | Promise callbacks are `#[private]` | `contracts/coop/src/settle.rs:282`, `:302`, `contracts/coop/src/agent.rs:232` | **not proven by an automated test**: the attribute is applied by the near-sdk macro; no test calls a callback from an outside account and expects a panic. Rests on reading the code |
| 36 | The contract has no admin, owner or upgrade method | `contracts/coop/src/lib.rs:63` to `:75` (state has no owner field), `:81` (`new()` takes no arguments) | **not proven by an automated test**: rests on the method list in `contracts/README.md` and the source |
| 37 | `lock-contract` deletes the contract account's full-access keys, verifies none remain and the code hash is unchanged; dry run by default; a second run is a no-op | `agents/src/lock-contract.ts:17`, `agents/src/lock.ts:34` | integration test `agents/test/integration/lock.test.ts:16` (sandbox). On testnet: **pending testnet run** (`evidence/contract-lock.md` does not exist yet) |
| 38 | The committed wasm's SHA-256 is checked against `contracts/res/SHA256SUMS` before every deploy, and the on-chain `code_hash` is compared after | `agents/src/deploy.ts:35` to `:43`, `:129` to `:133`, `Makefile:22` to `:26`, `contracts/res/SHA256SUMS` | evidence `evidence/sandbox-run.txt` (SHA-256 lines, "matches SHA256SUMS", both on-chain `code_hash` lines "(matches)", `coop.wasm: OK`); evidence `evidence/check-03-sandbox.txt` ("on-chain code_hash equals the committed SHA-256") |
| 39 | The spawn endpoint is rate limited and capped: per-IP hourly limit (429 with `Retry-After`), total agents cap (503), per-agent budget cap, operator balance floor (503), general per-IP rate limit (429), 4 KB bodies | `server/src/spawner.ts:165`, `:207`, `:216`, `server/src/app.ts:61`, `:81`, `:168`, `server/src/settings.ts:75` to `:80` | server unit tests `server/test/unit/app.test.ts:177` (per-IP), `:192` (general), `:211` (agent cap), `:220` (operator floor), `:114` (oversize body), `:104` (validation 400s) |
| 40 | Spawned agents' keys are stored with mode 0600 in a 0700 directory, git-ignored, and never returned by any endpoint | `server/src/store.ts:58`, `:60`, `server/.gitignore` | server unit tests `server/test/unit/store.test.ts:18`, `server/test/unit/app.test.ts:151` |
| 41 | A spawn creates a sub-account, adds the function-call key, registers and funds the agent, and the agent joins the open pool | `server/src/spawner.ts:177`, `agents/src/world.ts:155` | integration test `server/test/integration/spawn.test.ts:38`; unit test `server/test/unit/app.test.ts:126` |

## 4. NEAR standards

| # | Claim | Code | Proof |
|---|---|---|---|
| 42 | NEP-141: inventory arrives with `ft_transfer_call` and `ft_on_transfer`; goods are delivered with `ft_transfer`; the demo token implements NEP-141 with metadata | `contracts/coop/src/offer.rs:196`, `contracts/coop/src/agent.rs:63`, `contracts/credits-token/src/lib.rs:91` | token unit tests `init_mints_supply_to_owner_with_zero_decimals` (`contracts/credits-token/src/lib.rs:204`), `transfers_need_registration_and_one_yocto` (`:253`); evidence `evidence/sandbox-run.txt` (token balances match units delivered) |
| 43 | NEP-145: each delivery batch registers the agent on the item token (`storage_deposit`, registration only) before `ft_transfer`; the token's registration minimum fits Co-op's `STORAGE_RESERVE` | `contracts/coop/src/agent.rs:63` to `:85`, `contracts/coop/src/lib.rs:33` | token unit test `registration_bound_fits_the_coop_storage_reserve` (`contracts/credits-token/src/lib.rs:216`); evidence `evidence/gas.md` (every member is a fresh agent, so every fill performs the registration) |
| 44 | NEP-297: events are `EVENT_JSON:{"standard":"coop","version":"1.0.0",...}` | `contracts/coop/src/events.rs:11` to `:18` | unit test `events_follow_nep297_format` (`tests.rs:1164`); events parsed at `agents/src/chain.ts:118` and used by `agents/src/verify.ts:126` (check "seller_paid event matches payout") |

## 5. Agents and the swarm

| # | Claim | Code | Proof |
|---|---|---|---|
| 45 | Every decision is made by a deterministic policy engine from structured limits | `agents/src/policy.ts:204` | unit tests in `agents/test/unit/policy.test.ts` (`:69`, `:88`, `:118`, `:157`) |
| 46 | Eager joins unconditionally if the entry price is within its limit; the on-chain limit wins if stricter | `agents/src/policy.ts:115` | unit tests `agents/test/unit/policy.test.ts:69`, `:75`, `:81` |
| 47 | Bargain joins conditionally at the group size of the cheapest tier within its limit, and skips if none | `agents/src/policy.ts:130` | unit tests `agents/test/unit/policy.test.ts:89`, `:95`, `:101`, `:106`, `:111` |
| 48 | Switcher leaves a pool before the lock when another open pool for the same item projects a lower price | `agents/src/policy.ts:173`, `:204` | unit tests `agents/test/unit/policy.test.ts:160`, `:169`, `:176`; integration test `agents/test/integration/runtime.test.ts:17` |
| 49 | The seller agent proposes valid improvements to a stalled pool near the lock | `agents/src/seller.ts:93`, `:128` | integration test `agents/test/integration/negotiation.test.ts:16` |
| 50 | The Settler (the runtime) settles expired pools until finished, and one failing agent does not stop the others | `agents/src/runtime.ts:242`, `:339` | integration tests `agents/test/integration/runtime.test.ts:41`, `scenario.test.ts:16`; unit test `agents/test/unit/runtime.test.ts:52` |
| 51 | The scenario of 12 agents reaches tier 2 and not tier 3, and every invariant holds | `agents/src/scenario.ts:111`, `agents/src/roster.ts:58` | integration test `agents/test/integration/scenario.test.ts:16`; unit tests `agents/test/unit/roster.test.ts:9` |
| 52 | `make verify` runs a 10-agent scenario on a local sandbox, prints the receipt and recomputes 13 invariant checks from chain views | `Makefile:28`, `agents/src/scenario.ts:294`, `agents/src/verify.ts:64`, `agents/src/receipt.ts:9` | evidence `evidence/sandbox-run.txt` (captured output quoted in the README: 24 units from 8 of 10 agents at 0.70, seller payout 16.80 NEAR, "ALL INVARIANTS HOLD") |
| 53 | The receipt shows each agent's price against its limit, refunds, the seller payout and the saving against the entry price | `agents/src/receipt.ts:9` to `:60`, `web/src/lib/components/ReceiptView.svelte` | evidence `evidence/sandbox-run.txt`; web rendering is **not covered by a browser test** (see 59) |
| 54 | The LLM is optional and off by default; without it the rules parser answers and reports `rules`; failures fall back to rules and say so; LLM output must pass a schema | `agents/src/brief.ts:131`, `:141`, `:215` | unit tests `agents/test/unit/brief.test.ts:79` to `:107` (schema accepted/rejected, fallback on error, no fake LLM when unconfigured, `parser=llm` only when the model answered); rules parser tests `:13` to `:62`; `checks/06-llm.ts` prints SKIP without a key |
| 55 | Memos are short (140 chars) and free of dashes that read as em-dashes | `agents/src/policy.ts:52` | unit test `agents/test/unit/policy.test.ts:147` |

## 6. Measured results (sandbox only)

| # | Claim | Code | Proof |
|---|---|---|---|
| 56 | About 7.2 Tgas burnt per filled member (7.07 to 7.43 for 10, 25, 50 members); 0.90 Tgas per member in a refunded pool | `checks/04-settle-gas.ts` | evidence `evidence/gas.md` ("Per scenario" table) |
| 57 | 10 members per `settle` call at 300 Tgas (ceiling `DEFAULT_CHUNK`; the gas guard alone allows 12); 25 members need 3 calls, 50 members need 5 | `contracts/coop/src/settle.rs:21`, `:232` | evidence `evidence/gas.md`; unit test `default_chunk_and_gas_limit_bound_members_per_call` (`tests.rs:1257`) |
| 58 | With 1000 Tgas and `max_members` 25, 25 members settle in one call; largest receipt log 4987 bytes of the 16384 byte cap; `join_pool` 2.86 Tgas and first member's `leave_pool` 19.95 Tgas at 100 members | `checks/04-settle-gas.ts` | evidence `evidence/gas.md` |
| 59 | Sandbox runs on nearcore 2.14.0, protocol 88, boots in about 2.4 s, and `sandbox_fast_forward` moves chain time | `agents/src/config.ts:7`, `agents/src/sandbox.ts:41`, `checks/03-sandbox.ts` | evidence `evidence/check-03-sandbox.txt` |
| 60 | The deploy and scenario scripts refuse a testnet below protocol 88 (near-sdk 5.30 needs it) | `agents/src/deploy-testnet.ts:41`, `agents/src/scenario.ts:323` | **not proven by an automated test** (testnet-only code path); rests on reading the code and `evidence/check-03-sandbox.txt` for the sandbox protocol |

## 7. Web and server

| # | Claim | Code | Proof |
|---|---|---|---|
| 61 | The web app has a live pool page (tier ladder, projected price marker, feed, countdowns), a settlement receipt, a spawn form and a how-it-works page | `web/src/routes/pool/+page.svelte`, `web/src/routes/spawn/+page.svelte`, `web/src/routes/how/+page.svelte`, `web/src/lib/components/ReceiptView.svelte`, `web/src/lib/components/TierLadder.svelte` | The logic is unit tested (`web/src/lib/settlement.test.ts`, `brief.test.ts`, `feed.test.ts`, `format.test.ts`) and the package is typechecked by `svelte-check` (`make check`). **Page rendering is not covered by a browser test**; try it with `make demo` |
| 62 | The web app reads pool state directly from RPC views and works without the server | `web/src/lib/rpc.svelte.ts:1`, `:102` | **not proven by an automated test**; rests on reading the code |
| 63 | The server exposes health, config, activity, SSE stream, agents list and spawn routes | `server/src/app.ts` | server unit tests `server/test/unit/app.test.ts:17`, `:24`, `:58`, `:261`, `:126` |
| 64 | Without an operator key the server runs read-only and spawning answers 503 | `server/src/spawner.ts:150`, `:180` | server unit test `server/test/unit/app.test.ts:202` |

## 8. Statements about scope

| # | Claim | Proof |
|---|---|---|
| 65 | NEAR Intents is not used | `grep -ri "intents" contracts agents server web` finds no integration code; stated in the README. Not applicable to test |
| 66 | The demo seller and voucher token are ours, labelled as a demo | token metadata name set at `agents/src/deploy.ts:120` ("Demo API credit voucher (Co-op demo seller)"); `contracts/credits-token/src/lib.rs:4` |
| 67 | All code was written during the hackathon window; libraries are those listed in the README | Git history of this repository; versions in `Cargo.toml`, `agents/package.json`, `server/package.json`, `web/package.json`, `checks/package.json` |
| 68 | dRPC sells RPC calls at $6.00 per million pay as you go and $4.20 per million on its $199 plan (30% less) | README section 3 | Vendor docs: https://github.com/drpcorg/drpc-nextra/blob/main/pages/pricing/plans.mdx#L27-L30 (checked 2026-11-04; list price, may change) |
| 69 | Google Cloud Vision charges $1.50 per 1,000 images at the entry tier and $0.60 above 5 million a month (60% less) | README section 3 | Vendor pricing page: https://cloud.google.com/vision/pricing (checked 2026-11-04; list price, may change) |
| 70 | dYdX's taker fee drops from 5.0 to 2.5 basis points at $200M of 30-day volume (50% less) | README section 3 | Protocol docs: https://github.com/dydxprotocol/v4-documentation/blob/main/docs/pages/concepts/trading/rewards/index.mdx#L53-L61 (checked 2026-11-04; governance can change fees) |

## 9. Pending (needs a testnet run)

None of the following exists yet. Each has the exact command that produces it.

| Item | Command | Output file |
|---|---|---|
| Testnet deploy of `coop.<operator>.testnet` and `credits.<operator>.testnet`, with the on-chain `code_hash` matching `contracts/res/SHA256SUMS` | `pnpm --filter @coop/agents deploy:testnet` | `evidence/testnet-deploy.md` |
| A 12+ agent run on testnet with every transaction hash | `pnpm --filter @coop/agents scenario --agents 12 --network testnet` | `evidence/testnet-run-<time>.md` and `.json` |
| Removal of the contract account's full-access keys | `pnpm --filter @coop/agents lock-contract --yes` | `evidence/contract-lock.md` |
| Hosted demo (spawn server and web) | see `deploy/README.md` (server on a GCP VM, site on Vercel) | URL in the README "Live deployment" table |
| Testnet RPC rate-limit check | `pnpm --filter @coop/checks exec tsx 05-rpc.ts` | console output (not yet run) |
