<script lang="ts">
  import { fmtClock } from '#lib/format.ts';
  import { FEED_ICON, type FeedItem } from '#lib/feed.ts';
  import Icon from './Icon.svelte';
  import TxChip from './TxChip.svelte';

  let { item, fresh = false }: { item: FeedItem; fresh?: boolean } = $props();
  const iso = $derived(new Date(item.ts).toISOString());
</script>

<li class="feed-entry" data-kind={item.kind} data-new={fresh ? '' : undefined}>
  <span class="feed-entry__icon"><Icon name={FEED_ICON[item.kind]} /></span>
  <div class="feed-entry__body">
    <p class="feed-entry__msg">
      {#each item.parts as p, i (i)}{#if p.t === 'agent'}<b class="agent" title={p.title}>{p.v}</b>{:else if p.t === 'b'}<b>{p.v}</b>{:else}{p.v}{/if}{/each}
    </p>
    {#if item.reason}<p class="feed-entry__reason">{item.reason}</p>{/if}
    <div class="feed-entry__meta">
      <time datetime={iso}>{fmtClock(item.ts, true)}</time>
      {#if item.tx}<TxChip hash={item.tx.hash} method={item.tx.method} explorerUrl={item.tx.explorer_url} />{/if}
    </div>
  </div>
</li>
