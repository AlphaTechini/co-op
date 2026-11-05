// Optional Co-op server (SPEC 3.1). Every function degrades to null/throw; the app never depends on it.
import { BUILD, config } from './config.svelte';
import type { ActivationState, ActivityEntry, PrepareResponse, Room, SpawnResponse, SpawnedAgent } from './models';

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

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; field?: string; retryAfterSec?: number };

export type SpawnResult = ApiResult<SpawnResponse>;

async function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${BUILD.apiUrl}${path}`, {
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
    if (res.ok) return { ok: true, data: json as unknown as T };
    const retry = Number(res.headers.get('retry-after'));
    return {
      ok: false,
      status: res.status,
      error: typeof json.error === 'string' ? json.error : `Server answered ${res.status}`,
      field: typeof json.field === 'string' ? json.field : undefined,
      retryAfterSec: Number.isFinite(retry) && retry > 0 ? retry : undefined
    };
  } catch {
    return { ok: false, status: 0, error: 'Could not reach the Co-op server.' };
  }
}

export const spawnAgent = (body: { name: string; brief: string; budget_near: number; room_code?: string }) =>
  postJson<SpawnResponse>('/api/agents', body);

export async function fetchRooms(): Promise<Room[]> {
  const rows = await get<Room[]>('/api/rooms');
  return Array.isArray(rows) ? rows : [];
}

/** Null when no room has that code. */
export async function fetchRoom(code: string): Promise<Room | null> {
  try {
    return await get<Room>(`/api/rooms/${encodeURIComponent(code.trim().toUpperCase())}`);
  } catch (e) {
    if (e instanceof Error && e.message === 'HTTP 404') return null;
    throw e;
  }
}

export const createRoom = (body: { item: string; purpose: string; duration_min: number; host: string }) =>
  postJson<Room>('/api/rooms', body);

export const prepareWalletAgents = (body: { owner: string; room_code: string; name: string; count: number; brief: string; total_near: number }) =>
  postJson<PrepareResponse>('/api/wallet-agents/prepare', body);

export const activateWalletAgents = (body: { owner: string; agent_ids: string[] }) =>
  postJson<{ agents: Array<{ agent_id: string; state: ActivationState }> }>('/api/wallet-agents/activate', body);
