<script lang="ts">
  import { activateWalletAgents, prepareWalletAgents } from '#lib/api.ts';
  import { buildAgentBatch, downloadKeys, saveKeys, type AgentKey } from '#lib/agent-txs.ts';
  import { parseBrief } from '#lib/brief.ts';
  import { config } from '#lib/config.svelte.ts';
  import { STORAGE_RESERVE, formatNear } from '#lib/format.ts';
  import type { Room } from '#lib/models.ts';
  import { toasts } from '#lib/stores/toasts.svelte.ts';
  import { FEE_RESERVE, wallet } from '#lib/wallet.svelte.ts';
  import Banner from './Banner.svelte';
  import Icon from './Icon.svelte';
  import TxChip from './TxChip.svelte';

  let { room }: { room: Room & { code: string } } = $props();

  const YOCTO_PER_MICRO = 10n ** 18n;
  const gasPerAgent = $derived(config.agentGas ?? 120_000_000_000_000_000_000_000n);
  const HEADROOM = 20_000_000_000_000_000_000_000n; // MEMBERSHIP_STORAGE_HEADROOM
  const maxBatch = $derived(config.maxBatch ?? 5);
  const unit = $derived(room.unit);
  const examples = $derived([`buy 4 ${unit}s now, up to 0.05 each`, `buy 4 ${unit}s if the price drops below 0.04`, `buy 5 ${unit}s only at the 50-unit price`]);

  let name = $state('');
  let count = $state(2);
  let brief = $state('');
  let totalText = $state('0.5');
  let busy = $state<null | 'prepare' | 'sign' | 'activate'>(null);
  let error = $state<string | null>(null);
  let done = $state<{ agents: Array<{ id: string; state: string }>; hashes: string[]; keys: AgentKey[]; ownerKeys: boolean } | null>(null);

  const parsed = $derived(parseBrief(brief));
  const total = $derived(Number.parseFloat(totalText.replace(',', '.')));
  const totalYocto = $derived(Number.isFinite(total) && total > 0 ? BigInt(Math.round(total * 1e6)) * YOCTO_PER_MICRO : 0n);
  const perAgent = $derived(count > 0 ? totalYocto / BigInt(count) : 0n);
  const neededEach = $derived(parsed.units !== null && parsed.maxPrice !== null ? BigInt(parsed.units) * parsed.maxPrice + STORAGE_RESERVE + HEADROOM : null);
  const maxTotal = $derived(wallet.spendable === null ? null : wallet.spendable - FEE_RESERVE - gasPerAgent * BigInt(count));

  const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,14}[a-z0-9])?$/;
  const nameError = $derived(name && (!NAME_RE.test(name) || name.includes('--')) ? 'Lowercase letters, digits and hyphens, 2 to 16 characters.' : null);
  const briefError = $derived(brief.trim() && parsed.missing.length > 0 ? (parsed.missing.includes('price') ? 'Add the most you will pay per unit, like “below 0.04”.' : 'Say how many units each agent buys, like “buy 4”.') : null);
  const totalError = $derived.by(() => {
    if (!totalYocto) return 'Enter how much NEAR to put behind the agents.';
    if (maxTotal !== null && totalYocto > maxTotal) return maxTotal > 0n ? `Your wallet can put at most ${formatNear(maxTotal)} NEAR behind ${count} agents (after gas and fees).` : 'Your wallet balance is too low. Top it up from the faucet first.';
    if (neededEach !== null && perAgent < neededEach) return `Each agent needs at least ${formatNear(neededEach)} NEAR for this brief; ${count} agents need ${formatNear(neededEach * BigInt(count))}.`;
    return null;
  });
  const canSubmit = $derived(!busy && !!wallet.accountId && !!name && !nameError && !!brief.trim() && !briefError && !totalError);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!canSubmit || !wallet.accountId) return;
    error = null;
    const owner = wallet.accountId;
    busy = 'prepare';
    const prep = await prepareWalletAgents({ owner, room_code: room.code, name, count, brief: brief.trim(), total_near: Math.round(total * 1e6) / 1e6 });
    if (!prep.ok) {
      busy = null;
      error = prep.error;
      return;
    }
    const batch = await buildAgentBatch(prep.data);
    busy = 'sign';
    let hashes: string[];
    try {
      hashes = await wallet.signAndSend(batch.transactions);
    } catch (err) {
      busy = null;
      error = err instanceof Error && err.message ? `The wallet did not send the transactions: ${err.message}` : 'The wallet did not send the transactions.';
      return;
    }
    saveKeys(owner, batch.keys);
    busy = 'activate';
    const ids = prep.data.agents.map((a) => a.agent_id);
    let states: Array<{ agent_id: string; state: string }> = ids.map((id) => ({ agent_id: id, state: 'waiting' }));
    for (let i = 0; i < 20 && states.some((s) => s.state === 'waiting'); i++) {
      const res = await activateWalletAgents({ owner, agent_ids: ids });
      if (res.ok) states = res.data.agents;
      if (states.some((s) => s.state === 'waiting')) await new Promise((r) => setTimeout(r, 3000));
    }
    busy = null;
    done = { agents: states.map((s) => ({ id: s.agent_id, state: s.state })), hashes, keys: batch.keys, ownerKeys: batch.ownerKeys };
    toasts.push('positive', `${states.filter((s) => s.state === 'running').length} of ${ids.length} agents are live`);
  }
</script>

{#if !wallet.accountId}
  <div class="card">
    <div class="card__head"><h2 class="card__title"><Icon name="key" />Connect your wallet</h2><span class="tag">{config.network}</span></div>
    <div class="card__body" style="display:grid;gap:var(--space-4)">
      <p class="t-body-s text-secondary">Your agents are created as sub-accounts of your wallet and funded from it. You stay their owner on chain: refunds and leftovers go back to you. The server only gets a key that can join or leave this room's pool.</p>
      {#if wallet.error}<Banner kind="negative" icon="alert" title="Wallet">{wallet.error}</Banner>{/if}
      <button class="btn btn--primary btn--block" type="button" onclick={() => wallet.connect()} disabled={wallet.busy}>
        {#if wallet.busy}<span class="spinner"></span>Connecting{:else}Connect wallet{/if}
      </button>
    </div>
  </div>
{:else if done}
  <div class="card" aria-live="polite">
    <div class="card__head"><h2 class="card__title"><span class="text-positive"><Icon name="check-circle" /></span>Your agents are in room {room.code}</h2></div>
    <div class="card__body" style="display:grid;gap:var(--space-4)">
      <dl class="dl">
        {#each done.agents as a (a.id)}
          <div class="dl__row"><dt class="mono">{a.id}</dt><dd>{a.state === 'running' ? 'running' : a.state === 'waiting' ? 'starting' : 'not started'}</dd></div>
        {/each}
      </dl>
      {#if done.hashes.some(Boolean)}
        <div class="chips">{#each done.hashes.filter(Boolean) as h (h)}<TxChip hash={h} />{/each}</div>
      {/if}
      {#if done.ownerKeys}
        <button class="btn btn--secondary btn--block" type="button" onclick={() => downloadKeys(wallet.accountId ?? 'agents', done?.keys ?? [])}><Icon name="arrow-down" />Download agent keys</button>
        <p class="t-body-s text-tertiary">Each agent account holds the units it buys. These full-access keys were made in this browser and never sent anywhere; keep the file to move the units later.</p>
      {/if}
      <a class="btn btn--primary btn--block" href="/pool?id={room.pool_id}&code={room.code}">Watch the room live</a>
    </div>
  </div>
{:else}
  <form class="card" onsubmit={submit} novalidate>
    <div class="card__head">
      <h2 class="card__title"><Icon name="cpu" />Spawn agents from your wallet</h2>
      <button class="btn btn--ghost btn--sm" type="button" onclick={() => wallet.disconnect()}>Disconnect</button>
    </div>
    <div class="card__body" style="display:grid;gap:var(--space-5)">
      <dl class="dl">
        <div class="dl__row"><dt>Wallet</dt><dd>{wallet.accountId}</dd></div>
        <div class="dl__row"><dt>Spendable</dt><dd>{wallet.spendable === null ? '…' : formatNear(wallet.spendable)}<span class="unit">NEAR</span></dd></div>
      </dl>

      <div class="field">
        <label class="field__label" for="w-name">Agent name</label>
        <div class="input input--mono" data-invalid={nameError ? '' : undefined}>
          <input id="w-name" bind:value={name} placeholder="rin" autocomplete="off" autocapitalize="none" spellcheck="false" oninput={() => (name = name.toLowerCase())} />
          <span class="input__affix">-1.{wallet.accountId}</span>
        </div>
        {#if nameError}<p class="field__msg field__msg--error"><Icon name="alert" />{nameError}</p>{:else}<p class="field__hint">Agents are named {name || 'rin'}-1, {name || 'rin'}-2 and so on, under your account.</p>{/if}
      </div>

      <div class="field">
        <span class="field__label" id="w-count">How many agents</span>
        <div class="seg" role="group" aria-labelledby="w-count">
          {#each Array.from({ length: maxBatch }, (_, i) => i + 1) as n (n)}
            <button class="seg__btn" type="button" aria-pressed={count === n} onclick={() => (count = n)}>{n}</button>
          {/each}
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="w-brief">Brief for every agent</label>
        <div class="input" data-invalid={briefError ? '' : undefined}>
          <input id="w-brief" bind:value={brief} maxlength="140" autocomplete="off" placeholder={examples[1]} />
        </div>
        {#if briefError}<p class="field__msg field__msg--error"><Icon name="alert" />{briefError}</p>{:else}<p class="field__hint">Units per agent and the most each pays per {unit}. Entry price here is 0.05; 20 units in the room unlock 0.035.</p>{/if}
        <div class="chips">{#each examples as ex (ex)}<button class="chip" type="button" onclick={() => (brief = ex)}><Icon name="plus" />{ex}</button>{/each}</div>
      </div>

      <div class="field">
        <label class="field__label" for="w-total">Total NEAR for the agents</label>
        <div class="input input--number" data-invalid={totalError && totalText ? '' : undefined}>
          <input id="w-total" inputmode="decimal" bind:value={totalText} />
          <span class="input__affix">NEAR</span>
        </div>
        {#if totalError}<p class="field__msg field__msg--error"><Icon name="alert" />{totalError}</p>
        {:else}<p class="field__hint">{formatNear(perAgent)} NEAR budget per agent, locked in the contract, plus {formatNear(gasPerAgent)} NEAR on each agent account for gas. The contract never lets an agent spend more than its own limit.</p>{/if}
      </div>

      {#if error}<Banner kind="negative" icon="alert" title="Could not spawn the agents" role="alert">{error}</Banner>{/if}

      <button class="btn btn--primary btn--lg btn--block" type="submit" disabled={!canSubmit} aria-busy={busy ? 'true' : undefined}>
        {#if busy === 'prepare'}<span class="spinner"></span>Preparing keys
        {:else if busy === 'sign'}<span class="spinner"></span>Approve in your wallet
        {:else if busy === 'activate'}<span class="spinner"></span>Starting agents
        {:else}Spawn {count} {count === 1 ? 'agent' : 'agents'} <Icon name="arrow-right" />{/if}
      </button>
      <p class="t-body-s text-tertiary">One approval in your wallet: {count * 2} transactions (create each agent account, then register it with its budget).</p>
    </div>
  </form>
{/if}
