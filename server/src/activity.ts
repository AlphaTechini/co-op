/** Bounded activity ring buffer + SSE fan-out. Entries come from the runtime and from the server itself. */
import type { ServerResponse } from "node:http";
import type { ActivityEntry } from "@coop/agents/types";

export const HEARTBEAT_MS = 15_000;

export type NewEntry = Omit<ActivityEntry, "id" | "ts"> & { ts?: number };

export class ActivityHub {
  private readonly entries: ActivityEntry[] = [];
  private readonly clients = new Set<{ res: ServerResponse; timer: NodeJS.Timeout }>();
  private readonly stamp = Date.now().toString(36);
  private seq = 0;

  constructor(private readonly capacity = 2000) {}

  /** Adds an entry that already has an id (from the runtime). */
  publish(entry: ActivityEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
    const frame = `data: ${JSON.stringify(entry)}\n\n`;
    for (const client of this.clients) {
      try {
        client.res.write(frame);
      } catch {
        this.drop(client);
      }
    }
  }

  /** Server-originated entry (`spawned`, `error`): gets an id and timestamp here. */
  emit(entry: NewEntry): ActivityEntry {
    const full: ActivityEntry = { ...entry, id: `srv-${this.stamp}-${++this.seq}`, ts: entry.ts ?? Date.now() };
    this.publish(full);
    return full;
  }

  /** Newest first. */
  list(filter: { poolId?: number; limit: number }): ActivityEntry[] {
    const out: ActivityEntry[] = [];
    for (let i = this.entries.length - 1; i >= 0 && out.length < filter.limit; i--) {
      const entry = this.entries[i] as ActivityEntry;
      if (filter.poolId === undefined || entry.pool_id === filter.poolId) out.push(entry);
    }
    return out;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Takes over `res` (headers must already be written) and streams future entries to it. */
  attach(res: ServerResponse, heartbeatMs = HEARTBEAT_MS): void {
    const client = { res, timer: setInterval(() => this.beat(client), heartbeatMs) };
    client.timer.unref();
    this.clients.add(client);
    res.once("close", () => this.drop(client));
    res.write(": connected\n\n");
  }

  private beat(client: { res: ServerResponse; timer: NodeJS.Timeout }): void {
    try {
      client.res.write(": heartbeat\n\n");
    } catch {
      this.drop(client);
    }
  }

  private drop(client: { res: ServerResponse; timer: NodeJS.Timeout }): void {
    clearInterval(client.timer);
    this.clients.delete(client);
  }

  closeAll(): void {
    for (const client of [...this.clients]) {
      this.drop(client);
      client.res.end();
    }
  }
}
