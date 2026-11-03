// Optional Co-op server (SPEC 3.1). Every function degrades to null/throw; the app never depends on it.
import { BUILD, config } from './config.svelte';
import type { ActivityEntry, SpawnResponse, SpawnedAgent } from './models';

async function get<T>(path: string, timeoutMs = 5000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BUILD.apiUrl}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    config.server = 'up';
    return (await res.json()) as T;
  } catch (e) {
    config.server = 'down';
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const apiEnabled = () => !!BUILD.apiUrl;

export async function fetchActivity(poolId: number, limit: number): Promise<ActivityEntry[]> {
  const rows = await get<ActivityEntry[]>(`/api/activity?pool_id=${poolId}&limit=${limit}`);
  return Array.isArray(rows) ? rows : [];
}

export async function fetchAgents(): Promise<SpawnedAgent[]> {
  const rows = await get<SpawnedAgent[]>('/api/agents');
  return Array.isArray(rows) ? rows : [];
}

export function openStream(onEntry: (e: ActivityEntry) => void, onState: (up: boolean) => void): () => void {
  if (!BUILD.apiUrl || typeof EventSource === 'undefined') return () => {};
  const es = new EventSource(`${BUILD.apiUrl}/api/stream`);
  es.onopen = () => onState(true);
  es.onerror = () => onState(false);
  es.onmessage = (ev) => {
    try {
      const entry = JSON.parse(ev.data) as ActivityEntry;
      if (entry && typeof entry === 'object' && entry.kind) onEntry(entry);
    } catch {
      /* ignore malformed frames */
    }
  };
  return () => es.close();
}

export type SpawnResult =
  | { ok: true; data: SpawnResponse }
  | { ok: false; status: number; error: string; retryAfterSec?: number };

export async function spawnAgent(body: { name: string; brief: string; budget_near: number }): Promise<SpawnResult> {
  try {
    const res = await fetch(`${BUILD.apiUrl}/api/agents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON error body */
    }
    if (res.ok) return { ok: true, data: json as unknown as SpawnResponse };
    const retry = Number(res.headers.get('retry-after'));
    return {
      ok: false,
      status: res.status,
      error: typeof json.error === 'string' ? json.error : `Server answered ${res.status}`,
      retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : undefined
    };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the Co-op server.' };
  }
}
