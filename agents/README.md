# @coop/agents

The off-chain side of Co-op: a typed client for the contract, the deterministic buying policy, the agent runtime that joins and leaves pools, the seller and settler, a local sandbox harness, and the scenario runner behind `make verify`.

```bash
pnpm --filter @coop/agents check               # tsc + unit tests (no chain)
pnpm --filter @coop/agents test:integration    # one real near-sandbox per test file
pnpm --filter @coop/agents scenario --agents 10 --network sandbox
pnpm --filter @coop/agents deploy:testnet      # needs the operator in .env
```

## Decisions and tradeoffs

- **Decisions are deterministic.** Every join, leave and skip comes from [src/policy.ts](src/policy.ts), from structured limits. An LLM can only turn a free-text brief into those limits ([src/brief.ts](src/brief.ts)), and the rules parser is the default. Runs are reproducible; the cost is that agents cannot reason beyond their policy.
- **Agents hold function-call keys only.** The runtime signs with a key limited to `join_pool` / `leave_pool` and zero deposit, so a leaked agent key cannot move money ([src/chain.ts](src/chain.ts), `addFunctionCallKey`).
- **TypeScript runs directly through `tsx`.** There is no build step; the server and the checks import these sources as `@coop/agents/*` (see `exports` in [package.json](package.json)).
- **One pinned sandbox version.** near-sandbox 0.3.4 defaults to nearcore 2.13.4, which cannot run the near-sdk 5.30 wasm, so [src/sandbox.ts](src/sandbox.ts) always starts 2.14.0.
- **Bounded sandbox shutdown.** neard sometimes hangs in its own shutdown and near-sandbox waits for it without a limit. The harness kills it after 3 s (the sandbox's data is deleted right after anyway) and stops waiting 5 s later, so `make verify` and the tests always return.
- **Runs on Linux and Apple Silicon macOS.** near-sandbox has no Windows or Intel-mac build; on Windows, use WSL.

## Folders

- The source can be found in [src/](src/README.md).
- The tests can be found in [test/](test/README.md).

## Logic map

- To find how an agent decides to join, wait or leave visit [src/policy.ts](src/policy.ts).
- To find the polling loop that acts on those decisions visit [src/runtime.ts](src/runtime.ts).
- To find the `make verify` scenario and its receipt visit [src/scenario.ts](src/scenario.ts) and [src/receipt.ts](src/receipt.ts).
- To find the invariant checks recomputed from chain views visit [src/verify.ts](src/verify.ts).
- The contract client (views and transactions) can be found in [src/chain.ts](src/chain.ts).
- The local sandbox connection can be found in [src/sandbox.ts](src/sandbox.ts).
