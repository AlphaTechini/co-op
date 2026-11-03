<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fmtClock, fmtDate, nsToMs } from '#lib/format.ts';
  import type { PoolStatus, PoolView } from '#lib/models.ts';
  import AccountLink from './AccountLink.svelte';
  import Countdown from './Countdown.svelte';
  import Icon from './Icon.svelte';
  import StatusPill from './StatusPill.svelte';

  let { pool, status, children }: { pool: PoolView; status: PoolStatus; children?: Snippet } = $props();

  const final = $derived(status === 'Settled' || status === 'Refunded');
  const held = $derived.by(() => {
    const unit = BigInt(pool.offer.unit_amount);
    return unit > 0n ? (BigInt(pool.offer.inventory_held) / unit).toString() : '0';
  });
  const at = $derived(pool.result ? nsToMs(pool.result.resolved_at_ns) : null);
</script>

<header class="page-head" style={final ? 'margin-block-end: var(--space-6)' : ''}>
  <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Pools</a><Icon name="chevron-right" size="xs" /><span aria-current="page">#{pool.id}</span></nav>
  <div class="page-head__row">
    <div style="display:grid;gap:var(--space-4)">
      <div class="page-head__title">
        <h1 class="t-display-l">{pool.offer.title}</h1>
        <StatusPill {status} cursor={pool.settle_cursor} count={pool.member_count} large />
      </div>
      <div class="page-head__meta">
        <span><Icon name="store" /><AccountLink id={pool.offer.seller} /></span>
        <span><Icon name="package" /><AccountLink id={pool.offer.item_token} /></span>
        {#if final && at}
          <span><Icon name="clock" />{status === 'Refunded' ? 'Refunded' : 'Settled'} {fmtDate(at)}, {fmtClock(at)} UTC</span>
        {:else}
          <span><Icon name="layers" />{held} {held === '1' ? 'unit' : 'units'} held in escrow</span>
        {/if}
      </div>
    </div>
    {#if !final}<Countdown {pool} {status} />{/if}
    {@render children?.()}
  </div>
</header>
