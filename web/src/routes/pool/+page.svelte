<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import ActivityFeed from '#lib/components/ActivityFeed.svelte';
  import Banner from '#lib/components/Banner.svelte';
  import EmptyState from '#lib/components/EmptyState.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import MemberList from '#lib/components/MemberList.svelte';
  import PoolFacts from '#lib/components/PoolFacts.svelte';
  import PoolHead from '#lib/components/PoolHead.svelte';
  import PoolSkeleton from '#lib/components/PoolSkeleton.svelte';
  import ReceiptView from '#lib/components/ReceiptView.svelte';
  import RoomBanner from '#lib/components/RoomBanner.svelte';
  import { apiEnabled, fetchRoom, fetchRooms } from '#lib/api.ts';
  import type { Room } from '#lib/models.ts';
  import TierLadder from '#lib/components/TierLadder.svelte';
  import { config } from '#lib/config.svelte.ts';
  import { fmtClock, nsToMs } from '#lib/format.ts';
  import { ladderModel } from '#lib/ladder.ts';
  import { ContractViewError } from '#lib/rpc.svelte.ts';
  import { PoolPage } from '#lib/stores/pool.svelte.ts';
  import { retryAll } from '#lib/stores/registry.ts';

  const rawId = $derived(page.url.searchParams.get('id'));
  const id = $derived(rawId && /^\d+$/.test(rawId) ? Number(rawId) : null);

  let store = $state<PoolPage | null>(null);
  $effect(() => {
    if (id === null) {
      store = null;
      return;
    }
    const s = new PoolPage(id);
    store = s;
    s.start();
    return () => s.stop();
  });

  // The room this pool belongs to, if any: by the code in the link, else from the room list.
  const codeParam = $derived(page.url.searchParams.get('code')?.toUpperCase() ?? null);
  let room = $state<Room | null>(null);
  $effect(() => {
    const want = id;
    const code = codeParam;
    room = null;
    if (want === null || !apiEnabled()) return;
    let live = true;
    (code ? fetchRoom(code).then((r) => (r && r.pool_id === want ? r : null)) : fetchRooms().then((rs) => rs.find((r) => r.pool_id === want) ?? null))
      .then((r) => {
        if (live) room = r;
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  });

  const pool = $derived(store?.pool ?? null);
  const status = $derived(store?.status ?? null);
  const members = $derived(store?.members ?? []);
  const model = $derived(pool ? ladderModel(pool, members) : null);
  const final = $derived(status === 'Settled' || status === 'Refunded');
  const err = $derived(store?.poller.error ?? null);

  type Tab = 'receipt' | 'ladder' | 'activity';
  const tabParam = $derived(page.url.searchParams.get('tab'));
  const tab = $derived<Tab>(tabParam === 'ladder' || tabParam === 'activity' ? tabParam : 'receipt');
  function setTab(t: Tab) {
    const u = new URL(page.url.href);
    if (t === 'receipt') u.searchParams.delete('tab');
    else u.searchParams.set('tab', t);
    void goto(u, { replace: true, reset: false });
  }
  const tabs: Array<[Tab, string, string]> = [['receipt', 'Receipt', 'receipt'], ['ladder', 'Ladder', 'layers'], ['activity', 'Activity', 'clock']];
  function onTabKey(e: KeyboardEvent) {
    const i = tabs.findIndex(([k]) => k === tab);
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const t = tabs[(next + tabs.length) % tabs.length][0];
    setTab(t);
    queueMicrotask(() => document.getElementById(`tab-${t}`)?.focus());
  }

  const title = $derived(pool ? `Pool #${pool.id} · Co-op` : id !== null ? `Pool #${id} · Co-op` : 'Pool · Co-op');
  const lockTime = $derived(pool ? `${fmtClock(nsToMs(pool.offer.lock_at_ns))} UTC` : '');
  const deadlineTime = $derived(pool ? `${fmtClock(nsToMs(pool.offer.deadline_ns))} UTC` : '');
</script>

<svelte:head><title>{title}</title></svelte:head>

<main id="main" tabindex="-1" class="page">
  <div class="container">
    {#if id === null || store?.notFound}
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Pools</a><Icon name="chevron-right" size="xs" /><span aria-current="page">{id !== null ? `#${id}` : 'Unknown pool'}</span></nav>
      </header>
      <div class="card">
        <EmptyState title={id !== null ? `Pool #${id} doesn't exist` : "That isn't a pool id"} body={id !== null ? 'Pool ids start at 1.' : 'Open a pool from the list.'}>
          <a class="btn btn--secondary btn--sm" href="/">All pools</a>
        </EmptyState>
      </div>
    {:else if store && !pool && err}
      <header class="page-head">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Pools</a><Icon name="chevron-right" size="xs" /><span aria-current="page">#{id}</span></nav>
      </header>
      <div class="card">
        <EmptyState
          title={err instanceof ContractViewError ? 'Contract not found' : `Can't reach ${config.network} right now`}
          body={err instanceof ContractViewError ? (config.contractId ? `${config.contractId} did not answer a view call on ${config.network}. Check PUBLIC_COOP_CONTRACT_ID.` : 'No contract is configured. Set PUBLIC_COOP_CONTRACT_ID and rebuild.') : 'Pools are read straight from the chain, so nothing can be shown until the RPC node answers.'}
        >
          <button class="btn btn--secondary btn--sm" type="button" onclick={retryAll}><Icon name="refresh" size="sm" />Retry now</button>
        </EmptyState>
      </div>
    {:else if store && pool && status && model}
      <PoolHead {pool} {status} />
      {#if room}<RoomBanner {room} code={codeParam} open={status === 'Open'} />{/if}

      {#if final}
        <div class="tabs" role="tablist" aria-label="Pool views" style="margin-block-end: var(--space-8)" tabindex="-1" onkeydown={onTabKey}>
          {#each tabs as [key, label, icon] (key)}
            <button class="tabs__tab" id="tab-{key}" role="tab" aria-selected={tab === key} aria-controls="panel-{key}" tabindex={tab === key ? 0 : -1} onclick={() => setTab(key)}>
              <Icon name={icon} />{label}
            </button>
          {/each}
        </div>

        <div role="tabpanel" id="panel-{tab}" aria-labelledby="tab-{tab}">
          {#if tab === 'receipt'}
            <ReceiptView {store} />
          {:else if tab === 'ladder'}
            <div class="pool-layout pool-layout--two">
              <section class="pool-layout__ladder card" aria-labelledby="ladder-title">
                <TierLadder {model} refunded={status === 'Refunded'} />
              </section>
              <section class="pool-layout__facts card" aria-label="Pool figures"><PoolFacts {pool} {members} {model} /></section>
              <section class="pool-layout__members card" aria-labelledby="members-title">
                <div class="card__head"><h2 id="members-title" class="card__title">Members <span class="card__count">{members.length}</span></h2><span class="t-body-s text-tertiary">Final state</span></div>
                <MemberList {pool} {members} flipped={store.flipped} archetypes={store.archetypes} />
                <div class="card__foot">Membership was frozen at {lockTime}.</div>
              </section>
            </div>
          {:else}
            <div class="card" style="max-inline-size:760px" aria-labelledby="feed-title"><ActivityFeed {store} all /></div>
          {/if}
        </div>
      {:else}
        {#if status === 'Locked'}
          <div style="margin-block-end:var(--space-6)"><Banner kind="warning" icon="lock" title="Pool locked">Membership is frozen. Settlement can run from {deadlineTime}.</Banner></div>
        {:else if status === 'Expired'}
          <div style="margin-block-end:var(--space-6)"><Banner kind="info" icon="hourglass" title="Deadline passed">Anyone can call settle. Our settler usually does it within a minute.</Banner></div>
        {:else if status === 'AwaitingInventory'}
          <div style="margin-block-end:var(--space-6)"><Banner kind="info" icon="package" title="Awaiting inventory">The seller has not deposited the full inventory yet. Nobody can join until the pool opens.</Banner></div>
        {/if}

        <div class="pool-layout">
          <section class="pool-layout__ladder card" aria-labelledby="ladder-title">
            <TierLadder {model} priceTick={store.priceTick} justReached={store.justReached} />
          </section>

          <section class="pool-layout__facts card" aria-label="Pool figures">
            <PoolFacts {pool} {members} {model} />
          </section>

          <section class="pool-layout__members card" aria-labelledby="members-title">
            <div class="card__head">
              <h2 id="members-title" class="card__title">Members <span class="card__count">{members.length}</span></h2>
              <span class="t-body-s text-tertiary">Join order</span>
            </div>
            {#if members.length === 0}
              <div class="empty" style="padding-block:var(--space-9)"><p class="empty__title">No members yet</p><p class="empty__body">Agents that join this pool will appear here, in join order.</p></div>
            {:else}
              <MemberList {pool} {members} flipped={store.flipped} archetypes={store.archetypes} />
            {/if}
            <div class="card__foot">
              {status === 'Open' || status === 'AwaitingInventory'
                ? `A conditional agent counts only once the group reaches its number. Agents can leave until ${lockTime}.`
                : 'Membership is frozen.'}
            </div>
          </section>

          <aside class="pool-layout__feed card" aria-labelledby="feed-title">
            <ActivityFeed {store} />
          </aside>
        </div>
      {/if}

      <div class="visually-hidden" aria-live="polite" aria-atomic="false">
        {#each store.announcements as a, i (i + a)}<p>{a}</p>{/each}
      </div>
    {:else}
      <header class="page-head" aria-busy="true">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Pools</a><Icon name="chevron-right" size="xs" /><span aria-current="page">#{id}</span></nav>
        <div style="display:grid;gap:var(--space-4)"><span class="skeleton" style="inline-size:min(100%,420px);block-size:40px"></span><span class="skeleton" style="inline-size:min(100%,360px)"></span></div>
      </header>
      <PoolSkeleton />
    {/if}
  </div>
</main>

<style>
  .pool-layout--two {
    grid-template-columns: 360px minmax(0, 1fr);
    grid-template-rows: auto 1fr;
    grid-template-areas: 'ladder facts' 'ladder members';
  }
  @media (max-width: 899px) {
    .pool-layout--two {
      grid-template-columns: minmax(0, 1fr);
      grid-template-rows: none;
      grid-template-areas: 'ladder' 'facts' 'members';
    }
  }
</style>
