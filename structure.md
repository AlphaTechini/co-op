# Project structure

```text
co-op/
├── contracts/                Rust contracts (near-sdk 5.30)
│   ├── coop/src/             Co-op: offers, agents, pools, resolve + chunked settle
│   ├── credits-token/src/    Demo NEP-141 voucher token (the seller's inventory)
│   └── res/                  Committed wasm + SHA256SUMS
├── agents/                   TypeScript swarm: client, policy, runtime, seller, sandbox, scenario
│   ├── src/
│   └── test/{unit,integration}/
├── server/                   Fastify API: rooms, wallet and demo spawn, activity feed (SSE), seller loops; Dockerfile
│   ├── src/
│   └── test/{unit,integration}/
├── web/                      SvelteKit dashboard (prerendered, Vercel)
│   ├── src/routes/{agents,create,how,pool,room,spawn}/
│   ├── src/lib/{components,stores,styles,assets}/
│   └── static/
├── checks/                   Capability checks 01 to 06
├── deploy/                   GCP VM + Caddy + Vercel hosting steps
├── design/                   Design system, mockups, screenshots
│   ├── mockups/
│   └── screens/
├── docs/                     PRD, interface spec, claims table, hackathon rules
├── evidence/                 Captured run output cited by the README
├── Makefile                  make verify / check / test-integration / checks / demo
└── README.md
```

## Where the logic lives

| Concern | Location |
|---|---|
| Who gets into the group, what everyone pays | [contracts/coop/src/settle.rs](contracts/coop/src/settle.rs) |
| The lock that caps what an agent can pay | [contracts/coop/src/pool.rs](contracts/coop/src/pool.rs), [contracts/coop/src/offer.rs](contracts/coop/src/offer.rs) |
| Agent budgets, withdrawals, claims, deliveries | [contracts/coop/src/agent.rs](contracts/coop/src/agent.rs) |
| Agent decisions (join, wait, leave) | [agents/src/policy.ts](agents/src/policy.ts) |
| The swarm loop and the settler | [agents/src/runtime.ts](agents/src/runtime.ts) |
| Contract client, sub-accounts, function-call keys | [agents/src/chain.ts](agents/src/chain.ts), [agents/src/world.ts](agents/src/world.ts) |
| `make verify`: scenario, receipt, invariant check | [agents/src/scenario.ts](agents/src/scenario.ts), [agents/src/receipt.ts](agents/src/receipt.ts), [agents/src/verify.ts](agents/src/verify.ts) |
| Local sandbox start and bounded shutdown | [agents/src/sandbox.ts](agents/src/sandbox.ts) |
| Testnet deploy and contract lock | [agents/src/deploy-testnet.ts](agents/src/deploy-testnet.ts), [agents/src/lock-contract.ts](agents/src/lock-contract.ts) |
| Spawn-your-agent API and its key store | [server/src/spawner.ts](server/src/spawner.ts), [server/src/store.ts](server/src/store.ts) |
| Wallet spawn (visitor's wallet creates and funds the agents) | [server/src/wallet-spawn.ts](server/src/wallet-spawn.ts), [web/src/lib/agent-txs.ts](web/src/lib/agent-txs.ts), [web/src/lib/wallet.svelte.ts](web/src/lib/wallet.svelte.ts) |
| Rooms, codes and the item catalog | [server/src/rooms.ts](server/src/rooms.ts), [server/src/catalog.ts](server/src/catalog.ts), [agents/src/deploy-items.ts](agents/src/deploy-items.ts) |
| HTTP routes, limits, live feed | [server/src/app.ts](server/src/app.ts), [server/src/activity.ts](server/src/activity.ts) |
| Dashboard data from RPC | [web/src/lib/rpc.svelte.ts](web/src/lib/rpc.svelte.ts), [web/src/lib/stores/pool.svelte.ts](web/src/lib/stores/pool.svelte.ts) |
| Receipt figures in the browser | [web/src/lib/proof.ts](web/src/lib/proof.ts) |
| Server image and hosting | [server/Dockerfile](server/Dockerfile), [deploy/README.md](deploy/README.md) |

## Folder READMEs

- [README.md](README.md) (root)
- contracts: [contracts/](contracts/README.md), [coop/](contracts/coop/README.md), [coop/src/](contracts/coop/src/README.md), [credits-token/](contracts/credits-token/README.md), [credits-token/src/](contracts/credits-token/src/README.md), [res/](contracts/res/README.md)
- agents: [agents/](agents/README.md), [src/](agents/src/README.md), [test/](agents/test/README.md), [test/unit/](agents/test/unit/README.md), [test/integration/](agents/test/integration/README.md)
- server: [server/](server/README.md), [src/](server/src/README.md), [test/](server/test/README.md), [test/unit/](server/test/unit/README.md), [test/integration/](server/test/integration/README.md)
- web: [web/](web/README.md), [src/](web/src/README.md), [src/lib/](web/src/lib/README.md), [src/lib/components/](web/src/lib/components/README.md), [src/lib/stores/](web/src/lib/stores/README.md), [src/lib/styles/](web/src/lib/styles/README.md), [src/lib/assets/](web/src/lib/assets/README.md), [src/routes/](web/src/routes/README.md), [src/routes/pool/](web/src/routes/pool/README.md), [src/routes/room/](web/src/routes/room/README.md), [src/routes/agents/](web/src/routes/agents/README.md), [src/routes/create/](web/src/routes/create/README.md), [src/routes/spawn/](web/src/routes/spawn/README.md), [src/routes/how/](web/src/routes/how/README.md), [static/](web/static/README.md)
- [checks/](checks/README.md)
- [deploy/](deploy/README.md)
- design: [design/](design/README.md), [mockups/](design/mockups/README.md), [screens/](design/screens/README.md)
- [docs/](docs/README.md)
- [evidence/](evidence/README.md)
