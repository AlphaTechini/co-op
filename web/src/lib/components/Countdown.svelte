<script lang="ts">
  import { fmtClock, fmtCountdown, nsToMs } from '#lib/format.ts';
  import type { PoolStatus, PoolView } from '#lib/models.ts';
  import { clock } from '#lib/stores/clock.svelte.ts';
  import Icon from './Icon.svelte';

  let { pool, status }: { pool: PoolView; status: PoolStatus } = $props();

  const created = $derived(nsToMs(pool.offer.created_at_ns));
  const lock = $derived(nsToMs(pool.offer.lock_at_ns));
  const deadline = $derived(nsToMs(pool.offer.deadline_ns));
  const now = $derived(clock.now);
  const span = $derived(Math.max(deadline - created, 1));
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - created) / span) * 100)).toFixed(2)}%`;

  const locked = $derived(status === 'Locked' || status === 'Expired' || status === 'Settling');
  const past = $derived(status === 'Expired' || status === 'Settling');
  const urgent = $derived(!locked && lock - now < 5 * 60_000);
</script>

<div class="countdown" style="min-inline-size: min(100%, 340px)">
  <div class="countdown__row">
    <div class="countdown__item" data-urgent={locked || urgent ? '' : undefined}>
      <span class="countdown__label"><Icon name="lock" size="sm" />{locked ? 'Locked' : 'Locks in'}</span>
      <span class="countdown__value" class:countdown__value--text={locked} role="timer" aria-live="off">{locked ? 'Frozen' : fmtCountdown(lock - now)}</span>
      <span class="countdown__at">{fmtClock(lock)} UTC</span>
    </div>
    <div class="countdown__item">
      <span class="countdown__label"><Icon name="timer" size="sm" />{past ? 'Deadline passed' : 'Settles in'}</span>
      <span class="countdown__value" class:countdown__value--text={status !== 'Settling' && past} role="timer" aria-live="off">{status === 'Settling' ? `${pool.settle_cursor} of ${pool.member_count}` : past ? 'Awaiting settlement' : fmtCountdown(deadline - now)}</span>
      <span class="countdown__at">{fmtClock(deadline)} UTC</span>
    </div>
  </div>
  <div class="timeline" style="--lock:{pct(lock)};--now:{pct(now)}" aria-hidden="true">
    <span class="timeline__elapsed"></span><span class="timeline__lockzone"></span><span class="timeline__tick"></span><span class="timeline__now"></span>
  </div>
  <div class="timeline__legend" aria-hidden="true"><span>Opened {fmtClock(created)}</span><span>Lock</span><span>Deadline</span></div>
</div>
