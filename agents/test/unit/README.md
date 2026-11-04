# agents/test/unit

Fast tests with no chain. Run with `pnpm --filter @coop/agents test` (also part of `make check`).

| File | What it covers |
|---|---|
| [brief.test.ts](brief.test.ts) | Rules parser cases; LLM output must pass the schema; fallback to rules on error; no fake LLM when unconfigured |
| [money.test.ts](money.test.ts) | Exact yoctoNEAR parsing and formatting |
| [policy.test.ts](policy.test.ts) | Join, wait and leave decisions per archetype against tier ladders |
| [roster.test.ts](roster.test.ts) | The demo cast reaches the 20-unit tier but not the 50-unit one; every budget covers its maximum lock |
| [runtime.test.ts](runtime.test.ts) | The runtime offline: failing agents become error entries with a retry cooldown; decisions are logged once per change |

- To find the code under test visit [../../src/](../../src/README.md).
