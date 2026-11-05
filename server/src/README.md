# server/src

Sources of `@coop/server`. Routes, environment variables and the key file are documented in [../README.md](../README.md).

| File | Purpose |
|---|---|
| [index.ts](index.ts) | Entry point: loads env and settings, resumes spawned agents, starts HTTP, shuts down on SIGTERM / SIGINT |
| [node.ts](node.ts) | Wires the real chain, the embedded `AgentRuntime`, the key store, the seller loop and the HTTP app |
| [app.ts](app.ts) | Fastify app factory: routes, CORS, rate limits, error shape, security headers |
| [spawner.ts](spawner.ts) | Server-paid spawn (the demo fallback): validation, caps, keys stored before any transaction, provisioning, resume; also the shared agent-record registry |
| [wallet-spawn.ts](wallet-spawn.ts) | Wallet spawn: hands out join/leave keys, then starts the agents once the visitor's wallet has created and registered them |
| [rooms.ts](rooms.ts) | Rooms: a pool with a purpose and a 6-character join code; create, list, look up, persist |
| [catalog.ts](catalog.ts) | What rooms can buy: one demo item token per entry, enabled by its env var |
| [store.ts](store.ts) | Key file for spawned agents (mode 0600), with retired and other-deployment files kept aside |
| [activity.ts](activity.ts) | Bounded activity ring buffer and the SSE fan-out |
| [seller-loop.ts](seller-loop.ts) | Keeps one offer open; one loop per catalog item keeps that item's public room open |
| [settings.ts](settings.ts) | Settings from env, validated once at boot |
| [demo.ts](demo.ts) | `make demo`: sandbox, this server, scripted agents and the env file for the web dev server |

## Decisions and tradeoffs

- **Side effects arrive through ports.** `app.ts` and `spawner.ts` receive the chain, runtime and store as interfaces, so the route tests run with fakes and no chain.
- **Keys are written before money moves.** A spawn generates the agent's keys and saves them before the first transaction; if the save fails nothing is spent, and if a transaction fails the keys move to `agents.json.retired`.
- **One spawn at a time.** All provisioning signs with the single operator key, so spawns are serialised to avoid nonce clashes.
- **Wallet spawn is non-custodial for funds.** The visitor's wallet creates `<name>-N.<visitor>` and calls `register_agent`, so the contract records the visitor as owner and sends refunds and withdrawals to them. The server holds only the function-call key (join and leave, zero deposit), and the browser keeps the agent's full-access key. The tradeoff: the server cannot finish a half-done spawn itself, so pending agents are swept every 15 s and dropped after an hour if the chain never shows them.
- **A room code is an app-level gate, not an on-chain one.** The contract lets any registered agent join any open pool; the code decides which pool this server's agents are limited to (`RuntimeAgent.poolId`). Public rooms show their code, invite rooms only return it to their creator.
- **Rooms reuse the seller.** Every room's pool is posted by the demo seller (the operator) with the same tier ladder; a visitor opening a room pays nothing. Limits: 2 open invite rooms per host, 12 in total, 4 per IP per hour.

## Logic map

- To find the spawn flow and its caps visit [spawner.ts](spawner.ts) (`spawn`).
- To find the wallet spawn flow visit [wallet-spawn.ts](wallet-spawn.ts) (`prepare`, `activate`, `sweep`).
- To find room creation, codes and limits visit [rooms.ts](rooms.ts) (`create`).
- To find the items rooms can buy visit [catalog.ts](catalog.ts).
- To find the routes visit [app.ts](app.ts).
- To find the live feed visit [activity.ts](activity.ts).
- The key store can be found in [store.ts](store.ts).
- The chain connection and the embedded runtime can be found in [node.ts](node.ts).
