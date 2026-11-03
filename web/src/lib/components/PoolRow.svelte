<script lang="ts">
  import { dayCaption, fmtClock, fmtCountdown, formatNear, nsToMs, plural } from '#lib/format.ts';
  import { miniBar } from '#lib/ladder.ts';
  import type { PoolView } from '#lib/models.ts';
  import { effectiveStatus } from '#lib/status.ts';
  import { clock } from '#lib/stores/clock.svelte.ts';
  import Icon from './Icon.svelte';
  import StatusPill from './StatusPill.svelte';
  import TierBar from './TierBar.svelte';

  let { pool }: { pool: PoolView } = $props();

  const status = $derived(effectiveStatus(pool, clock.now));
  const bar = $derived(miniBar(pool));
  const final = $derived(pool.status === 'Settled' || pool.status === 'Refunded');
  const proj = $derived(pool.result ?? pool.projected);
  const priceText = $derived(proj.unit_price && pool.status !== 'Refunded' ? formatNear(proj.unit_price) : null);
  const priceCaption = $derived(
    priceText === null ? (pool.status === 'Refunded' ? 'no tier reached' : 'no tier yet') : final ? 'final' : 'projected'
  );

  const time = $derived.by(() => {
    const now = clock.now;
    if (pool.status === 'Settled' || pool.status === 'Refunded') {
      const at = pool.result ? nsToMs(pool.result.resolved_at_ns) : 0;
      return at ? { value: fmtClock(at), caption: dayCaption(at, now) } : { value: 'Done', caption: '' };
    }
    if (status === 'Settling') return { value: `${pool.settle_cursor}/${pool.member_count}`, caption: 'settling' };
    if (status === 'Expired') return { value: 'due', caption: 'to settle' };
    if (status === 'Locked') return { value: fmtCountdown(nsToMs(pool.offer.deadline_ns) - now), caption: 'to settle' };
    if (status === 'AwaitingInventory') return { value: 'Not open', caption: 'no inventory' };
    return { value: fmtCountdown(nsToMs(pool.offer.lock_at_ns) - now), caption: 'to lock' };
  });
</script>

<a class="pool-row" href="/pool?id={pool.id}">
  <span class="pool-row__id">#{pool.id}</span>
  <span class="pool-row__main">
    <span class="pool-row__title" title={pool.offer.title}>{pool.offer.title}</span>
    <span class="pool-row__sub">{plural(pool.offer.tiers.length, 'tier')} · max {plural(pool.offer.max_units, 'unit')}</span>
  </span>
  <span class="pool-row__status"><StatusPill {status} cursor={pool.settle_cursor} count={pool.member_count} /></span>
  <TierBar {bar} />
  <span class="pool-row__price">
    <span class="num-m" class:text-tertiary={priceText === null}>{priceText ?? 'None'}</span>
    <small>{priceCaption}</small>
  </span>
  <span class="pool-row__members">{pool.member_count}<small>{pool.member_count === 1 ? 'agent' : 'agents'}</small></span>
  <span class="pool-row__time">{time.value}<small>{time.caption}</small></span>
  <Icon name="chevron-right" class="pool-row__chev" />
</a>
