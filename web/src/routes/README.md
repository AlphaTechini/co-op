# web/src/routes

| Route | File | Page |
|---|---|---|
| `/` | [+page.svelte](+page.svelte) | Invariant statement and the list of open and finished pools |
| `/pool?id=N` | [pool/](pool/README.md) | One pool: ladder, members, live feed; becomes the receipt once settled |
| `/spawn` | [spawn/](spawn/README.md) | "Spawn your agent" |
| `/how` | [how/](how/README.md) | How it works, with a worked example |
| all | [+layout.svelte](+layout.svelte), [+layout.ts](+layout.ts) | Shared chrome; `ssr = false`, `prerender = true`, no trailing slash |

## Decisions and tradeoffs

- **The pool id is a query parameter** (`/pool?id=N`), so one prerendered page serves every pool and no server rendering is needed.
- To find the home page data visit [../lib/stores/overview.svelte.ts](../lib/stores/overview.svelte.ts).
