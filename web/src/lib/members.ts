import type { MemberView, PoolView } from './models';
import { resolve } from './settlement';
import { entriesOf } from './ladder';
import { splitAccount } from './format';

export type RowState = 'committed' | 'in' | 'waiting' | 'excluded';
export type PillState = 'committed' | 'waiting' | 'excluded' | 'refunded';

export interface MemberStateModel {
  row: RowState;
  pill: PillState;
  text: string;
  /** Filled shows a check instead of the ring. */
  check: boolean;
  group: 'in' | 'waiting' | 'filled' | 'excluded';
}

/**
 * DESIGN.md 7.10. `unprocessed` covers the Settling window: the pool has a result but this
 * member's outcome is not recorded yet, so the contract view cannot tell us (projected_in is false).
 */
export function memberState(m: MemberView, unprocessedIn?: boolean): MemberStateModel {
  if (m.outcome === 'Filled') return { row: 'committed', pill: 'committed', text: 'Filled', check: true, group: 'filled' };
  if (m.outcome === 'Excluded') return { row: 'excluded', pill: 'excluded', text: 'Excluded', check: false, group: 'excluded' };
  if (m.outcome === 'Refunded') return { row: 'excluded', pill: 'refunded', text: 'Refunded', check: false, group: 'excluded' };
  if (unprocessedIn !== undefined) {
    return unprocessedIn
      ? { row: 'in', pill: 'committed', text: 'Settling', check: false, group: 'in' }
      : { row: 'excluded', pill: 'excluded', text: 'Not in the group', check: false, group: 'excluded' };
  }
  if (m.threshold_units === null) return { row: 'committed', pill: 'committed', text: 'Committed', check: false, group: 'in' };
  if (m.projected_in) return { row: 'in', pill: 'committed', text: `In at ${m.threshold_units}`, check: false, group: 'in' };
  return { row: 'waiting', pill: 'waiting', text: `Waiting for ${m.threshold_units}`, check: false, group: 'waiting' };
}

export function memberStates(pool: PoolView, members: readonly MemberView[]): Map<string, MemberStateModel> {
  const out = new Map<string, MemberStateModel>();
  const mid = pool.result !== null && pool.status === 'Settling';
  const inc = mid ? resolve(entriesOf(members)).included : null;
  members.forEach((m, i) => out.set(m.agent_id, memberState(m, mid && m.outcome === null ? inc![i] : undefined)));
  return out;
}

export interface Archetype {
  key: 'eager' | 'bargain' | 'switcher' | 'custom';
  name: string;
  letter: string;
}

export function archetypeOf(agentId: string, listed?: string | null): Archetype {
  const [label] = splitAccount(agentId);
  const k = (listed ?? '').toLowerCase();
  const src = k || label.toLowerCase();
  if (src.startsWith('eager')) return { key: 'eager', name: 'Eager', letter: 'E' };
  if (src.startsWith('bargain')) return { key: 'bargain', name: 'Bargain', letter: 'B' };
  if (src.startsWith('switcher')) return { key: 'switcher', name: 'Switcher', letter: 'S' };
  return { key: 'custom', name: listed ? listed[0].toUpperCase() + listed.slice(1) : 'Agent', letter: (label[0] ?? '?').toUpperCase() };
}
