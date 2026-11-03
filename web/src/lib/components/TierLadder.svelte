<script lang="ts">
  import { plural } from '#lib/format.ts';
  import type { LadderModel } from '#lib/ladder.ts';
  import Icon from './Icon.svelte';

  let {
    model,
    refunded = false,
    priceTick = 0,
    justReached = null,
    headingId = 'ladder-title'
  }: { model: LadderModel; refunded?: boolean; priceTick?: number; justReached?: number | null; headingId?: string } = $props();

  const s = $derived(model.summary);
  const agents = (n: number) => plural(n, 'agent');
</script>

<div class="card__body ladder">
  <div class="ladder__price">
    <h2 id={headingId} class="t-eyebrow">{model.final || refunded ? 'Final price' : 'Projected price'}</h2>
    <div class="ladder__price-row">
      {#key priceTick}
        <span
          class="num-hero ladder__price-value"
          class:text-tertiary={model.priceText === null}
          aria-live="polite"
          aria-atomic="true"
          data-changed={priceTick > 0 ? '' : undefined}>{model.priceText ?? 'None'}</span>
      {/key}
      <span class="unit" style="font-size:var(--fs-body)">{model.priceText === null ? (refunded ? 'no tier reached' : 'no tier yet') : 'NEAR per unit'}</span>
    </div>
    <p class="ladder__summary">
      {#if s.v === 'settled'}
        Tier {s.tierNo} of {s.tierCount}, reached with <b>{plural(s.units, 'unit')}</b>. Every agent paid the same price{s.pctText}.
      {:else if s.v === 'refunded'}
        The group reached <b>{plural(s.units, 'unit')}</b>, short of the first tier at {s.min}. Everyone was refunded in full.
      {:else if s.v === 'frozen'}
        Membership is frozen.{#if s.priceText} The group settles at <b>{s.priceText}</b> with <b>{plural(s.units, 'unit')}</b>.{:else} The group is below the first tier, so everyone will be refunded.{/if}
      {:else if s.v === 'notier'}
        <b>{plural(s.pledged, 'unit')}</b> pledged.
        {#if s.away !== null}<b>{s.away} more</b> reach the first tier at <b>{s.priceText}</b>.{:else}The first tier is not reachable with current capacity.{/if}
        If the group stays below {s.min}, everyone is refunded.
      {:else if s.v === 'best'}
        <b>{plural(s.units, 'unit')}</b> in the group from {agents(s.membersIn)}. This is the best tier.
      {:else if s.v === 'bringsin'}
        <b>{plural(s.units, 'unit')}</b> in the group from {agents(s.membersIn)}. <b>{s.away} more pledged {s.away === 1 ? 'unit' : 'units'}</b> bring in {plural(s.k, 'waiting agent')} and drop the price to <b>{s.nextText}</b>.
      {:else if s.v === 'more'}
        <b>{plural(s.units, 'unit')}</b> in the group from {agents(s.membersIn)}. <b>{s.away} more {s.away === 1 ? 'unit' : 'units'}</b> drop the price to <b>{s.nextText}</b>.
      {:else}
        <b>{plural(s.units, 'unit')}</b> in the group from {agents(s.membersIn)}. The next tier is not reachable with current capacity.
      {/if}
    </p>
  </div>

  <div class="ladder__body" style="--n:{model.segs.length}" role="img" aria-label={model.ariaLabel}>
    <div class="ladder__rail">
      {#each model.segs as seg, i (i)}
        <span class="ladder__seg" style="--in:{seg.in.toFixed(4)};--pend:{seg.pend.toFixed(4)};--seg-color:{seg.color}"></span>
      {/each}
    </div>
    <div class="ladder__track-wrap">
      {#each model.notches as n, i (i)}<span class="ladder__notch" style="--at:{n.toFixed(2)}%"></span>{/each}
      <div class="ladder__marker" style="--pos:{model.pos.toFixed(2)}%">
        <span class="ladder__marker-label">{model.inUnits}<small>units</small></span>
        <span class="ladder__marker-arrow"></span>
        <span class="ladder__marker-line"></span>
      </div>
    </div>
    {#each model.rungs as r (r.seg)}
      <div class="rung" style="grid-row:{r.seg + 1}" data-state={r.state} data-just-reached={justReached !== null && justReached === r.tier && r.state === 'current' ? '' : undefined}>
        <div class="rung__top">
          <span class="rung__price">{r.priceText}{#if r.kind === 'tier'}<span class="unit">NEAR</span>{/if}</span>
          {#if r.delta}<span class="rung__delta">{r.delta}</span>{/if}
        </div>
        <span class="rung__from">{r.fromText}</span>
        {#if r.state === 'passed'}
          <span class="rung__status"><Icon name="check" size="sm" />Passed</span>
        {:else if r.state === 'current'}
          <span class="rung__status"><Icon name="check-circle" size="sm" />{r.statusText}</span>
        {:else if r.state === 'below-min'}
          <span class="rung__status">{r.statusText}</span>
        {:else if r.state === 'ahead'}
          {#if r.waiting}<span class="rung__status rung__status--waiting"><Icon name="dashed" size="sm" />{plural(r.waiting.agents, 'agent')} waiting, {plural(r.waiting.units, 'unit')}</span>{/if}
          {#if r.away?.kind === 'away'}<span class="rung__status">{plural(r.away.units, 'pledged unit')} away</span>
          {:else if r.away?.kind === 'unreachable'}<span class="rung__status">Not reachable with current capacity</span>{/if}
        {/if}
      </div>
    {/each}
  </div>

  <table class="visually-hidden">
    <caption>Price tiers</caption>
    <thead><tr><th scope="col">Tier</th><th scope="col">Price in NEAR per unit</th><th scope="col">From units</th><th scope="col">State</th></tr></thead>
    <tbody>
      {#each model.rungs.filter((r) => r.kind === 'tier') as r (r.seg)}
        <tr><th scope="row">{r.tier + 1}</th><td>{r.priceText}</td><td>{r.minUnits}</td><td>{r.state === 'ahead' ? 'next' : r.state}</td></tr>
      {/each}
    </tbody>
  </table>

  <div class="ladder__legend">
    <span class="swatch" style="--sw:var(--tier-5)">In the group</span>
    <span class="swatch swatch--pending">Conditional</span>
    <span class="swatch swatch--open">Open</span>
  </div>
</div>
