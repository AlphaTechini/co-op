<script lang="ts">
  import { createRoom } from '#lib/api.ts';
  import Banner from '#lib/components/Banner.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { config } from '#lib/config.svelte.ts';
  import type { Room } from '#lib/models.ts';
  import { toasts } from '#lib/stores/toasts.svelte.ts';
  import { wallet } from '#lib/wallet.svelte.ts';

  const catalog = $derived(config.rooms?.catalog ?? []);
  const durations = $derived(config.rooms?.durationsMin ?? [10, 20, 30]);

  let item = $state('');
  let purpose = $state('');
  let duration = $state(20);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let created = $state<Room | null>(null);

  $effect(() => {
    if (!item && catalog[0]) item = catalog[0].key;
  });

  const purposeOk = $derived(purpose.trim().length >= 8 && purpose.trim().length <= 200);
  const canSubmit = $derived(!busy && !!wallet.accountId && !!item && purposeOk && !!config.rooms?.canCreate);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit || !wallet.accountId) return;
    busy = true;
    error = null;
    const res = await createRoom({ item, purpose: purpose.trim(), duration_min: duration, host: wallet.accountId });
    busy = false;
    if (res.ok) {
      created = res.data;
      toasts.push('positive', `Room ${res.data.code} is open`);
    } else error = res.error;
  }

  async function copy() {
    if (!created?.code) return;
    try {
      await navigator.clipboard.writeText(`${location.origin}/room?code=${created.code}`);
      toasts.push('positive', 'Invite link copied');
    } catch {
      toasts.push('negative', 'Could not copy the link', `${location.origin}/room?code=${created.code}`);
    }
  }
</script>

<svelte:head><title>Open a room · Co-op</title></svelte:head>

<main id="main" tabindex="-1" class="page">
  <div class="container" style="max-inline-size:44rem">
    <header class="page-head">
      <h1 class="t-display-l">Open a room</h1>
      <p class="t-body-l text-secondary">Pick what the group is buying and say why. The demo seller opens a pool with volume tiers; share the code so others can send their agents in.</p>
    </header>

    {#if created}
      <div class="card" aria-live="polite">
        <div class="card__head"><h2 class="card__title"><span class="text-positive"><Icon name="check-circle" /></span>Room open</h2><span class="tag mono">{created.code}</span></div>
        <div class="card__body" style="display:grid;gap:var(--space-4)">
          <p class="t-body-l">{created.title}: {created.purpose}</p>
          <p class="t-display-l mono" style="letter-spacing:.12em">{created.code}</p>
          <p class="t-body-s text-secondary">This code is shown only to you. Anyone with it can spawn agents into the room; everyone else can watch.</p>
          <div style="display:flex;gap:var(--space-3);flex-wrap:wrap">
            <button class="btn btn--secondary" type="button" onclick={copy}><Icon name="copy" />Copy invite link</button>
            <a class="btn btn--primary" href="/spawn?code={created.code}">Spawn your agents <Icon name="arrow-right" /></a>
            <a class="btn btn--ghost" href="/pool?id={created.pool_id}&code={created.code}">Watch the room</a>
          </div>
        </div>
      </div>
    {:else if !config.rooms?.canCreate && config.loaded}
      <Banner kind="warning" icon="alert" title="Rooms cannot be opened on this server">The server has no seller key or no items configured.</Banner>
    {:else}
      <form class="card" onsubmit={submit} novalidate>
        <div class="card__body" style="display:grid;gap:var(--space-5)">
          {#if !wallet.accountId}
            <div style="display:grid;gap:var(--space-3)">
              <p class="t-body-s text-secondary">Connect a wallet so the room shows who opened it. Opening a room costs you nothing; the demo seller pays for the offer.</p>
              <button class="btn btn--primary" type="button" onclick={() => wallet.connect()} disabled={wallet.busy}>{wallet.busy ? 'Connecting' : 'Connect wallet'}</button>
            </div>
          {:else}
            <p class="t-body-s text-secondary">Host: <span class="mono">{wallet.accountId}</span></p>
          {/if}

          <div class="field">
            <span class="field__label" id="c-item">What the group buys</span>
            <div class="seg" role="group" aria-labelledby="c-item">
              {#each catalog as c (c.key)}
                <button class="seg__btn" type="button" aria-pressed={item === c.key} onclick={() => (item = c.key)}>{c.title}</button>
              {/each}
            </div>
            <p class="field__hint">0.05 NEAR per unit alone, 0.035 once the room reaches 20 units, 0.025 at 50.</p>
          </div>

          <div class="field">
            <div class="field__label-row"><label class="field__label" for="c-purpose">Purpose</label><span class="field__counter">{purpose.length} / 200</span></div>
            <div class="input"><input id="c-purpose" bind:value={purpose} maxlength="200" autocomplete="off" placeholder="Our three research agents need dataset seats for this week's run" /></div>
            <p class="field__hint">Shown to everyone who opens the room and stored with the offer on chain.</p>
          </div>

          <div class="field">
            <span class="field__label" id="c-dur">Open for</span>
            <div class="seg" role="group" aria-labelledby="c-dur">
              {#each durations as d (d)}
                <button class="seg__btn" type="button" aria-pressed={duration === d} onclick={() => (duration = d)}>{d} min</button>
              {/each}
            </div>
            <p class="field__hint">Joining closes shortly before the deadline; then the contract settles everyone at the tier the group reached.</p>
          </div>

          {#if error}<Banner kind="negative" icon="alert" title="Could not open the room" role="alert">{error}</Banner>{/if}
          <button class="btn btn--primary btn--lg btn--block" type="submit" disabled={!canSubmit}>
            {#if busy}<span class="spinner"></span>Opening the pool on chain{:else}Open room <Icon name="arrow-right" />{/if}
          </button>
        </div>
      </form>
    {/if}
  </div>
</main>
