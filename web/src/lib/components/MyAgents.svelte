<script lang="ts">
  import { listAgentsOwnedBy } from '#lib/chain.ts';
  import { config } from '#lib/config.svelte.ts';
  import { formatNear, sumBig } from '#lib/format.ts';
  import type { AgentView } from '#lib/models.ts';
  import { toasts } from '#lib/stores/toasts.svelte.ts';
  import { wallet } from '#lib/wallet.svelte.ts';
  import Banner from './Banner.svelte';
  import Icon from './Icon.svelte';
  import TxChip from './TxChip.svelte';

  // Leftover budget stays in the contract after a pool settles; only the owner can pull it back with
  // `withdraw` (1 yoctoNEAR attached, so the agents' own join/leave keys can never call it).
  const WITHDRAW_GAS = '30000000000000';

  let agents = $state<AgentView[] | null>(null);
  let loadError = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let hashes = $state<string[]>([]);

  async function load(owner: string) {
    loadError = null;
    try {
      agents = await listAgentsOwnedBy(owner);
    } catch {
      loadError = `Could not read your agents from ${config.network} right now.`;
    }
  }

  $effect(() => {
    const owner = wallet.accountId;
    agents = null;
    hashes = [];
    if (owner && config.contractId) void load(owner);
  });

  const withdrawable = $derived((agents ?? []).filter((a) => BigInt(a.budget_available) > 0n));
  const totalFree = $derived(sumBig(withdrawable.map((a) => BigInt(a.budget_available))));
  const totalLocked = $derived(sumBig((agents ?? []).map((a) => BigInt(a.budget_locked))));

  async function withdrawAll() {
    if (!wallet.accountId || withdrawable.length === 0) return;
    busy = true;
    error = null;
    try {
      hashes = await wallet.signAndSend(
        withdrawable.map((a) => ({
          receiverId: config.contractId,
          actions: [{ type: 'FunctionCall', params: { methodName: 'withdraw', args: { agent_id: a.agent_id }, gas: WITHDRAW_GAS, deposit: '1' } }]
        }))
      );
      toasts.push('positive', `${formatNear(totalFree)} NEAR sent back to ${wallet.accountId}`);
      await load(wallet.accountId);
    } catch (e) {
      error = e instanceof Error && e.message ? `The wallet did not send the withdrawals: ${e.message}` : 'The wallet did not send the withdrawals.';
    } finally {
      busy = false;
    }
  }
</script>

{#if !wallet.accountId}
  <div class="card">
    <div class="card__body" style="display:grid;gap:var(--space-4)">
      <p class="t-body-s text-secondary">Connect the wallet that spawned your agents to see their budgets and withdraw what is left.</p>
      <button class="btn btn--primary" type="button" onclick={() => wallet.connect()} disabled={wallet.busy}>{wallet.busy ? 'Connecting' : 'Connect wallet'}</button>
    </div>
  </div>
{:else}
  <section class="card" aria-labelledby="mine-title">
    <div class="card__head">
      <h2 id="mine-title" class="card__title"><Icon name="bot" />Agents owned by <span class="mono">{wallet.accountId}</span></h2>
      <button class="btn btn--ghost btn--sm" type="button" onclick={() => wallet.accountId && load(wallet.accountId)}><Icon name="refresh" size="sm" />Refresh</button>
    </div>
    <div class="card__body" style="display:grid;gap:var(--space-5)">
      {#if loadError}
        <Banner kind="warning" icon="alert" title="Agents unavailable">{loadError}</Banner>
      {:else if agents === null}
        <span class="skeleton" style="inline-size:60%" aria-busy="true"></span>
      {:else if agents.length === 0}
        <p class="t-body-s text-secondary">No agents are registered to this wallet yet. Spawn some from a room.</p>
      {:else}
        <dl class="dl">
          <div class="dl__row"><dt>Ready to withdraw</dt><dd>{formatNear(totalFree)}<span class="unit">NEAR</span></dd></div>
          <div class="dl__row"><dt>Still locked in open pools</dt><dd>{formatNear(totalLocked)}<span class="unit">NEAR</span></dd></div>
        </dl>

        <div class="mine-list">
          {#each agents as a (a.agent_id)}
            <div class="mine-row">
              <span class="mono t-body-s">{a.agent_id}</span>
              <span class="t-body-s text-secondary">{a.active_pools.length ? `in pool ${a.active_pools.map((p) => `#${p}`).join(', ')}` : 'idle'}</span>
              <span class="mono t-body-s mine-row__num">{formatNear(a.budget_available)} free</span>
            </div>
          {/each}
        </div>

        {#if error}<Banner kind="negative" icon="alert" title="Withdraw failed" role="alert">{error}</Banner>{/if}
        <button class="btn btn--primary btn--block" type="button" disabled={busy || withdrawable.length === 0} onclick={withdrawAll} aria-busy={busy ? 'true' : undefined}>
          {#if busy}<span class="spinner"></span>Approve in your wallet
          {:else if withdrawable.length === 0}Nothing to withdraw
          {:else}Withdraw {formatNear(totalFree)} NEAR to my wallet{/if}
        </button>
        <p class="t-body-s text-tertiary">
          One approval, one <span class="code">withdraw</span> per agent with a free balance. Budget locked in a pool that has not settled yet stays there until it does. The NEAR left on each agent account for gas is separate and stays with the agent.
        </p>
        {#if hashes.some(Boolean)}<div class="chips">{#each hashes.filter(Boolean) as h (h)}<TxChip hash={h} />{/each}</div>{/if}
      {/if}
    </div>
  </section>
{/if}

<style>
  .mine-list {
    display: grid;
    gap: var(--space-2);
  }
  .mine-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--space-4);
    align-items: center;
    padding-block: var(--space-2);
    border-block-end: 1px solid var(--border-subtle);
    overflow-wrap: anywhere;
  }
  .mine-row__num {
    text-align: end;
  }
  @media (max-width: 599px) {
    .mine-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
    .mine-row > :nth-child(2) {
      grid-column: 1 / -1;
      grid-row: 2;
    }
  }
</style>
