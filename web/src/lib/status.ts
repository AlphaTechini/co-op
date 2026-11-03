import type { PoolStatus, PoolView } from './models';
import { nsToMs } from './format';

/** The view derives Locked/Expired at call time; between polls we apply the same rule locally (never downgrade). */
export function effectiveStatus(pool: PoolView, nowMs: number): PoolStatus {
  const lock = nsToMs(pool.offer.lock_at_ns);
  const deadline = nsToMs(pool.offer.deadline_ns);
  if (pool.status === 'Open' || pool.status === 'Locked' || pool.status === 'AwaitingInventory') {
    if (nowMs >= deadline) return 'Expired';
    if (pool.status === 'Open' && nowMs >= lock) return 'Locked';
  }
  return pool.status;
}

export const isFinal = (s: PoolStatus) => s === 'Settled' || s === 'Refunded';
