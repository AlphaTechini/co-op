<script lang="ts">
  import { config } from '#lib/config.svelte.ts';
  import type { PoolPage } from '#lib/stores/pool.svelte.ts';
  import Banner from './Banner.svelte';
  import FeedEntry from './FeedEntry.svelte';
  import Icon from './Icon.svelte';

  let { store, all = false }: { store: PoolPage; all?: boolean } = $props();

  const items = $derived(store.feedItems);
  const shown = $derived(all ? items : items.slice(0, store.visible));
  const canMore = $derived(!all && (items.length > store.visible || store.activityHasMore));
</script>

<div>
  <div class="card__head">
    <h2 id="feed-title" class="card__title">Activity</h2>
    <span class="live-dot" data-state={store.live ? undefined : 'paused'}>{store.live ? 'Live' : 'Paused'}</span>
  </div>

  {#if config.server === 'down'}
    <div style="padding: var(--space-4) var(--space-5) 0">
      <Banner kind="negative" icon="alert" title="Activity feed offline" role="alert">
        Pool state still comes from RPC. Tx links will return with the server.
        {#snippet actions()}<button class="btn btn--ghost btn--sm" type="button" onclick={() => store.retryServer()}>Retry</button>{/snippet}
      </Banner>
    </div>
  {/if}

  {#if store.loadingFeed}
    <div class="card__body" style="display:grid;gap:var(--space-5)" aria-busy="true" aria-label="Loading activity">
      {#each [0, 1, 2, 3] as i (i)}
        <div style="display:grid;grid-template-columns:24px 1fr;gap:var(--space-4);align-items:start"><span class="skeleton skeleton--circle" style="block-size:24px"></span><div style="display:grid;gap:8px"><span class="skeleton" style="inline-size:{90 - i * 8}%"></span><span class="skeleton" style="inline-size:40%"></span></div></div>
      {/each}
    </div>
  {:else if items.length === 0}
    <div class="empty" style="padding-block:var(--space-8)"><p class="empty__body">Nothing has happened in this pool yet.</p></div>
  {:else}
    <div class={all ? '' : 'feed-scroll'}>
      <ol class="feed" aria-live={store.feedReady ? 'polite' : undefined} aria-relevant="additions" aria-label="Pool activity, newest first">
        {#each shown as it (it.key)}
          <FeedEntry item={it} fresh={store.newKeys.has(it.key)} />
        {/each}
      </ol>
    </div>
  {/if}

  <div class="card__foot" style="display:flex;justify-content:space-between;align-items:center;gap:var(--space-4);flex-wrap:wrap">
    <span>
      {#if store.feedMode === 'chain'}
        <span style="display:inline-flex;gap:6px;align-items:start"><Icon name="info" size="sm" /><span>{config.server === 'none' ? 'Read from the chain. Tx links and agent reasons need the Co-op server.' : 'Read from the chain while the server is offline.'}</span></span>
      {:else}
        Showing {shown.length} of {items.length}{store.activityHasMore ? '+' : ''}
      {/if}
    </span>
    {#if canMore}<button class="btn btn--ghost btn--sm" type="button" onclick={() => store.showEarlier()}>Show earlier</button>{/if}
  </div>
</div>
