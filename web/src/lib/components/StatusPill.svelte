<script lang="ts">
  import type { PoolStatus } from '#lib/models.ts';
  import Icon from './Icon.svelte';

  let { status, cursor = 0, count = 0, large = false }: { status: PoolStatus; cursor?: number; count?: number; large?: boolean } = $props();

  const cls = $derived(
    { AwaitingInventory: 'awaiting', Open: 'open', Locked: 'locked', Expired: 'expired', Settling: 'settling', Settled: 'settled', Refunded: 'refunded' }[status]
  );
  const label = $derived(
    status === 'AwaitingInventory'
      ? 'Awaiting inventory'
      : status === 'Expired'
        ? 'Awaiting settlement'
        : status === 'Settling'
          ? `Settling ${cursor} of ${count}`
          : status
  );
  const icon = $derived(
    ({ AwaitingInventory: 'package', Locked: 'lock', Expired: 'hourglass', Settled: 'check', Refunded: 'undo' } as Record<string, string>)[status]
  );
</script>

<span class="pill pill--{cls}" class:pill--lg={large}>
  {#if status === 'Open'}<span class="pill__dot"></span>
  {:else if status === 'Settling'}<span class="spinner" style="inline-size:10px;block-size:10px"></span>
  {:else if icon}<Icon name={icon} size="xs" />{/if}{label}
</span>
