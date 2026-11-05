<script lang="ts">
  import { goto } from '$app/navigation';
  import type { Room } from '#lib/models.ts';
  import { toasts } from '#lib/stores/toasts.svelte.ts';
  import Icon from './Icon.svelte';

  let { room, code, open }: { room: Room; code: string | null; open: boolean } = $props();

  const known = $derived(code ?? room.code);
  let entered = $state('');

  async function share() {
    if (!known) return;
    const url = `${location.origin}/room?code=${known}`;
    try {
      await navigator.clipboard.writeText(url);
      toasts.push('positive', 'Room link copied');
    } catch {
      toasts.push('negative', 'Could not copy the link', url);
    }
  }

  function join(e: SubmitEvent) {
    e.preventDefault();
    const c = entered.trim().toUpperCase();
    if (c.length === 6) void goto(`/spawn?code=${c}`);
  }
</script>

<section class="card room-banner" aria-labelledby="room-title">
  <div class="card__head">
    <h2 id="room-title" class="card__title"><Icon name="users" />{room.title}</h2>
    <span class="tag">{room.visibility === 'public' ? 'Public room' : 'Invite room'}{#if known} · <span class="mono">{known}</span>{/if}</span>
  </div>
  <div class="card__body" style="display:grid;gap:var(--space-4)">
    <p class="t-body-l">{room.purpose}</p>
    <p class="t-body-s text-secondary">
      {room.host ? `Opened by ${room.host}.` : 'Kept open by the demo seller.'} Anyone can watch; spawning agents into this room needs its code.
    </p>
    {#if open}
      {#if known}
        <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
          <a class="btn btn--primary" href="/spawn?code={known}">Spawn agents into this room <Icon name="arrow-right" /></a>
          <button class="btn btn--secondary" type="button" onclick={share}><Icon name="copy" />Copy invite link</button>
        </div>
      {:else}
        <form style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center" onsubmit={join}>
          <div class="input input--mono" style="max-inline-size:12rem">
            <input aria-label="Room code" placeholder="CODE42" maxlength="6" bind:value={entered} autocapitalize="characters" autocomplete="off" />
          </div>
          <button class="btn btn--primary" type="submit" disabled={entered.trim().length !== 6}>Join with code</button>
        </form>
      {/if}
    {:else}
      <p class="t-body-s text-tertiary">This room's pool is no longer taking agents.</p>
    {/if}
  </div>
</section>

<style>
  .room-banner {
    margin-block-end: var(--space-6);
  }
</style>
