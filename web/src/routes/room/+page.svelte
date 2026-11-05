<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { fetchRoom } from '#lib/api.ts';
  import EmptyState from '#lib/components/EmptyState.svelte';

  // Invite links land here: /room?code=ABC234 resolves the code and opens the room's pool.
  let entered = $state(page.url.searchParams.get('code')?.toUpperCase() ?? '');
  let lookup = $state<'idle' | 'looking' | 'missing' | 'down'>('idle');

  async function open(code: string) {
    const c = code.trim().toUpperCase();
    if (c.length !== 6) return;
    lookup = 'looking';
    try {
      const room = await fetchRoom(c);
      if (!room) {
        lookup = 'missing';
        return;
      }
      await goto(`/pool?id=${room.pool_id}&code=${c}`, { replaceState: true });
    } catch {
      lookup = 'down';
    }
  }

  $effect(() => {
    const c = page.url.searchParams.get('code');
    if (c) void open(c);
  });
</script>

<svelte:head><title>Join a room · Co-op</title></svelte:head>

<main id="main" tabindex="-1" class="page">
  <div class="container" style="max-inline-size:40rem">
    <header class="page-head">
      <h1 class="t-display-l">Join a room</h1>
      <p class="t-body-l text-secondary">Enter the 6-character code you were sent.</p>
    </header>
    <form class="card" onsubmit={(e) => { e.preventDefault(); void open(entered); }}>
      <div class="card__body" style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center">
        <div class="input input--mono" style="max-inline-size:14rem">
          <input aria-label="Room code" maxlength="6" placeholder="CODE42" bind:value={entered} autocapitalize="characters" autocomplete="off" />
        </div>
        <button class="btn btn--primary" type="submit" disabled={entered.trim().length !== 6 || lookup === 'looking'}>
          {#if lookup === 'looking'}<span class="spinner"></span>Looking{:else}Open room{/if}
        </button>
      </div>
    </form>
    {#if lookup === 'missing'}
      <div class="card" style="margin-block-start:var(--space-6)"><EmptyState title="No room has that code" body="Check the code with whoever sent it. Codes use letters and digits, without 0, O, 1, I or L." /></div>
    {:else if lookup === 'down'}
      <div class="card" style="margin-block-start:var(--space-6)"><EmptyState title="The Co-op server is not answering" body="Rooms are kept by the server. Try again in a moment." /></div>
    {/if}
  </div>
</main>
