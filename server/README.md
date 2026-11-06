# @coop/server

Fastify API for Co-op. It embeds the `@coop/agents` runtime (policy engine, joins, leaves, settler), keeps the activity feed for the dashboard, runs rooms (a pool with a purpose and a join code), and runs visitors' agents: funded from their own wallet, or, as a demo fallback, by the operator.

The web app works without it (state comes straight from RPC views); the server adds the feed, tx hashes and spawning.

```bash
pnpm --filter @coop/server dev     # tsx watch
pnpm --filter @coop/server start
pnpm --filter @coop/server check   # tsc + route tests (no chain needed)
pnpm --filter @coop/server test:integration   # one real near-sandbox
make demo                          # sandbox + this server + scripted agents + web dev server
```

## Routes (docs/SPEC.md 3.1)

| Route | Notes |
|---|---|
| `GET /api/health` | `{ ok, network, contractId, llm }` |
| `GET /api/config` | network, rpcUrl, contractId, tokenId, explorer bases, `spawn { enabled, maxBudgetNear, remaining }`, `rooms { canCreate, durationsMin, catalog }`, `walletSpawn { maxBatch, agentGasYocto }` |
| `GET /api/rooms` | the 60 newest rooms; `code` is null for invite rooms (older rooms still open by code) |
| `GET /api/rooms/:code` | one room, by code |
| `POST /api/rooms` | `{ item, purpose, duration_min, host }` -> the room with its code; the demo seller opens its pool |
| `POST /api/wallet-agents/prepare` | `{ owner, room_code, name, count, brief, total_near }` -> per-agent public join/leave keys, limits, budget and gas amounts for the wallet transactions |
| `POST /api/wallet-agents/activate` | `{ owner, agent_ids }` -> `running`, `waiting` or `rejected` per agent; a 15 s sweep does the same for closed tabs |
| `GET /api/activity?pool_id=&limit=` | newest first, ring buffer of the last 2000 entries |
| `GET /api/stream` | SSE, one `ActivityEntry` per `data:` line, `: heartbeat` every 15 s, replays nothing |
| `GET /api/agents` | spawned agents (never keys) |
| `POST /api/agents` | `{ name, brief, budget_near, room_code? }` -> `{ agent_id, policy, parser, txs }` (server-paid demo spawn) |

`POST /api/agents` errors are `{ error, field? }`: 400 validation (name `^[a-z0-9][a-z0-9-]*[a-z0-9]$`, 2-24 chars; brief 3-200 chars; `0 < budget_near <= SPAWN_MAX_BUDGET_NEAR`, at most 6 decimals; the budget must also cover `units x price limit` of the parsed brief), 409 name taken, 429 per-IP limit (with `Retry-After`), 502 chain failure, 503 spawning disabled (no operator key, `SPAWN_MAX_AGENTS` reached, operator balance below the floor, or the key file cannot be written).

Spawning creates `<name>.<operator>` with a function-call key limited to `join_pool` / `leave_pool` on the Co-op contract, calls `register_agent` with limits from the parsed policy and the budget, and adds the agent to the running runtime, which joins it to the open pool.

## Environment

Loaded from the repo-root `.env`; with `NEAR_NETWORK=sandbox`, or when no network is set and `.sandbox/env` exists, that file too.

| Variable | Default | |
|---|---|---|
| `NEAR_NETWORK`, `NEAR_RPC_URL`, `COOP_CONTRACT_ID`, `CREDITS_TOKEN_ID` | | chain (see `.env.example`) |
| `GPU_HOURS_TOKEN_ID`, `DATASET_SEATS_TOKEN_ID` | | optional extra room items (`pnpm --filter @coop/agents deploy:items`); each one adds a catalog entry and its own always-open public room |
| `OPERATOR_ACCOUNT_ID`, `OPERATOR_PRIVATE_KEY` | | owns spawned agents, settles, sells. Without the key the server runs read-only and spawning answers 503 |
| `PORT`, `HOST` | `8787`, `0.0.0.0` | |
| `CORS_ORIGIN` | `*` | comma-separated origins |
| `TRUST_PROXY` | `0` | `1` behind a proxy you control, so per-IP limits see the real client IP |
| `SPAWN_MAX_AGENTS` | `40` | total spawned agents (including resumed ones) |
| `SPAWN_MAX_BUDGET_NEAR` | `2` | per agent |
| `SPAWN_PER_IP_PER_HOUR` | `3` | spawn attempts that reach provisioning |
| `SPAWN_GAS_NEAR` | `0.12` | left on the agent account for join/leave gas (also what a wallet-spawned agent account receives; a `join_pool` prepays about 0.051) |
| `SPAWN_MIN_OPERATOR_NEAR` | `1` | spawning pauses if the operator would drop below this |
| `RATE_LIMIT_PER_MIN` | `60` | general, per IP (the SSE stream is exempt, capped by `MAX_SSE_CLIENTS`=500) |
| `SETTLER` | `1` | the operator settles expired pools |
| `SELLER_LOOP` | `1` on sandbox, `0` on testnet | opens a new offer whenever no pool is Open |
| `PRICE_SCALE` | `1` sandbox, `0.05` testnet | entry price in NEAR; tiers are `[1: 100%, 20: 70%, 50: 50%]` |
| `OFFER_DURATION_SEC`, `OFFER_LOCK_SEC` | `100`/`20` sandbox, `600`/`60` testnet | length of the seller loop's public rooms; the hosted server uses `10800` (3 h) because every empty pool still costs the seller storage |
| `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL` | | optional; otherwise the rules parser answers and `parser` says `"rules"` |
| `DATA_FILE` | `server/.data/agents.json` | rooms are kept in `rooms.json` next to it |

## Spawned-agent keys

`server/.data/agents.json` holds the **private keys** of every spawned agent (the function-call key and the account's full-access key). It is written with mode 0600 in a 0700 directory, is git-ignored (`server/.gitignore`) and **must never be committed or shared**. A restart reads it to resume the agents; agents the chain no longer knows move to `agents.json.retired`, a file for a different contract is set aside as `agents.json.<time>.other`. Keys are never returned by any endpoint. Treat these accounts as demo money: they hold a few tenths of a NEAR plus delivered demo vouchers.

## Security notes

- The operator key comes only from the environment and is never logged or returned.
- Caps stack: per-IP spawn limit, `SPAWN_MAX_AGENTS`, per-agent budget cap, operator floor checked before provisioning, and one spawn at a time (single operator nonce).
- Request bodies are limited to 4 KB; every input is validated with zod; responses carry `nosniff`, `no-referrer`, `frame-ancestors 'none'` and `no-store`.
- `make demo` uses the public near-sandbox key: worthless outside your machine.
- Keys first: a spawn generates the agent's keys and saves them before its first transaction. If the key file cannot be written, the spawn stops with 503 and nothing is spent.
- Partial failure: if account creation succeeds and registration fails, the name stays taken on chain (409 afterwards); pick another name. The account's keys are kept in `agents.json.retired`.

## Docker image and hosting

[`Dockerfile`](Dockerfile) builds the server image from the repo root (`docker build -f server/Dockerfile -t coop-server .`). It runs as the non-root `node` user on port 8787 and keeps spawned agents' keys in `/data/agents.json` (`DATA_FILE`), which belongs on a Docker volume so it survives restarts.

The hosted setup (an always-on Google Cloud free-tier VM with Caddy for HTTPS, the site on Vercel) is described step by step in [deploy/README.md](../deploy/README.md). The image was built and run against a local sandbox; the VM itself has not been tested from here.
