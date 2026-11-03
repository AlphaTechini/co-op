<script lang="ts">
  import { config } from '#lib/config.svelte.ts';
  import { fmtClock, formatNear, formatNearExact, plural } from '#lib/format.ts';
  import { ladderModel, miniBar } from '#lib/ladder.ts';
  import type { TxRef } from '#lib/models.ts';
  import { buildReceipt } from '#lib/proof.ts';
  import type { PoolPage } from '#lib/stores/pool.svelte.ts';
  import AccountLink from './AccountLink.svelte';
  import Banner from './Banner.svelte';
  import Icon from './Icon.svelte';
  import Ledger from './Ledger.svelte';
  import TierBar from './TierBar.svelte';
  import TxChip from './TxChip.svelte';

  let { store }: { store: PoolPage } = $props();

  const pool = $derived(store.pool!);
  const members = $derived(store.members);
  const refunded = $derived(pool.status === 'Refunded');
  const result = $derived(pool.result);
  const model = $derived(ladderModel(pool, members));
  const bar = $derived(miniBar(pool));
  const receipt = $derived.by(() => {
    try {
      return { r: buildReceipt(pool, members, store.agents), error: null as string | null };
    } catch (e) {
      return { r: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
  const r = $derived(receipt.r);

  const list = $derived(BigInt(pool.offer.tiers[0].unit_price));
  const price = $derived(result?.unit_price ? BigInt(result.unit_price) : null);
  const saved = $derived(price && r ? BigInt(result?.units ?? 0) * (list - price) : 0n);
  const unsold = $derived(pool.offer.max_units - (result?.units ?? 0));

  // transactions known to the server
  const entries = $derived(store.serverEntries);
  const joinTx = $derived.by(() => {
    const m = new Map<string, TxRef>();
    for (const e of [...entries].sort((a, b) => a.ts - b.ts)) {
      if (e.kind === 'pool_joined' && e.agent_id && e.tx && !m.has(e.agent_id)) m.set(e.agent_id, e.tx);
    }
    return m;
  });
  const settleTxs = $derived(
    entries.filter((e) => (e.kind === 'settle' || e.kind === 'pool_settled' || e.kind === 'pool_refunded') && e.tx).sort((a, b) => a.ts - b.ts)
  );
  const sellerTxs = $derived(entries.filter((e) => e.tx && (e.tx.method === 'seller_paid' || e.tx.method === 'ft_transfer')));
</script>

<div class="receipt-top">
  <section class="card" aria-labelledby="final-title">
    <div class="card__body" style="display:grid;gap:var(--space-6)">
      <div style="display:flex;justify-content:space-between;align-items:end;gap:var(--space-6);flex-wrap:wrap">
        <div class="ladder__price">
          <h2 id="final-title" class="t-eyebrow">Final price</h2>
          <div class="ladder__price-row">
            <span class="num-hero" class:text-tertiary={refunded}>{refunded || !price ? 'None' : formatNear(price)}</span>
            <span class="unit" style="font-size:var(--fs-body)">{refunded ? 'no tier reached' : 'NEAR per unit'}</span>
          </div>
          <p class="ladder__summary">
            {#if model.summary.v === 'settled'}
              Tier {model.summary.tierNo} of {model.summary.tierCount}, reached with <b>{plural(model.summary.units, 'unit')}</b>. Every agent paid the same price{model.summary.pctText}.
            {:else if model.summary.v === 'refunded'}
              The group reached <b>{plural(model.summary.units, 'unit')}</b>, short of the first tier at {model.summary.min}. Everyone was refunded in full.
            {/if}
          </p>
        </div>
        <TierBar {bar} thick wide />
      </div>
      <dl class="receipt-figures">
        {#if refunded}
          <div class="stat"><dt class="stat__label">Units pledged</dt><dd class="stat__value">{model.pledged}</dd><dd class="stat__meta">from {plural(pool.member_count, 'agent')}</dd></div>
          <div class="stat"><dt class="stat__label">Seller payout</dt><dd class="stat__value">0.00<span class="unit">NEAR</span></dd><dd class="stat__meta">no tier reached</dd></div>
          <div class="stat"><dt class="stat__label">Refunded</dt><dd class="stat__value" title="{r ? formatNearExact(r.totals.locked, 2) : ''} NEAR">{r ? formatNear(r.totals.refunded, { min: 2, max: 2 }) : '…'}<span class="unit">NEAR</span></dd><dd class="stat__meta">back to agent budgets</dd></div>
          <div class="stat"><dt class="stat__label">Agents refunded</dt><dd class="stat__value">{pool.member_count}</dd><dd class="stat__meta">in full</dd></div>
        {:else}
          <div class="stat"><dt class="stat__label">Units delivered</dt><dd class="stat__value">{result?.units ?? 0}</dd><dd class="stat__meta">to {plural(result?.members_in ?? 0, 'agent')}</dd></div>
          <div class="stat"><dt class="stat__label">Seller payout</dt><dd class="stat__value" title="{result ? formatNearExact(result.seller_payout, 2) : ''} NEAR">{result ? formatNear(result.seller_payout, { min: 2, max: 2 }) : '…'}<span class="unit">NEAR</span></dd><dd class="stat__meta">{result?.units ?? 0} {'×'} {price ? formatNear(price) : '…'}</dd></div>
          <div class="stat"><dt class="stat__label">Refunded</dt><dd class="stat__value" title="{r ? formatNearExact(r.totals.refunded, 2) : ''} NEAR">{r ? formatNear(r.totals.refunded, { min: 2, max: 2 }) : '…'}<span class="unit">NEAR</span></dd><dd class="stat__meta">back to agent budgets</dd></div>
          <div class="stat"><dt class="stat__label">Saved vs list</dt><dd class="stat__value text-positive" title="{formatNearExact(saved, 2)} NEAR">{formatNear(saved, { min: 2, max: 2 })}<span class="unit">NEAR</span></dd><dd class="stat__meta">against {formatNear(list)} per unit</dd></div>
        {/if}
      </dl>
    </div>
  </section>

  <section class="card" aria-labelledby="payout-title">
    <div class="card__head"><h2 id="payout-title" class="card__title"><Icon name="coins" />Seller</h2><AccountLink id={pool.offer.seller} /></div>
    <div class="card__body payout">
      <dl class="dl">
        <div class="dl__row"><dt>{refunded ? 'Paid' : `Paid for ${plural(result?.units ?? 0, 'unit')}`}</dt><dd>{result ? formatNear(result.seller_payout) : '0.00'}<span class="unit">NEAR</span></dd></div>
        <div class="dl__row"><dt>{refunded ? 'Units returned' : 'Unsold units returned'}</dt><dd>{unsold}<span class="unit">units</span></dd></div>
        <div class="dl__row"><dt>Inventory held before</dt><dd>{pool.offer.max_units}<span class="unit">units</span></dd></div>
      </dl>
      {#if sellerTxs.length}
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
          {#each sellerTxs as e (e.id)}<TxChip hash={e.tx!.hash} method={e.tx!.method} explorerUrl={e.tx!.explorer_url} />{/each}
        </div>
      {/if}
      <p class="t-body-s text-tertiary">Had the group missed every tier, the seller would have been paid nothing and got all {pool.offer.max_units} units back.</p>
    </div>
  </section>
</div>

<section class="section" style="margin-block-start:var(--space-6)" aria-labelledby="proof-title">
  {#if receipt.error}
    <Banner kind="negative" icon="alert" title="Receipt does not reconcile" role="alert">{receipt.error}.</Banner>
  {:else if r && r.failure}
    <Banner kind="negative" icon="alert" title="Receipt does not reconcile" role="alert">{r.failure[0].toUpperCase() + r.failure.slice(1)}. The numbers below come straight from the contract and are not endorsed.</Banner>
  {:else if r && r.missingLimits > 0 && !refunded}
    {#if store.limitsState === 'error'}
      <Banner kind="warning" icon="alert" title="Limits could not be read" role="alert">
        {plural(r.missingLimits, 'agent limit')} could not be loaded, so the claim "paid at or below their limit" is not proven yet.
        {#snippet actions()}<button class="btn btn--ghost btn--sm" type="button" onclick={() => store.retryLimits()}>Retry</button>{/snippet}
      </Banner>
    {:else}
      <div class="proof" aria-busy="true"><span class="proof__seal" style="background:var(--track);color:var(--text-tertiary)"><span class="spinner"></span></span><div style="display:grid;gap:8px"><span class="skeleton" style="inline-size:min(100%,420px);block-size:28px"></span><span class="skeleton" style="inline-size:260px"></span></div></div>
    {/if}
  {:else if r}
    <div class="proof">
      <span class="proof__seal"><Icon name="check" /></span>
      <div>
        <h2 id="proof-title" class="proof__title">
          {#if refunded}<em>{r.rows.length} of {r.rows.length}</em> agents refunded in full.
          {:else}<em>{r.withinCount} of {r.filledCount}</em> agents paid at or below their limit.{/if}
        </h2>
        <p class="proof__sub">
          {#if refunded}
            The group stopped at {model.pledged} {model.pledged === 1 ? 'unit' : 'units'}, short of the first tier at {pool.offer.tiers[0].min_units}. The seller was not paid.
          {:else}
            The tightest limit in the group was {r.tightestLimit !== null ? formatNear(r.tightestLimit) : 'unknown'}. Everyone paid {r.unitPrice ? formatNear(r.unitPrice) : 'the tier price'}.{#if r.excludedCount > 0}{' '}{plural(r.excludedCount, 'agent')} {r.excludedCount === 1 ? 'was' : 'were'} excluded and refunded in full.{/if}
          {/if}
        </p>
      </div>
      <ul class="proof__checks">
        {#each r.checks as c (c.label)}<li><Icon name="check" />{c.label}</li>{/each}
      </ul>
    </div>
  {/if}
</section>

{#if r}
  <section class="section" style="margin-block-start:var(--space-6)" aria-labelledby="ledger-title">
    <Ledger receipt={r} archetypes={store.archetypes} {joinTx} hasServer={config.server === 'up'} />
  </section>
{/if}

<section class="section" style="margin-block-start:var(--space-6)" aria-labelledby="settle-title">
  <div class="card">
    <div class="card__head">
      <h2 id="settle-title" class="card__title">Settlement transactions {#if settleTxs.length}<span class="card__count">{settleTxs.length}</span>{/if}</h2>
      <span class="t-body-s text-tertiary">Anyone can call settle after the deadline</span>
    </div>
    {#if settleTxs.length}
      <ol class="settle-list">
        {#each settleTxs as e (e.id)}
          <li class="settle-tx">
            <span class="settle-tx__time mono">{fmtClock(e.ts, true)}</span>
            <div><p>{e.message}</p><p class="t-body-s text-tertiary mono">{e.tx!.signer}</p></div>
            <TxChip hash={e.tx!.hash} method={e.tx!.method} explorerUrl={e.tx!.explorer_url} />
          </li>
        {/each}
      </ol>
    {:else}
      <div class="card__body"><p class="t-body-s text-secondary">Transaction links need the Co-op server. The numbers above come straight from the contract.</p></div>
    {/if}
  </div>
</section>
