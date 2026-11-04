# contracts/credits-token/src

| File | Purpose |
|---|---|
| [lib.rs](lib.rs) | The token: `new`, owner-only `mint`, NEP-141 transfers, NEP-145 storage, metadata, and its unit tests |

- To find the mint rules (owner only, exactly 1 yocto, recipient registered from the contract's balance) visit [lib.rs](lib.rs).
- The Co-op side that receives and delivers these tokens can be found in [../../coop/src/offer.rs](../../coop/src/offer.rs) and [../../coop/src/agent.rs](../../coop/src/agent.rs).
