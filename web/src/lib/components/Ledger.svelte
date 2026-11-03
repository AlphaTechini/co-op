<script lang="ts">
  import { formatNear, formatNearExact, splitAccount } from '#lib/format.ts';
  import { archetypeOf } from '#lib/members.ts';
  import type { TxRef } from '#lib/models.ts';
  import type { Receipt } from '#lib/proof.ts';
  import Icon from './Icon.svelte';
  import TxChip from './TxChip.svelte';

  let {
    receipt,
    archetypes,
    joinTx,
    hasServer
  }: { receipt: Receipt; archetypes: Record<string, string>; joinTx: ReadonlyMap<string, TxRef>; hasServer: boolean } = $props();

  const t = $derived(receipt.totals);
  const delivered = $derived(receipt.rows.filter((r) => r.filled && r.member.delivery === 'Delivered').reduce((a, r) => a + r.units, 0));
  const exactTotal = $derived(t.locked);
  const equal = $derived(t.locked === t.paid + t.refunded + t.storage);
</script>

<div class="card">
  <div class="card__head">
    <h2 id="ledger-title" class="card__title">Per agent <span class="card__count">{receipt.rows.length}</span></h2>
    <span class="t-body-s text-tertiary">All amounts in NEAR</span>
  </div>
  <div style="overflow-x:auto">
    <table class="ledger">
      <thead>
        <tr>
          <th scope="col">Agent</th><th scope="col" class="num">Units</th><th scope="col" class="num">Paid per unit / limit</th>
          <th scope="col" class="num">Paid</th><th scope="col" class="num">Refund</th><th scope="col">Delivery</th><th scope="col">Joined in</th>
        </tr>
      </thead>
      <tbody>
        {#each receipt.rows as r (r.member.agent_id)}
          {@const m = r.member}
          {@const a = archetypeOf(m.agent_id, archetypes[m.agent_id])}
          {@const [label, suffix] = splitAccount(m.agent_id)}
          <tr>
            <td class="ledger__cell-agent" data-label="Agent">
              <span class="ledger__agent"><span class="member__glyph" aria-hidden="true">{a.letter}</span><span class="ledger__id" title={m.agent_id}>{label}<span class="member__suffix">{suffix}</span></span>{#if m.threshold_units !== null}<span class="tag">if {'≥'} {m.threshold_units}</span>{/if}</span>
            </td>
            <td class="num" data-label="Units">{r.units}</td>
            <td class="num ledger__cell-headroom" data-label="Paid per unit vs limit">
              {#if r.filled && r.perUnit !== null && r.limit !== null && r.permille !== null}
                <span class="headroom" title="Paid {formatNear(r.perUnit)} per unit. Limit {formatNear(r.limit)}. {formatNear(r.limit - r.perUnit)} under.">
                  <span class="headroom__text"><b>{formatNear(r.perUnit)}</b><span>{' / '}{formatNear(r.limit)}</span></span>
                  <span class="headroom__bar" style="--ratio:{(r.permille / 10).toFixed(1)}%" aria-hidden="true"></span>
                </span>
              {:else if r.filled && r.perUnit !== null}
                <span class="text-tertiary" title="The agent's limit could not be read">{formatNear(r.perUnit)} / {'–'}</span>
              {:else}
                <span class="text-tertiary">{m.outcome === 'Refunded' ? 'Refunded' : 'Excluded'}</span>
              {/if}
            </td>
            <td class="num num--strong" data-label="Paid">{formatNearExact(r.paid, 2)}</td>
            <td class="num" class:is-muted={r.refunded === 0n} data-label="Refund">{formatNearExact(r.refunded, 2)}</td>
            <td data-label="Delivery">
              {#if !r.filled}<span class="delivery" data-state="pending" style="color:var(--text-disabled)">{'–'}</span>
              {:else if m.delivery === 'Delivered'}<span class="delivery" data-state="delivered"><Icon name="check-circle" />{r.units} delivered</span>
              {:else if m.delivery === 'Claimable'}<span class="delivery" data-state="claimable"><Icon name="alert" />Claimable</span>
              {:else}<span class="delivery" data-state="pending"><Icon name="clock" />Pending</span>{/if}
            </td>
            <td class="ledger__cell-tx" data-label="Joined in">
              {#if joinTx.get(m.agent_id)}{@const tx = joinTx.get(m.agent_id)!}<TxChip hash={tx.hash} explorerUrl={tx.explorer_url} />{:else}<span class="text-disabled" title={hasServer ? 'No transaction recorded' : 'Needs the Co-op server'}>{'–'}</span>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
      <tfoot>
        <tr>
          <td data-label="Agents">{receipt.rows.length} {receipt.rows.length === 1 ? 'agent' : 'agents'}</td>
          <td class="num" data-label="Units">{t.units}</td>
          <td class="num" data-label="Price">{receipt.unitPrice ? `${formatNear(receipt.unitPrice)} for all` : '–'}</td>
          <td class="num num--strong" data-label="Paid">{formatNearExact(t.paid, 2)}</td>
          <td class="num" data-label="Refunded">{formatNearExact(t.refunded, 2)}</td>
          <td data-label="Delivered">{delivered} of {t.units}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  </div>
  <div class="card__foot" style="display:grid;gap:var(--space-4)">
    <span>Every lock reconciles: what an agent locked is what it paid, plus its refund, plus 0.00125 NEAR to register it on the voucher token.</span>
    {#if equal}
      <div class="equation" aria-label="Locked {formatNearExact(exactTotal, 3)} equals paid {formatNearExact(t.paid, 3)} plus refunded {formatNearExact(t.refunded, 3)} plus storage {formatNearExact(t.storage, 3)}">
        <span class="equation__term equation__term--total"><span class="equation__label">Locked</span><span class="equation__value">{formatNearExact(exactTotal, 3)}</span></span>
        <span class="equation__op">=</span>
        <span class="equation__term"><span class="equation__label">Paid to seller</span><span class="equation__value">{formatNearExact(t.paid, 3)}</span></span>
        <span class="equation__op">+</span>
        <span class="equation__term"><span class="equation__label">Refunded</span><span class="equation__value">{formatNearExact(t.refunded, 3)}</span></span>
        <span class="equation__op">+</span>
        <span class="equation__term"><span class="equation__label">Storage</span><span class="equation__value">{formatNearExact(t.storage, 3)}</span></span>
      </div>
    {/if}
  </div>
</div>
