# web/src/routes/pool

- [+page.svelte](+page.svelte): one pool, chosen by `?id=N`. While open it shows the tier ladder, countdowns, members and the live feed; once settled or refunded it becomes the settlement receipt.

To find the state behind it visit [../../lib/stores/pool.svelte.ts](../../lib/stores/pool.svelte.ts); the receipt figures can be found in [../../lib/proof.ts](../../lib/proof.ts).
