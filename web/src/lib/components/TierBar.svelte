<script lang="ts">
  import type { MiniBar } from '#lib/ladder.ts';

  let { bar, thick = false, wide = false }: { bar: MiniBar; thick?: boolean; wide?: boolean } = $props();
</script>

<span class="tierbar" style="--n:{bar.n};{wide ? 'inline-size:min(100%,320px)' : ''}">
  <span class="tierbar__labels" style="grid-template-columns:1fr auto">
    <span>{bar.inUnits} of {bar.max} units</span>
    <span class="text-conditional">{#if bar.pending > 0}+{bar.pending} waiting{/if}</span>
  </span>
  <span class="tierbar__track" style={thick ? 'block-size:8px' : ''}>
    {#each bar.segs as s, i (i)}
      <span class="tierbar__seg" style="--in:{s.in.toFixed(3)};--pend:{s.pend.toFixed(3)};--seg-color:{s.color}"></span>
    {/each}
  </span>
  <span class="tierbar__labels">
    {#each bar.labels as l, i (i)}<span data-current={l.current ? '' : undefined}>{l.text}</span>{/each}
  </span>
</span>
