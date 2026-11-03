// Typed contract views (SPEC 1.2).
import type { AgentView, MemberView, PoolView, StatsView } from './models';
import { view } from './rpc.svelte';

export const getPool = (id: number) => view<PoolView | null>('get_pool', { pool_id: id });

export const listPools = (fromIndex: number, limit: number) =>
  view<PoolView[]>('list_pools', { from_index: fromIndex, limit });

export const getStats = () => view<StatsView>('get_stats');

export const getAgent = (agentId: string) => view<AgentView | null>('get_agent', { agent_id: agentId });

/** All pages of a pool's members, in join order (contract caps a page at 100). */
export async function getPoolMembers(id: number): Promise<MemberView[]> {
  const out: MemberView[] = [];
  for (let from = 0; ; from += 100) {
    const page = await view<MemberView[]>('get_pool_members', { pool_id: id, from_index: from, limit: 100 });
    out.push(...page);
    if (page.length < 100) return out;
  }
}

/** Pages of up to 50 pools, newest first. */
export async function listPoolsUpTo(count: number): Promise<PoolView[]> {
  const out: PoolView[] = [];
  for (let from = 0; out.length < count; from += 50) {
    const take = Math.min(50, count - out.length);
    const page = await listPools(from, take);
    out.push(...page);
    if (page.length < take) break;
  }
  return out;
}
