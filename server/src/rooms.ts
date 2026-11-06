/**
 * Rooms: a pool with a purpose and a join code. Every room is listed and readable by anyone; spawning
 * agents into one needs its code. Public rooms (the demo seller's always-open room per catalog item)
 * show their code; invite rooms (created by a visitor) only return it to the creator.
 *
 * The code is an app-level gate: the contract lets any registered agent join any open pool. It keeps
 * this server's agents in the room they were spawned for, which is what a room means here.
 */
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Account } from "near-api-js";
import { CREATE_OFFER_DEPOSIT, type CoopClient } from "@coop/agents/chain";
import { storyTiers } from "@coop/agents/roster";
import { postOffer } from "@coop/agents/seller";
import type { PoolView } from "@coop/agents/types";
import { z } from "zod";
import type { NewEntry } from "./activity.js";
import type { CatalogItem } from "./catalog.js";

export type RoomVisibility = "public" | "invite";

export interface RoomRecord {
  code: string;
  pool_id: number;
  item: string;
  purpose: string;
  /** Account that created the room; null for the demo seller's public rooms. */
  host: string | null;
  visibility: RoomVisibility;
  created_at: number;
}

/** What GET /api/rooms returns: invite codes are left out. */
export interface RoomView extends Omit<RoomRecord, "code"> {
  code: string | null;
  title: string;
  unit: string;
}

export class RoomError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 429 | 503,
    message: string,
    readonly extra: { field?: string; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = "RoomError";
  }
}

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CODE_LENGTH = 6;
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);
const HOUR_MS = 3_600_000;
const OPEN_STATES = new Set<PoolView["status"]>(["Open", "AwaitingInventory"]);
export const ROOM_DURATIONS_MIN = [10, 20, 30] as const;
const ROOM_MAX_UNITS = 50;

const RecordSchema = z.object({
  code: z.string().regex(CODE_RE),
  pool_id: z.number().int().min(1),
  item: z.string(),
  purpose: z.string(),
  host: z.string().nullable(),
  visibility: z.enum(["public", "invite"]),
  created_at: z.number(),
});
const FileSchema = z.object({ version: z.literal(1), contract_id: z.string(), rooms: z.array(RecordSchema) });

export interface RoomStore {
  load(): RoomRecord[];
  save(rooms: RoomRecord[]): void;
}

export class FileRoomStore implements RoomStore {
  constructor(
    private readonly file: string,
    private readonly contractId: string,
  ) {}

  load(): RoomRecord[] {
    if (!existsSync(this.file)) return [];
    const parsed = FileSchema.parse(JSON.parse(readFileSync(this.file, "utf8")));
    if (parsed.contract_id !== this.contractId) {
      renameSync(this.file, `${this.file}.${Date.now()}.other`);
      return [];
    }
    return parsed.rooms;
  }

  save(rooms: RoomRecord[]): void {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, contract_id: this.contractId, rooms }, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export class MemoryRoomStore implements RoomStore {
  saved: RoomRecord[] = [];
  load(): RoomRecord[] {
    return [];
  }
  save(rooms: RoomRecord[]): void {
    this.saved = [...rooms];
  }
}

export interface RoomServiceOptions {
  client: CoopClient;
  /** The demo seller that opens every room's pool. Null: rooms can be read but not created. */
  seller: Account | null;
  catalog: CatalogItem[];
  store: RoomStore;
  emit: (entry: NewEntry) => void;
  entryPrice: bigint;
  lockWindowMs: number;
  balanceFloor: bigint;
  /** Open invite rooms one host may have at a time. */
  maxOpenPerHost: number;
  maxOpenTotal: number;
  perIpPerHour: number;
  now?: () => number;
}

export interface CreateRoomInput {
  item: string;
  purpose: string;
  durationMin: number;
  host: string;
  ip: string;
}

export class RoomService {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly hits = new Map<string, number[]>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly o: RoomServiceOptions) {
    this.now = o.now ?? Date.now;
    for (const room of o.store.load()) this.rooms.set(room.code, room);
  }

  get catalog(): CatalogItem[] {
    return this.o.catalog;
  }

  get canCreate(): boolean {
    return this.o.seller !== null && this.o.catalog.length > 0;
  }

  item(key: string): CatalogItem | undefined {
    return this.o.catalog.find((i) => i.key === key);
  }

  byCode(code: string): RoomRecord | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  byPool(poolId: number): RoomRecord | undefined {
    for (const room of this.rooms.values()) if (room.pool_id === poolId) return room;
    return undefined;
  }

  /** Newest first, capped: old rooms stay reachable by code but drop off the list. */
  list(limit = 60): RoomView[] {
    return [...this.rooms.values()]
      .sort((a, b) => b.pool_id - a.pool_id)
      .slice(0, limit)
      .map((r) => this.view(r, r.visibility === "public"));
  }

  view(room: RoomRecord, withCode: boolean): RoomView {
    const item = this.item(room.item);
    return { ...room, code: withCode ? room.code : null, title: item?.title ?? room.item, unit: item?.unit ?? "unit" };
  }

  /** Called by the seller loop once it has opened the public room for an item. */
  registerPublic(poolId: number, itemKey: string): RoomRecord {
    const existing = this.byPool(poolId);
    if (existing) return existing;
    const item = this.item(itemKey);
    return this.add({ pool_id: poolId, item: itemKey, purpose: item?.purpose ?? "", host: null, visibility: "public" });
  }

  /** True when this pool is the public room the seller loop keeps open for that item. */
  isPublicRoom(poolId: number, itemKey: string): boolean {
    const room = this.byPool(poolId);
    return room?.visibility === "public" && room.item === itemKey;
  }

  async create(input: CreateRoomInput): Promise<RoomRecord> {
    const seller = this.o.seller;
    if (!seller) throw new RoomError(503, "Rooms cannot be created: this server has no seller key.");
    const item = this.item(input.item);
    if (!item) throw new RoomError(400, `Unknown item "${input.item}".`, { field: "item" });
    this.checkIpLimit(input.ip);

    return this.serial(async () => {
      const pools = await this.o.client.listPools(0, 50);
      const open = new Set(pools.filter((p) => OPEN_STATES.has(p.status)).map((p) => p.id));
      const openInvite = [...this.rooms.values()].filter((r) => r.visibility === "invite" && open.has(r.pool_id));
      if (openInvite.filter((r) => r.host === input.host).length >= this.o.maxOpenPerHost) {
        throw new RoomError(429, `${input.host} already hosts ${this.o.maxOpenPerHost} open rooms. Wait for one to settle.`);
      }
      if (openInvite.length >= this.o.maxOpenTotal) {
        throw new RoomError(503, "The demo seller is running as many rooms as it can. Join an open one or try again after one settles.");
      }
      const balance = await this.o.client.accountBalance(seller.accountId);
      if (balance < this.o.balanceFloor + CREATE_OFFER_DEPOSIT) {
        throw new RoomError(503, "The demo seller is low on NEAR and cannot open another room right now.");
      }
      if ((await this.o.client.ftBalanceOf(seller.accountId, item.tokenId)) < BigInt(ROOM_MAX_UNITS)) {
        throw new RoomError(503, `The demo seller has no ${item.title} left to put in a room.`);
      }
      this.hit(input.ip);
      const durationMs = input.durationMin * 60_000;
      const posted = await postOffer(this.o.client, seller, item.tokenId, {
        title: item.title,
        description: input.purpose,
        tiers: storyTiers(this.o.entryPrice),
        maxUnits: ROOM_MAX_UNITS,
        durationMs,
        lockWindowMs: Math.min(this.o.lockWindowMs, Math.floor(durationMs / 4)),
      });
      const room = this.add({ pool_id: posted.offerId, item: item.key, purpose: input.purpose, host: input.host, visibility: "invite" });
      this.o.emit({ kind: "offer_created", pool_id: posted.offerId, message: `${input.host} opened a room for ${item.title} (pool ${posted.offerId})`, reason: input.purpose });
      return room;
    });
  }

  private add(fields: Omit<RoomRecord, "code" | "created_at">): RoomRecord {
    const room: RoomRecord = { ...fields, code: this.freshCode(), created_at: this.now() };
    this.rooms.set(room.code, room);
    this.o.store.save([...this.rooms.values()]);
    return room;
  }

  private freshCode(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  private checkIpLimit(ip: string): void {
    const now = this.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < HOUR_MS);
    this.hits.set(ip, recent);
    if (recent.length >= this.o.perIpPerHour) {
      const retry = Math.max(1, Math.ceil(((recent[0] as number) + HOUR_MS - now) / 1000));
      throw new RoomError(429, `Room limit reached: ${this.o.perIpPerHour} rooms per hour per visitor.`, { retryAfterSec: retry });
    }
  }

  private hit(ip: string): void {
    this.hits.set(ip, [...(this.hits.get(ip) ?? []), this.now()]);
  }

  // Room offers and seller-loop offers sign with the same seller key.
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
