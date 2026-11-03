# Settlement gas (check 04)

Measured on a local near-sandbox, nearcore 2.14.0 (protocol 88), 2026-11-03T22:41:37.748Z, with `checks/04-settle-gas.ts`.
Every member is a fresh agent, so each fill really does `storage_deposit` (NEP-145 registration) + `ft_transfer` on the item token, then the `on_delivered` callback. Gas is the sum of `gas_burnt` over the transaction and every receipt it spawned (the callbacks and the token calls are included because the harness waits for all receipts).

## Per scenario

| scenario | members | attached gas per call (Tgas) | settle calls | members in the biggest call | total gas burnt (Tgas) | gas burnt per member (Tgas) | largest log per receipt (bytes) | log lines in the biggest tx |
|---|---|---|---|---|---|---|---|---|
| 10 members, all filled | 10 | 300 | 1 | 10 | 74.3 | 7.43 | 2242 | 24 |
| 25 members, all filled | 25 | 300 | 3 | 10 | 180.2 | 7.21 | 1998 | 21 |
| 50 members, all filled | 50 | 300 | 5 | 10 | 353.3 | 7.07 | 2074 | 23 |
| 50 members, pool refunded (no tier) | 50 | 300 | 5 | 10 | 44.8 | 0.90 | 1786 | 12 |
| 25 members, all filled, 300 Tgas, max_members 25 | 25 | 300 | 3 | 12 | 180.5 | 7.22 | 2364 | 25 |
| 25 members, all filled, 1000 Tgas | 25 | 1000 | 1 | 25 | 175.6 | 7.02 | 4987 | 54 |

## Every settle call

| scenario | call | members processed in this call | cursor after | remaining | status after | tx gas burnt, all receipts (Tgas) | settle receipt alone (Tgas) | receipts | log bytes, largest receipt | log lines | all receipts succeeded |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 10 members, all filled | 1 | 10 | 10 | 0 | Settled | 74.3 | 19.1 | 37 | 2242 | 24 | yes |
| 25 members, all filled | 1 | 10 | 10 | 15 | Settling | 69.6 | 18.0 | 32 | 1998 | 21 | yes |
| 25 members, all filled | 2 | 10 | 20 | 5 | Settling | 69.6 | 17.9 | 32 | 1830 | 20 | yes |
| 25 members, all filled | 3 | 5 | 25 | 0 | Settled | 41.0 | 11.1 | 22 | 1159 | 13 | yes |
| 50 members, all filled | 1 | 10 | 10 | 40 | Settling | 69.7 | 18.0 | 32 | 1998 | 21 | yes |
| 50 members, all filled | 2 | 10 | 20 | 30 | Settling | 69.6 | 17.9 | 32 | 1830 | 20 | yes |
| 50 members, all filled | 3 | 10 | 30 | 20 | Settling | 69.7 | 17.9 | 32 | 1830 | 20 | yes |
| 50 members, all filled | 4 | 10 | 40 | 10 | Settling | 69.7 | 17.9 | 32 | 1830 | 20 | yes |
| 50 members, all filled | 5 | 10 | 50 | 0 | Settled | 74.6 | 19.1 | 37 | 2074 | 23 | yes |
| 50 members, pool refunded (no tier) | 1 | 10 | 10 | 40 | Settling | 8.1 | 7.8 | 1 | 1786 | 11 | yes |
| 50 members, pool refunded (no tier) | 2 | 10 | 20 | 30 | Settling | 8.0 | 7.7 | 1 | 1640 | 10 | yes |
| 50 members, pool refunded (no tier) | 3 | 10 | 30 | 20 | Settling | 8.1 | 7.7 | 1 | 1640 | 10 | yes |
| 50 members, pool refunded (no tier) | 4 | 10 | 40 | 10 | Settling | 8.0 | 7.7 | 1 | 1640 | 10 | yes |
| 50 members, pool refunded (no tier) | 5 | 10 | 50 | 0 | Refunded | 12.5 | 8.6 | 5 | 1735 | 12 | yes |
| 25 members, all filled, 300 Tgas, max_members 25 | 1 | 12 | 12 | 13 | Settling | 83.1 | 21.2 | 38 | 2364 | 25 | yes |
| 25 members, all filled, 300 Tgas, max_members 25 | 2 | 12 | 24 | 1 | Settling | 83.2 | 21.1 | 38 | 2196 | 24 | yes |
| 25 members, all filled, 300 Tgas, max_members 25 | 3 | 1 | 25 | 0 | Settled | 14.1 | 4.6 | 10 | 427 | 5 | yes |
| 25 members, all filled, 1000 Tgas | 1 | 25 | 25 | 0 | Settled | 175.6 | 43.3 | 82 | 4987 | 54 | yes |

## What the numbers say

- With the default `DEFAULT_CHUNK` a 300 Tgas `settle` call processes **10 filled members** (the ceiling binds). Asking for more (`max_members: 25`) shows where the contract's own gas guard stops at 300 Tgas: **12 filled members per call**. The guard sizes each call from the gas left after the first filled member (`env::used_gas()`, which counts the 18 Tgas it attaches to the token batch and callback plus receipt fees).
- What actually burns is far less than what the contract reserves: **7.2 Tgas per filled member** across the whole receipt tree (settle work, `storage_deposit`, `ft_transfer`, `on_delivered`). Unused attached gas is refunded to the caller, so reserving more than is burnt costs extra transactions, not extra money.
- Attaching 1000 Tgas (the protocol maximum on protocol 88) with an explicit `max_members` of 25 processed 25 members in one call (1 call for the 25-member pool). 300 Tgas is still the recommended cap for wallets and CLIs.
- A refunded pool is cheaper per member (no promises): 50 members took 5 calls at 300 Tgas, 0.90 Tgas burnt per member.
- **Log size is not the binding limit.** The protocol allows 16384 bytes of logs per receipt (and 100 lines). One `member_filled` event is about 232 bytes, so a single receipt could carry about 70 members' events before hitting the cap, far more than the 12 that gas allows per 300 Tgas call.
- Worst case for the agents' own calls: with 100 members in the pool (MAX_MEMBERS), `join_pool` burnt 2.86 Tgas and the first member's `leave_pool` (which shifts the member list) burnt 19.95 Tgas. The runtime attaches 50 Tgas to each.

## Recommended DEFAULT_CHUNK

**keep DEFAULT_CHUNK = 10** (`contracts/coop/src/settle.rs`, currently 10).

Reason: at 300 Tgas the gas guard lets 12 filled members through one call, so a ceiling of 10 is the largest multiple of 5 that every default call can finish inside 300 Tgas (17% of headroom for a heavier first member), and it stays far below the 16 KB log cap (about 70 members). `DEFAULT_CHUNK` is only a ceiling, because the contract also stops when the gas left is below its per-member estimate, so a value that is too high cannot make a call run out of gas; a value that is too low only costs extra transactions. The runtime's settler loops until the pool is finished, so a 50-member pool takes 5 settle transactions at this ceiling (measured with the current ceiling of 10: 5). The 100-member cap (`MAX_MEMBERS`) bounds the worst case at about 10 calls.

This file does not change the contract; the number is a recommendation only.
