# web/src

| Path | Purpose |
|---|---|
| [routes/](routes/README.md) | Pages: home, pool, spawn, how it works |
| [lib/](lib/README.md) | Components, stores, styles and the pure logic behind them |
| [env.ts](env.ts) | Declares the four `PUBLIC_*` build-time variables (SvelteKit 3 explicit env) |
| [app.html](app.html) | HTML shell |
| [app.d.ts](app.d.ts) | App-level type declarations |

- To find how build-time config and the optional server config are combined visit [lib/config.svelte.ts](lib/config.svelte.ts).
- The NEAR RPC connection can be found in [lib/rpc.svelte.ts](lib/rpc.svelte.ts).
