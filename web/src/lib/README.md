# web/src/lib

Pure modules are kept free of Svelte so they can be unit tested; components only render what these compute.

| File | Purpose |
|---|---|
| [rpc.svelte.ts](rpc.svelte.ts) | Minimal NEAR JSON-RPC view client with fallback endpoints |
| [chain.ts](chain.ts) | Typed contract views on top of the RPC client |
| [api.ts](api.ts) | Optional Co-op server client; every call degrades to null |
| [config.svelte.ts](config.svelte.ts) | Build-time config refined at runtime by `GET /api/config` |
| [models.ts](models.ts) | Wire shapes of the contract views and the server API |
| [settlement.ts](settlement.ts) | Client-side mirror of the contract's resolver and pricing |
| [ladder.ts](ladder.ts) | Tier-ladder geometry and copy |
| [proof.ts](proof.ts) | The invariant made visible: receipt figures computed in BigInt from chain data |
| [members.ts](members.ts) | Member row and pill states, archetype labels |
| [feed.ts](feed.ts) | Activity feed model: server entries and chain-derived events in one shape |
| [status.ts](status.ts) | Locked / Expired status derived between polls, never downgraded |
| [format.ts](format.ts) | Number, NEAR and time formatting (DESIGN.md section 11) |
| [brief.ts](brief.ts) | Preview copy of the server's rules parser for the spawn form |
| [fixtures.test-util.ts](fixtures.test-util.ts) | Test fixtures only |
| `*.test.ts` | Unit tests for brief, feed, format and settlement |

Folders: [components/](components/README.md), [stores/](stores/README.md), [styles/](styles/README.md), [assets/](assets/README.md).

## Logic map

- To find the "N more units" projection visit [settlement.ts](settlement.ts).
- To find the receipt numbers (paid against limit, refunds, payout) visit [proof.ts](proof.ts).
- The NEAR RPC connection can be found in [rpc.svelte.ts](rpc.svelte.ts); the Co-op server connection can be found in [api.ts](api.ts).
