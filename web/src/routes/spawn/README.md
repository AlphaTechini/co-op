# web/src/routes/spawn

- [+page.svelte](+page.svelte): "Spawn your agent". Takes a name, a brief and a budget, previews the parsed policy, checks the budget covers the units at the maximum price, then calls `POST /api/agents` and shows the resulting transactions.

To find the preview parser visit [../../lib/brief.ts](../../lib/brief.ts); the server side can be found in [../../../../server/src/spawner.ts](../../../../server/src/spawner.ts).
