// Deterministic brief reader, mirrored from the server's rules parser (PRD 7): a few regexes,
// no model. The web copy only previews; the server and the contract decide what is enforced.
// Keep in sync with agents/src (the shared parser), same keywords and same defaults.

import { formatNear, parseNear, YOCTO } from './format';
import type { PoolView } from './models';
import { priceFor } from './settlement';

export interface ParsedBrief {
  units: number | null;
  /** yocto, per unit */
  maxPrice: bigint | null;
  /** "at the 50-unit price": the tier whose min_units equals this */
  tierUnits: number | null;
  mode: 'now' | 'conditional' | null;
  archetype: 'eager' | 'bargain' | null;
  /** what is missing, for the field message */
  missing: ('units' | 'price')[];
}

const NOW = /\b(now|asap|immediately|right away|straight away|today|instantly|outright)\b/i;
const COND = /\b(drops?|falls?|dips?|lower|cheaper|discount(?:ed)?|only|wait(?:s|ing)?|reach(?:es)?|tier|bulk|group|once|when)\b/i;
const CEILING = '(?:below|under|beneath|less than|lower than|cheaper than|at most|up to|no more than|not (?:above|over|more than)|max(?:imum)?(?: of| price)?|within|cap(?:ped)? at|limit(?: of)?|<=|≤|<|for|at|@)';

export function parseBrief(input: string): ParsedBrief {
  const text = input.trim();
  const out: ParsedBrief = { units: null, maxPrice: null, tierUnits: null, mode: null, archetype: null, missing: [] };
  if (!text) return { ...out, missing: ['units', 'price'] };

  // 1. "at the 50-unit price" / "when the group reaches 50" -> threshold tier
  const tierA = /(\d+)\s*-?\s*units?\s*(?:price|tier|level|threshold|mark|discount|rate)/i.exec(text);
  const tierB = /(?:reach(?:es)?|hits?|gets? to|group (?:of|at)|threshold(?: of)?|tier (?:at|of))\s+(\d+)/i.exec(text);
  const tierMatch = tierA ?? tierB;
  if (tierMatch) out.tierUnits = Number(tierMatch[1]);

  const claimed: Array<[number, number]> = [];
  if (tierMatch) claimed.push([tierMatch.index, tierMatch.index + tierMatch[0].length]);

  // 2. price ceiling: a decimal, or a number after a ceiling word, not followed by "unit(s)"
  const priceRe = new RegExp(`${CEILING}\\s*(?:of\\s+)?(\\d*\\.\\d+|\\d+)(?!\\s*-?\\s*units?\\b)(?!\\d)`, 'gi');
  for (const m of text.matchAll(priceRe)) {
    const at = m.index ?? 0;
    if (claimed.some(([a, b]) => at >= a && at < b)) continue;
    const price = parseNear(m[1]);
    if (price !== null && price > 0n && price < 1000n * YOCTO) {
      out.maxPrice = price;
      claimed.push([at, at + m[0].length]);
      break;
    }
  }
  if (out.maxPrice === null) {
    const bare = /(\d*\.\d+)\s*(?:near|n\b)?/i.exec(text);
    if (bare && !claimed.some(([a, b]) => (bare.index ?? 0) >= a && (bare.index ?? 0) < b)) {
      const price = parseNear(bare[1]);
      if (price !== null && price > 0n) {
        out.maxPrice = price;
        claimed.push([bare.index ?? 0, (bare.index ?? 0) + bare[0].length]);
      }
    }
  }

  // 3. units: "buy 3", "5 credits", else the first integer nobody claimed
  const verb = /\b(?:buy|get|want|take|need|grab|order|purchase|snag|pick up)\s+(\d+)\b/i.exec(text);
  const noun = /(\d+)\s*(?:x\s*)?(?:units?|credits?|vouchers?|tokens?|api|passes|minutes|queries)\b/i;
  const free = (m: RegExpExecArray | null) => m && !claimed.some(([a, b]) => m.index >= a && m.index < b);
  const vMatch = verb && free(verb) ? verb : null;
  let nMatch: RegExpExecArray | null = null;
  if (!vMatch) {
    for (const m of text.matchAll(new RegExp(noun.source, 'gi'))) {
      if (free(m as RegExpExecArray)) {
        nMatch = m as RegExpExecArray;
        break;
      }
    }
  }
  let u = vMatch ?? nMatch;
  if (!u) {
    for (const m of text.matchAll(/\b(\d+)\b(?!\.\d)/g)) {
      if (!claimed.some(([a, b]) => (m.index ?? 0) >= a && (m.index ?? 0) < b)) {
        u = m as RegExpExecArray;
        break;
      }
    }
  }
  if (u) {
    const n = Number(u[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 10_000) out.units = n;
  }

  // 4. mode
  if (out.tierUnits !== null) out.mode = 'conditional';
  else if (NOW.test(text)) out.mode = 'now';
  else if (COND.test(text)) out.mode = 'conditional';
  else if (out.maxPrice !== null) out.mode = 'now';
  out.archetype = out.mode === 'now' ? 'eager' : out.mode === 'conditional' ? 'bargain' : null;

  if (out.units === null) out.missing.push('units');
  if (out.maxPrice === null && out.tierUnits === null) out.missing.push('price');
  return out;
}

export interface PoolMatch {
  poolId: number;
  title: string;
  /** price at the join point (entry price for Eager, the threshold tier for Bargain) */
  price: bigint;
  /** null = joins now */
  threshold: number | null;
}

/** Cheapest open pool the policy would join, with the threshold it would use. */
export function matchPools(p: ParsedBrief, pools: readonly PoolView[]): PoolMatch | null {
  let best: PoolMatch | null = null;
  for (const pool of pools) {
    if (pool.status !== 'Open') continue;
    const tiers = pool.offer.tiers;
    if (!tiers.length) continue;
    let hit: PoolMatch | null = null;
    if (p.tierUnits !== null) {
      const t = tiers.find((x) => x.min_units >= p.tierUnits!) ?? null;
      if (t && t.min_units === p.tierUnits && (p.maxPrice === null || BigInt(t.unit_price) <= p.maxPrice)) {
        hit = { poolId: pool.id, title: pool.offer.title, price: BigInt(t.unit_price), threshold: t.min_units };
      }
    } else if (p.maxPrice !== null) {
      if (p.mode === 'now') {
        const entry = BigInt(tiers[0].unit_price);
        if (entry <= p.maxPrice) hit = { poolId: pool.id, title: pool.offer.title, price: entry, threshold: null };
      } else {
        const t = tiers.find((x) => BigInt(x.unit_price) <= p.maxPrice!);
        if (t) {
          const joinsNow = t === tiers[0];
          hit = { poolId: pool.id, title: pool.offer.title, price: BigInt(t.unit_price), threshold: joinsNow ? null : t.min_units };
        }
      }
    }
    if (hit && (!best || hit.price < best.price || (hit.price === best.price && hit.poolId > best.poolId))) best = hit;
  }
  return best;
}

export interface PolicyView {
  sentenceParts: Array<{ t: 'text' | 'mark' | 'name'; v: string }>;
  archetype: string | null;
  maxPriceText: string | null;
  maxPriceNote: string | null;
  unitsText: string | null;
  joinsText: string | null;
  locksText: string | null;
  match: PoolMatch | null;
  ok: boolean;
}

/** What the preview card shows. Fields that were not found stay null: never guessed. */
export function describePolicy(name: string, p: ParsedBrief, pools: readonly PoolView[]): PolicyView {
  const match = p.units !== null && (p.maxPrice !== null || p.tierUnits !== null) ? matchPools(p, pools) : null;
  const who = name || 'it';
  const parts: PolicyView['sentenceParts'] = [];
  const priceFromTier = p.maxPrice === null && match ? match.price : null;
  const ceiling = p.maxPrice ?? priceFromTier;
  const ok = p.units !== null && (p.maxPrice !== null || p.tierUnits !== null);

  if (ok) {
    parts.push(name ? { t: 'name', v: name } : { t: 'text', v: 'It' });
    if (p.archetype === 'eager') {
      parts.push({ t: 'text', v: ' buys ' }, { t: 'mark', v: String(p.units) }, { t: 'text', v: ` ${p.units === 1 ? 'unit' : 'units'} now` });
      if (ceiling !== null) parts.push({ t: 'text', v: ', at up to ' }, { t: 'mark', v: formatNear(ceiling) }, { t: 'text', v: ' per unit.' });
      else parts.push({ t: 'text', v: '.' });
    } else {
      parts.push({ t: 'text', v: ' buys ' }, { t: 'mark', v: String(p.units) }, { t: 'text', v: ` ${p.units === 1 ? 'unit' : 'units'}` });
      if (ceiling !== null) parts.push({ t: 'text', v: ' at ' }, { t: 'mark', v: formatNear(ceiling) }, { t: 'text', v: ' or less' });
      const threshold = p.tierUnits ?? match?.threshold ?? null;
      if (threshold !== null) parts.push({ t: 'text', v: ', so it waits for the group to reach ' }, { t: 'mark', v: String(threshold) }, { t: 'text', v: '.' });
      else parts.push({ t: 'text', v: ', and joins only at a tier that cheap.' });
    }
  } else {
    void who;
  }

  const lockPrice = match ? match.price : (p.maxPrice ?? null);
  return {
    sentenceParts: parts,
    archetype: p.archetype === 'eager' ? 'Eager' : p.archetype === 'bargain' ? 'Bargain' : null,
    maxPriceText: ceiling !== null ? formatNear(ceiling) : null,
    maxPriceNote: ceiling === null && p.tierUnits !== null ? `At the ${p.tierUnits}-unit tier` : null,
    unitsText: p.units !== null ? String(p.units) : null,
    joinsText:
      p.archetype === 'eager'
        ? 'now'
        : p.archetype === 'bargain'
          ? p.tierUnits !== null
            ? `if group ≥ ${p.tierUnits}`
            : match?.threshold != null
              ? `if group ≥ ${match.threshold}`
              : match
                ? 'now'
                : 'at a cheap enough tier'
          : null,
    locksText: p.units !== null && lockPrice !== null ? formatNear(BigInt(p.units) * lockPrice) : null,
    match,
    ok
  };
}

export { priceFor };
