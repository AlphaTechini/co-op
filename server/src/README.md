# server/src

Sources of `@coop/server`. Routes, environment variables and the key file are documented in [../README.md](../README.md).

| File | Purpose |
|---|---|
| [index.ts](index.ts) | Entry point: loads env and settings, resumes spawned agents, starts HTTP, shuts down on SIGTERM / SIGINT |
| [node.ts](node.ts) | Wires the real chain, the embedded `AgentRuntime`, the key store, the seller loop and the HTTP app |
| [app.ts](app.ts) | Fastify app factory: routes, CORS, rate limits, error shape, security headers |
| [spawner.ts](spawner.ts) | "Spawn your agent": validation, caps, keys stored before any transaction, provisioning, resume |
| [store.ts](store.ts) | Key file for spawned agents (mode 0600), with retired and other-deployment files kept aside |
| [activity.ts](activity.ts) | Bounded activity ring buffer and the SSE fan-out |
| [seller-loop.ts](seller-loop.ts) | Keeps one offer open: posts a new one when no pool is joinable |
| [settings.ts](settings.ts) | Settings from env, validated once at boot |
| [demo.ts](demo.ts) | `make demo`: sandbox, this server, scripted agents and the env file for the web dev server |

## Decisions and tradeoffs

- **Side effects arrive through ports.** `app.ts` and `spawner.ts` receive the chain, runtime and store as interfaces, so the route tests run with fakes and no chain.
- **Keys are written before money moves.** A spawn generates the agent's keys and saves them before the first transaction; if the save fails nothing is spent, and if a transaction fails the keys move to `agents.json.retired`.
- **One spawn at a time.** All provisioning signs with the single operator key, so spawns are serialised to avoid nonce clashes.

## Logic map

- To find the spawn flow and its caps visit [spawner.ts](spawner.ts) (`spawn`).
- To find the routes visit [app.ts](app.ts).
- To find the live feed visit [activity.ts](activity.ts).
- The key store can be found in [store.ts](store.ts).
- The chain connection and the embedded runtime can be found in [node.ts](node.ts).
