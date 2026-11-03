<script lang="ts">
  import { onMount } from 'svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import PoolRow from '#lib/components/PoolRow.svelte';
  import { config } from '#lib/config.svelte.ts';
  import { formatNear, formatNearExact, relativeAgo } from '#lib/format.ts';
  import { ContractViewError, RpcUnavailableError } from '#lib/rpc.svelte.ts';
  import { effectiveStatus } from '#lib/status.ts';
  import { clock } from '#lib/stores/clock.svelte.ts';
  import { OverviewStore } from '#lib/stores/overview.svelte.ts';
  import { retryAll } from '#lib/stores/registry.ts';

  const store = new OverviewStore();
  onMount(() => {
    store.start();
    return () => store.stop();
  });

  type Filter = 'all' | 'open' | 'locked' | 'settled' | 'refunded';
  let filter = $state<Filter>('all');

  const data = $derived(store.poller.data);
  const pools = $derived(data?.pools ?? []);
  const group = (p: (typeof pools)[number]): Filter => {
    const s = effectiveStatus(p, clock.now);
    if (s === 'Open') return 'open';
    if (s === 'Locked' || s === 'Expired' || s === 'Settling') return 'locked';
    if (s === 'Settled') return 'settled';
    if (s === 'Refunded') return 'refunded';
    return 'all';
  };
  const counts = $derived({
    all: pools.length,
    open: pools.filter((p) => group(p) === 'open').length,
    locked: pools.filter((p) => group(p) === 'locked').length,
    settled: pools.filter((p) => group(p) === 'settled').length,
    refunded: pools.filter((p) => group(p) === 'refunded').length
  });
  const shown = $derived(filter === 'all' ? pools : pools.filter((p) => group(p) === filter));
  const filters: Array<[Filter, string]> = [['all', 'All'], ['open', 'Open'], ['locked', 'Locked'], ['settled', 'Settled'], ['refunded', 'Refunded']];

  const cta = $derived.by(() => {
    const open = pools.find((p) => effectiveStatus(p, clock.now) === 'Open');
    if (open) return { id: open.id, label: `Watch pool #${open.id} live` };
    const newest = pools[0];
    return newest ? { id: newest.id, label: `See pool #${newest.id}` } : null;
  });

  const err = $derived(store.poller.error);
  const hardError = $derived(!data && !!err);
  const stats = $derived(data?.stats);
  const proof = $derived(store.lastProof?.receipt);
  const updated = $derived(store.poller.updatedAt ? relativeAgo(store.poller.updatedAt, clock.now) : null);
  const notConfigured = $derived(!config.contractId && config.loaded);
</script>

<svelte:head><title>Pools · Co-op</title></svelte:head>

<main class="page page--hero">
  <div class="container">
    <section class="hero" aria-labelledby="hero-title">
      <div>
        <p class="hero__eyebrow"><span class="live-dot" data-state={store.poller.failures > 0 ? 'paused' : undefined}>Live on NEAR {config.network}</span></p>
        <h1 id="hero-title" class="t-display-xl">Small buyers.<br /><em>Bulk price.</em></h1>
        <p class="hero__lede">Co-op lets AI buying agents pool their orders on NEAR so a group of small buyers gets the bulk price, <b>with the contract guaranteeing no agent ever pays more than its own limit.</b></p>
        <div class="hero__actions">
          {#if cta}
            <a class="btn btn--primary btn--lg" href="/pool?id={cta.id}">{cta.label} <Icon name="arrow-right" /></a>
          {/if}
          <a class="btn {cta ? 'btn--secondary' : 'btn--primary'} btn--lg" href="/spawn">Spawn an agent</a>
        </div>
      </div>

      <aside class="clause" aria-labelledby="clause-title">
        <div class="clause__head">
          <h2 id="clause-title" class="t-eyebrow">The invariant</h2>
          <span class="tag"><Icon name="shield" size="xs" /> enforced by the contract</span>
        </div>
        <p class="clause__text"><span class="clause__mark">i.</span>No agent pays more than its own limit.</p>
        <p class="clause__text"><span class="clause__mark">ii.</span>The seller is paid only if the group reaches a price tier.</p>
        <div class="clause__foot">
          {#if proof && store.lastProof}
            {#if proof.verified}
              <span class="clause__check"><Icon name="check-circle" /> Last settlement: {proof.withinCount} of {proof.filledCount} agents at or below their limit.</span>
              <a class="link" href="/pool?id={store.lastProof.poolId}">Pool #{store.lastProof.poolId} receipt</a>
            {:else}
              <span class="text-negative" style="display:inline-flex;gap:8px;align-items:center"><Icon name="alert" /> {proof.failure ? `Pool #${store.lastProof.poolId} does not reconcile: ${proof.failure}.` : `Pool #${store.lastProof.poolId}: ${proof.missingLimits} agent limits could not be read.`}</span>
              <a class="link" href="/pool?id={store.lastProof.poolId}">Open receipt</a>
            {/if}
          {:else if store.proofState === 'loading' || (!data && !hardError)}
            <span class="skeleton" style="inline-size:70%" aria-busy="true"></span>
          {:else if store.proofState === 'error'}
            <span class="text-tertiary">The last settlement could not be checked right now.</span>
          {:else}
            <span class="text-secondary">No settlements yet. The first receipt will appear here.</span>
          {/if}
        </div>
      </aside>
    </section>

    {#if notConfigured}
      <EmptyState title="Co-op is not configured" body="This build has no contract id. Set PUBLIC_COOP_CONTRACT_ID and rebuild, or point it at a server that exposes /api/config." />
    {:else if hardError}
      <section class="card" aria-live="polite">
        <EmptyState
          title={err instanceof ContractViewError ? 'Contract not found' : "Can't reach testnet right now"}
          body={err instanceof ContractViewError
            ? `${config.contractId} did not answer a view call on ${config.network}. Check PUBLIC_COOP_CONTRACT_ID.`
            : err instanceof RpcUnavailableError
              ? 'The RPC node is not answering. Pools are read straight from the chain, so nothing can be shown until it is back.'
              : 'Something went wrong while reading the contract.'}
        >
          <button class="btn btn--secondary btn--sm" type="button" onclick={retryAll}><Icon name="refresh" size="sm" />Retry now</button>
        </EmptyState>
      </section>
    {:else}
      <section aria-label="Contract totals" aria-busy={!stats}>
        <dl class="stats">
          <div class="stat"><dt class="stat__label">Offers</dt><dd class="stat__value">{#if stats}{stats.offers}{:else}<span class="skeleton skeleton--num"></span>{/if}</dd><dd class="stat__meta">since deploy</dd></div>
          <div class="stat"><dt class="stat__label">Pools settled</dt><dd class="stat__value">{#if stats}{stats.pools_settled}{:else}<span class="skeleton skeleton--num"></span>{/if}</dd><dd class="stat__meta">a tier was reached</dd></div>
          <div class="stat"><dt class="stat__label">Pools refunded</dt><dd class="stat__value">{#if stats}{stats.pools_refunded}{:else}<span class="skeleton skeleton--num"></span>{/if}</dd><dd class="stat__meta">no tier, all money back</dd></div>
          <div class="stat"><dt class="stat__label">Agents</dt><dd class="stat__value">{#if stats}{stats.agents}{:else}<span class="skeleton skeleton--num"></span>{/if}</dd><dd class="stat__meta">registered on the contract</dd></div>
          <div class="stat"><dt class="stat__label">Volume</dt><dd class="stat__value" title={stats ? `${formatNearExact(stats.volume, 2)} NEAR` : undefined}>{#if stats}{formatNear(stats.volume, { min: 2, max: 2 })}<span class="unit">NEAR</span>{:else}<span class="skeleton skeleton--num"></span>{/if}</dd><dd class="stat__meta">paid to sellers</dd></div>
          <div class="stat"><dt class="stat__label">Units delivered</dt><dd class="stat__value">{#if stats}{stats.units_delivered}{:else}<span class="skeleton skeleton--num"></span>{/if}</dd><dd class="stat__meta">vouchers to agents</dd></div>
        </dl>
      </section>

      <section class="section" aria-labelledby="pools-title" style="margin-block-start: var(--space-11)">
        <div class="section-head">
          <div class="section-head__title">
            <h2 id="pools-title" class="t-title-l">Pools</h2>
            {#if updated}<span class="live-dot" data-state={store.poller.failures > 0 ? 'paused' : undefined}>Updated {updated}</span>{/if}
          </div>
          <div class="seg" role="group" aria-label="Filter pools">
            {#each filters as [key, label] (key)}
              <button class="seg__btn" type="button" aria-pressed={filter === key} onclick={() => (filter = key)}>{label} <span class="seg__count">{data ? counts[key] : '–'}</span></button>
            {/each}
          </div>
        </div>

        {#if !data}
          <div class="pool-list" aria-busy="true" aria-label="Loading pools">
            {#each [0, 1, 2, 3] as i (i)}
              <div class="pool-row" style="pointer-events:none">
                <span class="skeleton" style="inline-size:28px"></span>
                <span style="display:grid;gap:8px"><span class="skeleton" style="inline-size:{70 - i * 8}%;block-size:14px"></span><span class="skeleton" style="inline-size:40%"></span></span>
                <span class="skeleton" style="inline-size:80px;block-size:24px;border-radius:999px"></span>
                <span style="display:grid;gap:8px"><span class="skeleton" style="inline-size:50%"></span><span class="skeleton" style="block-size:6px"></span><span class="skeleton" style="inline-size:70%"></span></span>
                <span class="skeleton" style="inline-size:48px;justify-self:end;block-size:18px"></span>
                <span class="skeleton" style="inline-size:32px;justify-self:end"></span>
                <span class="skeleton" style="inline-size:56px;justify-self:end"></span>
                <span></span>
              </div>
            {/each}
          </div>
        {:else if pools.length === 0}
          <div class="card">
            <EmptyState title="No pools yet" body="The demo seller opens a pool every hour. Spawn an agent now and it will join the next one.">
              <a class="btn btn--secondary btn--sm" href="/spawn">Spawn an agent</a>
            </EmptyState>
          </div>
        {:else if shown.length === 0}
          <div class="card">
            {#if filter === 'open'}
              <EmptyState title="No open pools right now" body="The next demo offer opens on the hour. Settled pools and their receipts are below.">
                <a class="btn btn--secondary btn--sm" href="/spawn">Spawn an agent for the next one</a>
              </EmptyState>
            {:else}
              <EmptyState title="No {filter} pools" body="Try another filter." />
            {/if}
          </div>
        {:else}
          <div class="pool-list">
            <div class="pool-row pool-row__head" aria-hidden="true">
              <span>Pool</span><span>Item</span><span>Status</span><span>Tier progress</span><span>Price</span><span>Agents</span><span>Time</span><span></span>
            </div>
            {#each shown as p (p.id)}
              <PoolRow pool={p} />
            {/each}
          </div>
          {#if data.full}
            <div style="display:flex;justify-content:center;margin-block-start:var(--space-6)">
              <button class="btn btn--secondary" type="button" onclick={() => store.more()}>Show more</button>
            </div>
          {/if}
        {/if}
      </section>
    {/if}
  </div>
</main>
