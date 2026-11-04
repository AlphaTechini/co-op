# web/src/lib/components

Svelte 5 components. They take computed models as props and hold no chain logic; that lives in `../` and `../stores/`.

| Component | Shows |
|---|---|
| [TierLadder.svelte](TierLadder.svelte) | The vertical price ladder with the projected-price marker (pool page centrepiece) |
| [TierBar.svelte](TierBar.svelte) | Compact tier bar used in pool rows |
| [PoolHead.svelte](PoolHead.svelte) | Pool title, status and countdowns |
| [PoolFacts.svelte](PoolFacts.svelte) | Pool figures: units, members, projected price |
| [PoolRow.svelte](PoolRow.svelte) | One pool in the home list, linking to its page |
| [PoolSkeleton.svelte](PoolSkeleton.svelte) | Loading placeholder for the pool page |
| [MemberList.svelte](MemberList.svelte) | Members in join order, grouped, with their state |
| [ReceiptView.svelte](ReceiptView.svelte) | The settled-pool receipt |
| [Ledger.svelte](Ledger.svelte) | Per-agent receipt table: paid against limit, refunds, transaction chips |
| [ActivityFeed.svelte](ActivityFeed.svelte), [FeedEntry.svelte](FeedEntry.svelte) | Live feed and one entry |
| [Countdown.svelte](Countdown.svelte) | Time left to lock or deadline |
| [StatusPill.svelte](StatusPill.svelte) | Pool or member status label |
| [TxChip.svelte](TxChip.svelte), [AccountLink.svelte](AccountLink.svelte) | Transaction hash and account, linked to the explorer when there is one |
| [Banner.svelte](Banner.svelte), [RpcBanner.svelte](RpcBanner.svelte), [EmptyState.svelte](EmptyState.svelte), [Toasts.svelte](Toasts.svelte) | Notices, the RPC retry banner, empty states, toasts |
| [SiteHeader.svelte](SiteHeader.svelte), [SiteFooter.svelte](SiteFooter.svelte), [Logo.svelte](Logo.svelte) | Page chrome |
| [Icon.svelte](Icon.svelte), [Sprite.svelte](Sprite.svelte) | Icons from the inlined sprite |

- To find the ladder geometry these components render visit [../ladder.ts](../ladder.ts).
- To find the component specs visit [../../../../design/DESIGN.md](../../../../design/DESIGN.md) (section 7).
