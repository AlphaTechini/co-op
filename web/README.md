# @coop/web

The Co-op dashboard: SvelteKit 3 with Svelte 5, prerendered and deployed on Vercel (`@sveltejs/adapter-vercel`).

```bash
pnpm --filter @coop/web dev      # Vite dev server (make demo starts it against a sandbox)
pnpm --filter @coop/web check    # svelte-check
pnpm --filter @coop/web test     # unit tests for the pure modules
pnpm --filter @coop/web build    # production build into .vercel/output
```

Build-time settings (`PUBLIC_NETWORK`, `PUBLIC_RPC_URL`, `PUBLIC_COOP_CONTRACT_ID`, `PUBLIC_API_URL`) are read from the repo-root `.env` or the environment ([.env.example](.env.example), [src/env.ts](src/env.ts)). Hosting steps are in [../deploy/README.md](../deploy/README.md).

## Decisions and tradeoffs

- **The chain is the source of truth.** Pools, members and receipts are read straight from NEAR RPC view calls, so the site works read-only without the server; the server only adds the live feed, transaction hashes and spawning.
- **No near-api-js in the browser.** The dashboard only makes view calls, so a small JSON-RPC client ([src/lib/rpc.svelte.ts](src/lib/rpc.svelte.ts)) replaces the full SDK.
- **The resolver is mirrored client-side** ([src/lib/settlement.ts](src/lib/settlement.ts)) to show "what if" projections; the contract result always wins.
- **Prerendered, no server rendering** (`ssr = false`, `prerender = true`): every page is a static file; one small Vercel function only handles unknown paths.
- [vite.config.ts](vite.config.ts) holds the SvelteKit config (SvelteKit 3 reads it from the plugin call).

## Folders

- The source can be found in [src/](src/README.md).
- Static files served as-is can be found in [static/](static/README.md).
