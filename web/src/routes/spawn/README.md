# web/src/routes/spawn

- [+page.svelte](+page.svelte): "Spawn agents". With a room code it offers two modes: **My wallet** (the default, [WalletSpawn.svelte](../../lib/components/WalletSpawn.svelte): N agents, one brief, a total split evenly and capped at the wallet's spendable balance, one wallet approval) and **Demo, server pays** (the original single-agent form, `POST /api/agents`, now limited to the room). Without a code it shows a room picker; the demo form still works without one.

To find the preview parser visit [../../lib/brief.ts](../../lib/brief.ts); the server side can be found in [../../../../server/src/spawner.ts](../../../../server/src/spawner.ts) and [../../../../server/src/wallet-spawn.ts](../../../../server/src/wallet-spawn.ts).
