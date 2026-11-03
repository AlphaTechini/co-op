<script lang="ts">
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { splitAccount } from '#lib/format.ts';
  import { archetypeOf, memberStates, type MemberStateModel } from '#lib/members.ts';
  import type { MemberView, PoolView } from '#lib/models.ts';
  import Icon from './Icon.svelte';

  let {
    pool,
    members,
    flipped,
    archetypes
  }: { pool: PoolView; members: MemberView[]; flipped: ReadonlySet<string>; archetypes: Record<string, string> } = $props();

  const states = $derived(memberStates(pool, members));
  const after = $derived(pool.status === 'Settled' || pool.status === 'Refunded' || pool.result !== null);

  type Row =
    | { type: 'head'; key: string; label: string; cond: boolean; meta: string; second: boolean }
    | { type: 'member'; key: string; m: MemberView; st: MemberStateModel };

  const rows = $derived.by(() => {
    const groups: Array<{ id: string; label: string; cond: boolean; list: Row[]; agents: number; units: number }> = [];
    const defs = after
      ? [
          { id: 'filled', label: 'Filled', cond: false },
          { id: 'in', label: 'Settling', cond: false },
          { id: 'excluded', label: pool.status === 'Refunded' ? 'Refunded' : 'Excluded', cond: false }
        ]
      : [
          { id: 'in', label: 'In the group', cond: false },
          { id: 'waiting', label: 'Waiting on a condition', cond: true }
        ];
    for (const d of defs) groups.push({ ...d, list: [], agents: 0, units: 0 });
    for (const m of members) {
      const st = states.get(m.agent_id)!;
      const g = groups.find((x) => x.id === st.group);
      if (!g) continue;
      g.list.push({ type: 'member', key: m.agent_id, m, st });
      g.agents += 1;
      g.units += m.units;
    }
    const out: Row[] = [];
    let first = true;
    for (const g of groups) {
      if (!g.list.length) continue;
      out.push({
        type: 'head', key: `head-${g.id}`, label: g.label, cond: g.cond,
        meta: `${g.agents} ${g.agents === 1 ? 'agent' : 'agents'} · ${g.units} ${g.units === 1 ? 'unit' : 'units'}`,
        second: !first
      });
      first = false;
      out.push(...g.list);
    }
    return out;
  });

  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
</script>

<ul class="members" aria-label="Pool members, in join order within each group">
  {#each rows as r (r.key)}
    <li
      class={r.type === 'head' ? `members__group-head${r.second ? ' members__group-head--next' : ''}` : 'member'}
      data-state={r.type === 'member' ? r.st.row : undefined}
      data-flipped={r.type === 'member' && flipped.has(r.m.agent_id) ? '' : undefined}
      animate:flip={{ duration: reduce ? 0 : 360, easing: cubicOut }}
    >
      {#if r.type === 'head'}
        <span class:text-conditional={r.cond}>{r.label}</span><span class="mono text-tertiary">{r.meta}</span>
      {:else}
        {@const a = archetypeOf(r.m.agent_id, archetypes[r.m.agent_id])}
        {@const [label, suffix] = splitAccount(r.m.agent_id)}
        <span class="member__glyph" aria-hidden="true">{a.letter}</span>
        <div class="member__main">
          <span class="member__id" title={r.m.agent_id}>{label}<span class="member__suffix">{suffix}</span></span>
          {#if r.m.memo.trim()}<p class="member__memo">{r.m.memo}</p>{/if}
        </div>
        <span class="member__units">{r.m.units}<span class="unit">u</span></span>
        <span class="mstate" data-state={r.st.pill === 'committed' ? undefined : r.st.pill}>
          {#if r.st.check}<Icon name="check" size="xs" />{:else}<span class="mstate__ring"></span>{/if}{r.st.text}
        </span>
      {/if}
    </li>
  {/each}
</ul>

<style>
  .members__group-head--next {
    border-block-start: 1px solid var(--border);
  }
  .members__group-head {
    list-style: none;
  }
</style>
