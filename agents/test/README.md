# agents/test

Two suites with separate configs:

| Suite | Config | Needs | Command |
|---|---|---|---|
| [unit/](unit/README.md) | [../vitest.config.ts](../vitest.config.ts) | nothing | `pnpm --filter @coop/agents test` |
| [integration/](integration/README.md) | [../vitest.integration.config.ts](../vitest.integration.config.ts) | Linux or Apple Silicon macOS (near-sandbox) | `make test-integration` |

## Decisions and tradeoffs

- **Integration tests use a real node.** Each file boots its own near-sandbox and runs real transactions, so they prove protocol behaviour (key permissions, gas, receipts) that a mock could not. The cost is time: about a minute per file.
- **Files run one after another** (`fileParallelism: false`), so sandboxes never compete for ports or CPU.
- To find the shared integration setup visit [integration/fixture.ts](integration/fixture.ts).
