<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { apiEnabled, fetchRooms } from '#lib/api.ts';
  import { formatNear, fmtCountdown, nsToMs } from '#lib/format.ts';
  import type { PoolView, Room } from '#lib/models.ts';
  import { effectiveStatus } from '#lib/status.ts';
  import { clock } from '#lib/stores/clock.svelte.ts';
  import Icon from './Icon.svelte';

  let { pools }: { pools: PoolView[] } = $props();

  let rooms = $state<Room[] | null>(null);
  let code = $state('');

  onMount(() => {
    if (!apiEnabled()) return;
    const load = () => fetchRooms().then((r) => (rooms = r)).catch(() => undefined);
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  });

  const open = $derived.by(() => {
    if (!rooms) return [];
    const byId = new Map(pools.map((p) => [p.id, p]));
    return rooms
      .map((room) => ({ room, pool: byId.get(room.pool_id) }))
      .filter((x): x is { room: Room; pool: PoolView } => !!x.pool && effectiveStatus(x.pool, clock.now) === 'Open');
  });

  function join(e: SubmitEvent) {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (c.length === 6) void goto(`/room?code=${c}`);
  }
</script>

<section class="section" aria-labelledby="rooms-title" style="margin-block-start: var(--space-11)">
  <div class="section-head">
    <div class="section-head__title"><h2 id="rooms-title" class="t-title-l">Open rooms</h2></div>
    <form style="display:flex;gap:var(--space-3);align-items:center;flex-wrap:wrap" onsubmit={join}>
      <div class="input input--mono" style="max-inline-size:10rem"><input aria-label="Room code" placeholder="Have a code?" maxlength="6" bind:value={code} autocapitalize="characters" autocomplete="off" /></div>
      <button class="btn btn--secondary btn--sm" type="submit" disabled={code.trim().length !== 6}>Join</button>
      <a class="btn btn--primary btn--sm" href="/create"><Icon name="plus" />Open a room</a>
    </form>
  </div>

  {#if rooms === null}
    <p class="t-body-s text-tertiary">{apiEnabled() ? 'Loading rooms…' : 'Rooms need the Co-op server.'}</p>
  {:else if open.length === 0}
    <div class="card"><div class="empty"><p class="empty__title">No open rooms right now</p><p class="empty__body">The demo seller opens a public room per item as soon as the last one settles. You can also open your own.</p></div></div>
  {:else}
    <div class="room-grid">
      {#each open as { room, pool } (room.pool_id)}
        {@const price = pool.projected.unit_price ?? pool.offer.tiers[0]?.unit_price ?? '0'}
        {@const next = pool.offer.tiers.find((t) => t.min_units > Math.max(pool.projected.units, 1))}
        <a class="card room-card" href="/pool?id={pool.id}{room.code ? `&code=${room.code}` : ''}">
          <div class="card__head">
            <h3 class="card__title">{room.title}</h3>
            <span class="tag">{#if room.code}<span class="mono">{room.code}</span>{:else}<Icon name="lock" size="xs" />Invite{/if}</span>
          </div>
          <div class="card__body" style="display:grid;gap:var(--space-3)">
            <p class="t-body-s text-secondary room-card__purpose">{room.purpose}</p>
            <dl class="dl">
              <div class="dl__row"><dt>Group so far</dt><dd>{pool.projected.units} units · {pool.member_count} agents</dd></div>
              <div class="dl__row"><dt>Price now</dt><dd>{formatNear(price)}<span class="unit">NEAR</span></dd></div>
              <div class="dl__row"><dt>Next tier</dt><dd>{next ? `${next.min_units} units → ${formatNear(next.unit_price)}` : 'best tier reached'}</dd></div>
              <div class="dl__row"><dt>Joining closes in</dt><dd>{fmtCountdown(nsToMs(pool.offer.lock_at_ns) - clock.now)}</dd></div>
            </dl>
            <p class="t-body-s text-tertiary">{room.host ? `Opened by ${room.host}` : 'Public room, kept open by the demo seller'}</p>
          </div>
        </a>
      {/each}
    </div>
  {/if}
</section>

<style>
  .room-grid {
    display: grid;
    gap: var(--space-5);
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
  }
  .room-card {
    color: inherit;
    text-decoration: none;
    transition: border-color 120ms;
  }
  .room-card:hover {
    border-color: var(--border-strong);
  }
  .room-card__purpose {
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
