# web/src/lib/stores

Svelte 5 rune-based state shared across pages.

| File | Purpose |
|---|---|
| [pool.svelte.ts](pool.svelte.ts) | Pool page state: chain polled every ~2 s, the activity feed (server when reachable, otherwise derived from chain snapshots) |
| [overview.svelte.ts](overview.svelte.ts) | Home page state: pool list and the last settled pool's proof |
| [poller.svelte.ts](poller.svelte.ts) | Polling with backoff, used by both page stores |
| [registry.ts](registry.ts) | Lets the RPC banner retry every active poller at once |
| [clock.svelte.ts](clock.svelte.ts) | One app-wide clock for countdowns |
| [theme.svelte.ts](theme.svelte.ts) | Light / dark theme |
| [toasts.svelte.ts](toasts.svelte.ts) | Toast queue |

## Decisions and tradeoffs

- **Polling, not subscriptions.** NEAR RPC has no push for contract state, so pages poll views; one shared clock and registry keep timers and retries in one place.
- **The feed falls back to the chain.** When the server is unreachable, feed entries are derived from successive chain snapshots, so the pool page still shows joins and settlement.

- To find the polling rules visit [poller.svelte.ts](poller.svelte.ts).
