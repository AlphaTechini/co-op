// Formatting rules from DESIGN.md section 11. Money is BigInt end to end.

export const YOCTO = 10n ** 24n;
/** NEP-145 registration reserve charged per filled member (SPEC 1.4). */
export const STORAGE_RESERVE = 1_250_000_000_000_000_000_000n; // 0.00125 NEAR
export const THIN_SPACE = ' ';
export const MINUS = '−';

export interface NearFormatOptions {
  /** Minimum decimals (default 2). */
  min?: number;
  /** Maximum decimals (default 5). Digits beyond are rounded half up. */
  max?: number;
}

function groupThousands(int: string): string {
  // Thin space above 9 999 only.
  if (int.length <= 4) return int;
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
}

export function formatNear(value: bigint | string, opts: NearFormatOptions = {}): string {
  const min = opts.min ?? 2;
  const max = Math.max(opts.max ?? 5, min);
  let v = typeof value === 'bigint' ? value : BigInt(value);
  const neg = v < 0n;
  if (neg) v = -v;
  const scale = 10n ** BigInt(24 - max);
  const q = (v + scale / 2n) / scale; // value in units of 10^-max, rounded half up
  const base = 10n ** BigInt(max);
  const int = (q / base).toString();
  let frac = (q % base).toString().padStart(max, '0');
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  const out = frac.length ? `${groupThousands(int)}.${frac}` : groupThousands(int);
  return neg ? `${MINUS}${out}` : out;
}

/** Exact value with all significant decimals (never rounded), at least `min` decimals. */
export function formatNearExact(value: bigint | string, min = 3): string {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  const neg = v < 0n;
  const a = neg ? -v : v;
  const int = (a / YOCTO).toString();
  let frac = (a % YOCTO).toString().padStart(24, '0');
  while (frac.length > min && frac.endsWith('0')) frac = frac.slice(0, -1);
  const out = `${groupThousands(int)}.${frac}`;
  return neg ? `${MINUS}${out}` : out;
}

/** "0.6" -> yocto. Returns null for anything that is not a plain non-negative decimal with <= 24 decimals. */
export function parseNear(text: string): bigint | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d*\.?\d+$|^\d+\.$/.test(t)) return null;
  const [i = '0', f = ''] = t.split('.');
  if (f.length > 24) return null;
  return BigInt(i || '0') * YOCTO + BigInt(f.padEnd(24, '0') || '0');
}

export function sumBig(values: Iterable<bigint>): bigint {
  let s = 0n;
  for (const v of values) s += v;
  return s;
}

/** Percentage off list, rounded half up, using integer math. */
export function discountPct(list: bigint, price: bigint): number {
  if (list <= 0n) return 0;
  const num = (list - price) * 200n + list;
  return Number(num / (2n * list));
}

export function discountLabel(list: bigint, price: bigint, isList: boolean): string {
  if (isList) return 'list';
  return `${MINUS}${discountPct(list, price)}%`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash;
}

/** "bargain-01.operator.testnet" -> ["bargain-01", ".operator.testnet"] */
export function splitAccount(id: string): [string, string] {
  const i = id.indexOf('.');
  return i < 0 ? [id, ''] : [id.slice(0, i), id.slice(i)];
}

export const nsToMs = (ns: string | bigint): number => Number(BigInt(ns) / 1_000_000n);

const pad2 = (n: number) => String(n).padStart(2, '0');

export function fmtClock(ms: number, seconds = false): string {
  const d = new Date(ms);
  const base = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
  return seconds ? `${base}:${pad2(d.getUTCSeconds())}` : base;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** mm:ss under 1h, h:mm:ss under 24h, "2d 4h" beyond. */
export function fmtCountdown(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(s / 86400);
  if (days >= 1) return `${days}d ${Math.floor((s % 86400) / 3600)}h`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h >= 1 ? `${h}:${pad2(m)}:${pad2(sec)}` : `${pad2(m)}:${pad2(sec)}`;
}

/** "today" / "yesterday" / "Nov 12" caption for a past time, in UTC. */
export function dayCaption(ms: number, nowMs: number): string {
  const day = (t: number) => Math.floor(t / 86_400_000);
  const diff = day(nowMs) - day(ms);
  if (diff === 0) return 'today';
  if (diff === 1) return 'yesterday';
  return fmtDate(ms);
}

export function relativeAgo(ms: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
