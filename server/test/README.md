# server/test

| Suite | Config | Needs | Command |
|---|---|---|---|
| [unit/](unit/README.md) | [../vitest.config.ts](../vitest.config.ts) | nothing (fakes for chain, runtime, store) | `pnpm --filter @coop/server test` |
| [integration/](integration/README.md) | [../vitest.integration.config.ts](../vitest.integration.config.ts) | Linux or Apple Silicon macOS (near-sandbox) | `pnpm --filter @coop/server test:integration` |

- To find the fakes the unit tests use visit [unit/helpers.ts](unit/helpers.ts).
- The two file-permission tests in `unit/store.test.ts` check POSIX mode `0600` and fail on Windows, which has no such modes.
