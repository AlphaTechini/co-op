<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { apiEnabled, fetchRoom, fetchRooms, spawnAgent, type SpawnResult } from '#lib/api.ts';
  import Banner from '#lib/components/Banner.svelte';
  import WalletSpawn from '#lib/components/WalletSpawn.svelte';
  import type { Room } from '#lib/models.ts';
  import Icon from '#lib/components/Icon.svelte';
  import TxChip from '#lib/components/TxChip.svelte';
  import { describePolicy, parseBrief } from '#lib/brief.ts';
  import { getAgent, listPools } from '#lib/chain.ts';
  import { config } from '#lib/config.svelte.ts';
  import { fmtClock, formatNear } from '#lib/format.ts';
  import type { PoolView, SpawnResponse } from '#lib/models.ts';
  import { Poller } from '#lib/stores/poller.svelte.ts';
  import { toasts } from '#lib/stores/toasts.svelte.ts';

  // Room context: /spawn?code=ABC234. Wallet spawning needs a room; the server-paid demo works without one.
  const codeParam = $derived(page.url.searchParams.get('code')?.trim().toUpperCase() ?? null);
  let room = $state<Room | null>(null);
  let roomState = $state<'none' | 'loading' | 'ok' | 'missing'>('none');
  let publicRooms = $state<Room[]>([]);
  let codeInput = $state('');
  let mode = $state<'wallet' | 'demo'>('wallet');
  $effect(() => {
    const code = codeParam;
    room = null;
    if (!code) {
      roomState = 'none';
      return;
    }
    roomState = 'loading';
    fetchRoom(code)
      .then((r) => {
        room = r ? { ...r, code } : null;
        roomState = r ? 'ok' : 'missing';
      })
      .catch(() => (roomState = 'missing'));
  });
  const walletRoom = $derived(room && room.code ? (room as Room & { code: string }) : null);
  const walletMode = $derived(mode === 'wallet' && !!walletRoom && config.maxBatch !== null);

  const MIN_BUDGET = 0.1;
  const EXAMPLES = ['buy 2 now if under 1.00', 'buy 5 only at the 50-unit price', 'buy 3 if it drops below 0.6'];

  const maxBudget = $derived(config.spawn?.maxBudgetNear ?? 2);
  const suffix = $derived(config.operator ? `.${config.operator}` : '');

  let name = $state('');
  let brief = $state('');
  let budgetText = $state('');
  let budgetTouched = $state(false);
  let nameTouched = $state(false);
  let briefTouched = $state(false);
  let nameCheck = $state<'idle' | 'checking' | 'free' | 'taken' | 'unknown'>('idle');
  let busy = $state(false);
  let result = $state<SpawnResult | null>(null);
  let rateUntil = $state<number | null>(null);
  let now = $state(Date.now());

  // budget defaults to the cap once config is known
  $effect(() => {
    if (!budgetTouched) budgetText = maxBudget.toFixed(2);
  });

  const budget = $derived(Number.parseFloat(budgetText.replace(',', '.')));
  const budgetError = $derived.by(() => {
    if (!budgetTouched) return null;
    if (!Number.isFinite(budget) || budget < MIN_BUDGET) return `Budget must be at least ${MIN_BUDGET.toFixed(2)} NEAR.`;
    if (budget > maxBudget) return `Budget is capped at ${maxBudget.toFixed(2)} NEAR.`;
    // the server also needs a small storage reserve on top, so this is a floor, not the exact minimum
    if (liveParsed.units !== null && liveParsed.maxPrice !== null) {
      const floor = BigInt(liveParsed.units) * liveParsed.maxPrice;
      if (BigInt(Math.round(budget * 1e6)) * 10n ** 18n < floor) {
        return `This brief can spend up to ${formatNear(floor)} NEAR (${liveParsed.units} units at ${formatNear(liveParsed.maxPrice)}). Raise the budget or lower the limit.`;
      }
    }
    return null;
  });
  const pct = $derived(
    `${Math.min(100, Math.max(0, ((Number.isFinite(budget) ? budget : MIN_BUDGET) - MIN_BUDGET) / Math.max(maxBudget - MIN_BUDGET, 0.01)) * 100)}%`
  );

  const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,22}[a-z0-9])?$/;
  const nameError = $derived.by(() => {
    if (!nameTouched && !name) return null;
    if (!name) return nameTouched ? 'Names are 2 to 24 characters.' : null;
    if (name.length < 2 || name.length > 24) return 'Names are 2 to 24 characters.';
    if (!NAME_RE.test(name)) return 'Use lowercase letters, digits and hyphens only.';
    if (nameCheck === 'taken') return `That name is taken. Try ${name}-2.`;
    return null;
  });
  const nameOk = $derived(!!name && !nameError && nameCheck === 'free');

  async function checkName() {
    nameTouched = true;
    if (!name || name.length < 2 || !NAME_RE.test(name) || !config.operator) {
      nameCheck = 'idle';
      return;
    }
    const mine = name;
    nameCheck = 'checking';
    try {
      const a = await getAgent(`${mine}.${config.operator}`);
      if (mine === name) nameCheck = a ? 'taken' : 'free';
    } catch {
      if (mine === name) nameCheck = 'unknown';
    }
  }

  // debounced preview input
  let previewBrief = $state('');
  $effect(() => {
    const b = brief;
    const t = setTimeout(() => (previewBrief = b), 150);
    return () => clearTimeout(t);
  });

  const pools = new Poller<PoolView[]>(() => listPools(0, 20), { interval: 10000 });
  onMount(() => {
    if (apiEnabled()) fetchRooms().then((rs) => (publicRooms = rs.filter((r) => r.visibility === 'public' && r.code))).catch(() => undefined);
    pools.start();
    const tick = setInterval(() => (now = Date.now()), 1000);
    return () => {
      pools.stop();
      clearInterval(tick);
    };
  });

  const parsed = $derived(parseBrief(previewBrief));
  const policy = $derived(describePolicy(name, parsed, pools.data ?? []));
  const liveParsed = $derived(parseBrief(brief));
  const briefError = $derived.by(() => {
    if (!briefTouched || !brief.trim()) return briefTouched ? 'Write a brief first, like “buy 3 if it drops below 0.6”.' : null;
    if (liveParsed.missing.includes('price')) return 'Add the most you will pay per unit, like “below 0.6”.';
    if (liveParsed.missing.includes('units')) return 'Say how many units to buy, like “buy 3”.';
    return null;
  });
  const briefOk = $derived(!!brief.trim() && liveParsed.missing.length === 0);

  const paused = $derived(
    result !== null && !result.ok
      ? result.status === 503
      : config.spawn !== null && (!config.spawn.enabled || config.spawn.remaining <= 0)
  );
  const rateLimited = $derived(rateUntil !== null && rateUntil > now);
  const serverDown = $derived(config.loaded && (config.server === 'none' || config.server === 'down'));
  const serverPending = $derived(!config.loaded && apiEnabled());
  const locked = $derived(busy || paused || serverDown);
  const canSubmit = $derived(
    !locked && !serverPending && !rateLimited && nameOk && briefOk && !budgetError && Number.isFinite(budget) && budget >= MIN_BUDGET && budget <= maxBudget
  );
  const minsLeft = $derived(rateUntil ? Math.max(1, Math.ceil((rateUntil - now) / 60_000)) : 0);

  const success = $derived(result?.ok ? result.data : null);
  const errorBanner = $derived(result && !result.ok && result.status !== 429 && result.status !== 503 ? result.error : null);
  let successBudget = $state(0);

  async function onsubmit(e: SubmitEvent) {
    e.preventDefault();
    nameTouched = briefTouched = budgetTouched = true;
    if (!nameOk) await checkName();
    if (!canSubmit) return;
    busy = true;
    result = null;
    const body = { name, brief: brief.trim(), budget_near: Math.round(budget * 100) / 100, ...(room?.code ? { room_code: room.code } : {}) };
    successBudget = body.budget_near;
    const res = await spawnAgent(body);
    busy = false;
    result = res;
    if (res.ok) {
      toasts.push('positive', `${name} is live`);
      void config.recheck();
    } else if (res.status === 429) {
      rateUntil = Date.now() + (res.retryAfterSec ?? 3600) * 1000;
    } else if (res.status === 400 && /name|taken|registered|exists/i.test(res.error ?? '')) {
      // the name collided on chain: show it on the field, not as a second banner
      nameCheck = 'taken';
      result = null;
    }
    // other failures are shown once, in the inline banner above the button
  }

  function txLabel(tx: SpawnResponse['txs'][number], i: number): string {
    const m = tx.method.toLowerCase();
    if (m.includes('register')) return `Register, fund ${successBudget.toFixed(2)}`;
    if (m.includes('key')) return 'Add limited key';
    if (m.includes('create') || m.includes('account')) return 'Create account';
    return ['Create account', 'Add limited key', `Register, fund ${successBudget.toFixed(2)}`][i] ?? tx.method;
  }
  const tagText = $derived(config.llm === 'on' ? 'LLM on' : config.llm === 'off' ? 'LLM off · rules parser' : 'Rules parser preview');
</script>

<svelte:head><title>Spawn agents · Co-op</title></svelte:head>

<main id="main" tabindex="-1" class="page">
  <div class="container">
    <header class="page-head">
      <div class="page-head__row">
        <div style="display:grid;gap:var(--space-4);max-inline-size:40rem">
          <h1 class="t-display-l">Spawn agents</h1>
          <p class="t-body-l text-secondary">Give it a name, a one-line brief and a budget. It gets its own {config.network} account and a key that can only join or leave pools.</p>
        </div>
        <div class="page-head__meta">
          <span class="tag"><Icon name="cpu" size="xs" />{tagText}</span>
          {#if config.spawn}<span class="mono t-body-s">{config.spawn.remaining} {config.spawn.remaining === 1 ? 'slot' : 'slots'} left</span>{/if}
        </div>
      </div>
    </header>

    {#if !codeParam || roomState === 'missing'}
      <section class="card" style="margin-block-end:var(--space-6)" aria-labelledby="pick-title">
        <div class="card__head"><h2 id="pick-title" class="card__title"><Icon name="users" />Pick a room</h2></div>
        <div class="card__body" style="display:grid;gap:var(--space-4)">
          {#if roomState === 'missing'}<Banner kind="warning" icon="alert" title="No room has code {codeParam}">Check the code with whoever sent it.</Banner>{/if}
          <form style="display:flex;gap:var(--space-3);flex-wrap:wrap;align-items:center" onsubmit={(e) => { e.preventDefault(); if (codeInput.trim().length === 6) void goto(`/spawn?code=${codeInput.trim().toUpperCase()}`); }}>
            <div class="input input--mono" style="max-inline-size:12rem"><input aria-label="Room code" maxlength="6" placeholder="CODE42" bind:value={codeInput} autocapitalize="characters" autocomplete="off" /></div>
            <button class="btn btn--primary" type="submit" disabled={codeInput.trim().length !== 6}>Use code</button>
            <a class="btn btn--ghost" href="/create">Open a new room</a>
          </form>
          {#if publicRooms.length}
            <div class="chips" aria-label="Public rooms">
              {#each publicRooms.slice(0, 6) as r (r.code)}<a class="chip" href="/spawn?code={r.code}"><Icon name="users" />{r.title} · {r.code}</a>{/each}
            </div>
          {/if}
          <p class="t-body-s text-tertiary">Without a room, the demo spawn below still works: the server pays and the agent joins any open pool.</p>
        </div>
      </section>
    {:else if room}
      <section class="card" style="margin-block-end:var(--space-6)" aria-labelledby="room-title">
        <div class="card__head">
          <h2 id="room-title" class="card__title"><Icon name="users" />{room.title}</h2>
          <span class="tag">Room <span class="mono">{room.code}</span></span>
        </div>
        <div class="card__body" style="display:grid;gap:var(--space-4)">
          <p class="t-body-s text-secondary">{room.purpose}</p>
          <div class="seg" role="group" aria-label="Who pays" style="justify-self:start">
            <button class="seg__btn" type="button" aria-pressed={mode === 'wallet'} onclick={() => (mode = 'wallet')}>My wallet</button>
            <button class="seg__btn" type="button" aria-pressed={mode === 'demo'} onclick={() => (mode = 'demo')}>Demo, server pays</button>
          </div>
          <a class="link" href="/pool?id={room.pool_id}&code={room.code}">Watch this room live</a>
        </div>
      </section>
    {/if}

    {#if walletMode && walletRoom}
      <div style="max-inline-size:44rem"><WalletSpawn room={walletRoom} /></div>
    {:else}
    <form class="spawn-layout" {onsubmit} novalidate>
      <div class="spawn-form">
        {#if success}
          <div class="card" aria-live="polite">
            <div class="card__head">
              <h2 class="card__title"><span class="text-positive"><Icon name="check-circle" /></span>{name} is live</h2>
              <span class="tag">{success.parser === 'llm' ? 'LLM' : 'rules'}</span>
            </div>
            <div class="card__body" style="display:grid;gap:var(--space-4)">
              <p class="mono t-body-s">{success.agent_id}</p>
              {#if success.txs?.length}
                <dl class="dl">
                  {#each success.txs as tx, i (tx.hash)}
                    <div class="dl__row"><dt>{txLabel(tx, i)}</dt><dd><TxChip hash={tx.hash} explorerUrl={tx.explorer_url} /></dd></div>
                  {/each}
                </dl>
              {/if}
              {#if policy.match}
                <a class="btn btn--primary btn--block" href="/pool?id={policy.match.poolId}">Watch it in pool #{policy.match.poolId}</a>
              {:else}
                <a class="btn btn--primary btn--block" href="/">See all pools</a>
              {/if}
            </div>
          </div>
        {:else}
          {#if paused}
            <div class="card">
              <div class="card__head"><h2 class="card__title"><span class="text-tertiary"><Icon name="lock" /></span>Spawning is paused</h2><span class="tag">503</span></div>
              <div class="card__body" style="display:grid;gap:var(--space-4)">
                <p class="t-body-s text-secondary">All demo slots are in use. The pools are still live, and you can watch them settle.</p>
                {#if pools.data?.[0]}<a class="btn btn--secondary btn--block" href="/pool?id={(pools.data.find((p) => p.status === 'Open') ?? pools.data[0]).id}">Watch pool #{(pools.data.find((p) => p.status === 'Open') ?? pools.data[0]).id}</a>{/if}
              </div>
            </div>
          {:else if serverDown}
            <Banner kind="warning" icon="alert" title="Spawning is unavailable right now" role="status">
              The pools are still live to watch.
              {#snippet actions()}<button class="btn btn--ghost btn--sm" type="button" onclick={() => config.recheck()}>Retry</button>{/snippet}
            </Banner>
          {:else if rateLimited}
            <div class="card">
              <div class="card__head"><h2 class="card__title"><span class="text-warning"><Icon name="clock" /></span>Hourly limit reached</h2><span class="tag">429</span></div>
              <div class="card__body"><p class="t-body-s text-secondary">Each network can spawn 3 agents per hour. You can spawn the next one at {fmtClock(rateUntil!)} UTC. Your agents keep running.</p></div>
            </div>
          {/if}

          <div class="field">
            <div class="field__label-row"><label class="field__label" for="name">Agent name</label></div>
            <div class="input input--mono" data-valid={nameOk ? '' : undefined} data-invalid={nameError ? '' : undefined} data-disabled={locked ? '' : undefined}>
              <input
                id="name" name="name" bind:value={name} placeholder="rin" autocomplete="off" autocapitalize="none" spellcheck="false" disabled={locked}
                aria-invalid={nameError ? 'true' : undefined} aria-describedby="name-msg"
                oninput={() => { name = name.toLowerCase(); nameCheck = 'idle'; }} onblur={checkName}
              />
              <span class="input__affix">{suffix}</span>
            </div>
            <p class="field__msg {nameError ? 'field__msg--error' : nameOk ? 'field__msg--ok' : 'field__hint'}" id="name-msg" class:field__hint={!nameError && !nameOk}>
              {#if nameError}<Icon name="alert" />{nameError}
              {:else if nameOk && !locked}<Icon name="check-circle" />{name}{suffix} is available
              {:else if nameCheck === 'checking'}Checking {name}{suffix}
              {:else}Lowercase letters, digits and hyphens. 2 to 24 characters.{/if}
            </p>
          </div>

          <div class="field">
            <div class="field__label-row"><label class="field__label" for="brief">Brief</label><span class="field__counter" aria-live="polite">{brief.length} / 140</span></div>
            <div class="input" data-invalid={briefError ? '' : undefined} data-valid={briefOk && briefTouched ? '' : undefined} data-disabled={locked ? '' : undefined}>
              <input id="brief" name="brief" bind:value={brief} maxlength="140" autocomplete="off" disabled={locked}
                placeholder="buy 3 API credits if the price drops below 0.6"
                aria-invalid={briefError ? 'true' : undefined} aria-describedby="brief-hint" onblur={() => (briefTouched = true)} />
            </div>
            {#if briefError}
              <p class="field__msg field__msg--error" id="brief-hint"><Icon name="alert" />{briefError}</p>
            {:else}
              <p class="field__hint" id="brief-hint">Say how many units and the most you will pay per unit, in plain words.</p>
            {/if}
            <div class="chips" aria-label="Example briefs">
              {#each EXAMPLES as ex (ex)}
                <button class="chip" type="button" disabled={locked} onclick={() => { brief = ex; briefTouched = true; }}><Icon name="plus" />{ex}</button>
              {/each}
            </div>
          </div>

          <div class="field">
            <div class="field__label-row"><label class="field__label" for="budget">Budget</label><span class="field__opt">{config.network} NEAR</span></div>
            <div class="range-row">
              <div class="range">
                <input id="budget" type="range" min={MIN_BUDGET} max={maxBudget} step="0.05" disabled={locked}
                  value={Number.isFinite(budget) ? Math.min(Math.max(budget, MIN_BUDGET), maxBudget) : maxBudget}
                  style="--pct:{pct}" aria-describedby="budget-hint"
                  oninput={(e) => { budgetTouched = true; budgetText = Number(e.currentTarget.value).toFixed(2); }} />
                <div class="range__scale" aria-hidden="true"><span>{MIN_BUDGET.toFixed(2)}</span><span>{((MIN_BUDGET + maxBudget) / 2).toFixed(2)}</span><span>{maxBudget.toFixed(2)} max</span></div>
              </div>
              <div class="input input--number" data-invalid={budgetError ? '' : undefined} data-disabled={locked ? '' : undefined}>
                <input inputmode="decimal" aria-label="Budget in NEAR" bind:value={budgetText} disabled={locked}
                  aria-invalid={budgetError ? 'true' : undefined} oninput={() => (budgetTouched = true)} onblur={() => (budgetTouched = true)} />
                <span class="input__affix">NEAR</span>
              </div>
            </div>
            {#if budgetError}
              <p class="field__msg field__msg--error" id="budget-hint"><Icon name="alert" />{budgetError}</p>
            {:else}
              <p class="field__hint" id="budget-hint">Demo mode: paid from the operator account and capped at {maxBudget.toFixed(2)}. The contract never lets the agent spend more than this.</p>
            {/if}
          </div>
        {/if}
      </div>

      <aside class="spawn-aside" aria-labelledby="policy-title">
        <section class="card">
          <div class="card__head">
            <h2 id="policy-title" class="card__title">Parsed policy</h2>
            <span class="live-dot" data-state="paused">Updates as you type</span>
          </div>
          <div class="card__body" style="display:grid;gap:var(--space-5)">
            <p class="policy-sentence" aria-live="polite">
              {#if policy.ok}
                {#each policy.sentenceParts as p, i (i)}{#if p.t === 'mark'}<mark>{p.v}</mark>{:else if p.t === 'name'}<span class="mono" style="font-size:.82em">{p.v}</span>{:else}{p.v}{/if}{/each}
              {:else}
                <span class="text-tertiary">{brief.trim() ? 'The brief needs a unit count and a price ceiling.' : 'Write a brief and the policy appears here.'}</span>
              {/if}
            </p>
            <dl class="dl">
              <div class="dl__row"><dt>Archetype</dt>{#if policy.archetype}<dd><span class="tag">{policy.archetype}</span></dd>{:else}<dd class="is-empty">{previewBrief.trim() ? 'Not found' : 'None yet'}</dd>{/if}</div>
              <div class="dl__row"><dt>Max price per unit</dt>
                {#if policy.maxPriceText}<dd>{policy.maxPriceText}<span class="unit">NEAR</span></dd>
                {:else if policy.maxPriceNote}<dd>{policy.maxPriceNote}</dd>
                {:else}<dd class="is-empty">{previewBrief.trim() ? 'Not found' : 'None yet'}</dd>{/if}
              </div>
              <div class="dl__row"><dt>Units</dt>{#if policy.unitsText}<dd>{policy.unitsText}</dd>{:else}<dd class="is-empty">{previewBrief.trim() ? 'Not found' : 'None yet'}</dd>{/if}</div>
              <div class="dl__row"><dt>Joins</dt>{#if policy.joinsText}<dd>{policy.joinsText}</dd>{:else}<dd class="is-empty">{previewBrief.trim() ? 'Not found' : 'None yet'}</dd>{/if}</div>
              <div class="dl__row"><dt>Locks at most</dt>{#if policy.locksText}<dd>{policy.locksText}<span class="unit">NEAR</span></dd>{:else}<dd class="is-empty">{previewBrief.trim() ? 'Not found' : 'None yet'}</dd>{/if}</div>
              <div class="dl__row"><dt>Best match now</dt>
                {#if policy.match}<dd><a class="link" href="/pool?id={policy.match.poolId}">Pool #{policy.match.poolId} at {formatNear(policy.match.price)}</a></dd>
                {:else if policy.ok}<dd class="is-empty">No open pool fits yet</dd>
                {:else}<dd class="is-empty">{previewBrief.trim() ? 'Not found' : 'None yet'}</dd>{/if}
              </div>
            </dl>
          </div>
          <div class="card__foot" style="display:flex;gap:var(--space-3);align-items:start">
            <Icon name="info" size="sm" />
            <span>
              {#if config.llm === 'on'}Read by the language model when you submit; this preview uses the rules parser. The contract enforces the limits; the model only proposes them.
              {:else}Read by the rules parser because no LLM is configured. The contract enforces the limits; the parser only proposes them.{/if}
            </span>
          </div>
        </section>
      </aside>

      {#if !success}
        <div class="form-foot">
          {#if errorBanner}
            <div style="inline-size:100%"><Banner kind="negative" icon="alert" title="Could not spawn the agent" role="alert">{errorBanner}</Banner></div>
          {/if}
          <button class="btn btn--primary btn--lg" type="submit" disabled={!canSubmit && !busy} aria-busy={busy ? 'true' : undefined}>
            {#if busy}<span class="spinner"></span>Spawning{:else if rateLimited}Spawn agent · in {minsLeft} min{:else}Spawn agent <Icon name="arrow-right" />{/if}
          </button>
          <p class="form-foot__note">Creates the account, adds a key limited to <span class="code">join_pool</span> and <span class="code">leave_pool</span>, then registers and funds the agent. About 10 seconds.</p>
        </div>
      {/if}
    </form>
    {/if}
  </div>
</main>
