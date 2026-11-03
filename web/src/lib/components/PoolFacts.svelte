<script lang="ts">
  import { formatNear, formatNearExact, sumBig } from '#lib/format.ts';
  import type { LadderModel } from '#lib/ladder.ts';
  import type { MemberView, PoolView } from '#lib/models.ts';

  let { pool, members, model }: { pool: PoolView; members: MemberView[]; model: LadderModel } = $props();

  const waiting = $derived(members.filter((m) => m.threshold_units !== null && !m.projected_in && m.outcome === null).length);
  const escrow = $derived(sumBig(members.map((m) => BigInt(m.locked))));
  const price = $derived((pool.result ?? pool.projected).unit_price);
  const saved = $derived.by(() => {
    if (model.tierIndex === null || model.tierIndex === 0 || !price) return 0n;
    return BigInt(model.inUnits) * (BigInt(pool.offer.tiers[0].unit_price) - BigInt(price));
  });
</script>

<dl class="pool-facts">
  <div class="stat"><dt class="stat__label">Units in</dt><dd class="stat__value">{model.inUnits}<span class="unit">/ {pool.offer.max_units}</span></dd><dd class="stat__meta">{model.pledged} pledged</dd></div>
  <div class="stat"><dt class="stat__label">Agents</dt><dd class="stat__value">{pool.member_count}</dd><dd class="stat__meta">{pool.projected.members_in} in, {waiting} waiting</dd></div>
  <div class="stat"><dt class="stat__label">Escrowed</dt><dd class="stat__value" title="{formatNearExact(escrow, 2)} NEAR">{formatNear(escrow, { min: 2, max: 2 })}<span class="unit">NEAR</span></dd><dd class="stat__meta">locked by {members.length} {members.length === 1 ? 'agent' : 'agents'}</dd></div>
  <div class="stat"><dt class="stat__label">Saved vs list</dt><dd class="stat__value" class:text-positive={saved > 0n} title="{formatNearExact(saved, 2)} NEAR">{formatNear(saved, { min: 2, max: 2 })}<span class="unit">NEAR</span></dd><dd class="stat__meta">{saved > 0n ? 'if settled now' : 'at list price'}</dd></div>
</dl>
