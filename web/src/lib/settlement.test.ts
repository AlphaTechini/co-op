import { describe, expect, it } from 'vitest';
import { evaluate, priceFor, resolve, unitsToReach, type Entry } from './settlement';
import { ladderModel, tierColorIndex } from './ladder';
import { NEAR, TIERS, member, pool, pool7 } from './fixtures.test-util';

const e = (units: number, threshold: number | null = null): Entry => ({ units, threshold });

describe('resolve (SPEC 1.5)', () => {
  it('keeps two 25-unit members with threshold 50 (greatest fixed point)', () => {
    const r = resolve([e(25, 50), e(25, 50)]);
    expect(r.units).toBe(50);
    expect(r.included).toEqual([true, true]);
    expect(priceFor(TIERS, r.units)?.index).toBe(2);
  });

  it('drops the highest unmet threshold first', () => {
    // 12 members of mockup pool #7: 27 units in, 15 waiting at 50
    const { members } = pool7();
    const r = resolve(members.map((m) => e(m.units, m.threshold_units)));
    expect(r.units).toBe(27);
    expect(r.membersIn).toBe(9);
  });

  it('excludes a lone conditional member whose own units do not reach its threshold', () => {
    const r = resolve([e(10, null), e(30, 50)]);
    expect(r.units).toBe(10);
    expect(r.included).toEqual([true, false]);
  });

  it('handles empty input and unconditional-only input', () => {
    expect(resolve([]).units).toBe(0);
    expect(resolve([e(3), e(4)]).units).toBe(7);
  });

  it('matches a brute-force search over all subsets (greatest consistent set)', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let round = 0; round < 400; round++) {
      const count = 1 + rnd(9);
      const entries: Entry[] = Array.from({ length: count }, () => e(1 + rnd(8), rnd(3) === 0 ? null : 1 + rnd(40)));
      // brute force: the largest subset in which every member's threshold <= subset total
      let bestMask = 0;
      let bestUnits = -1;
      for (let mask = 0; mask < 1 << count; mask++) {
        let total = 0;
        for (let i = 0; i < count; i++) if (mask & (1 << i)) total += entries[i].units;
        let ok = true;
        for (let i = 0; i < count && ok; i++) {
          if (mask & (1 << i) && entries[i].threshold !== null && (entries[i].threshold as number) > total) ok = false;
        }
        if (ok && (total > bestUnits || (total === bestUnits && popcount(mask) > popcount(bestMask)))) {
          bestUnits = total;
          bestMask = mask;
        }
      }
      const r = resolve(entries);
      expect(r.units).toBe(bestUnits);
      const mask = r.included.reduce((m, inc, i) => (inc ? m | (1 << i) : m), 0);
      expect(mask).toBe(bestMask);
    }
  });
});

function popcount(x: number): number {
  let c = 0;
  while (x) {
    c += x & 1;
    x >>= 1;
  }
  return c;
}

describe('priceFor', () => {
  it('picks the best tier reached', () => {
    expect(priceFor(TIERS, 0)).toBeNull();
    expect(priceFor(TIERS, 1)?.index).toBe(0);
    expect(priceFor(TIERS, 19)?.index).toBe(0);
    expect(priceFor(TIERS, 20)?.index).toBe(1);
    expect(priceFor(TIERS, 55)?.price).toBe(BigInt(NEAR('0.50')));
  });
  it('returns null below the first tier when it starts above 1', () => {
    expect(priceFor([{ min_units: 10, unit_price: '5' }], 6)).toBeNull();
  });
  it('evaluate combines both', () => {
    expect(evaluate([e(25, 50), e(25, 50)], TIERS).tier?.index).toBe(2);
  });
});

describe('unitsToReach (simulated, not subtracted)', () => {
  it('pool #7: 8 more pledged units bring in 3 waiting agents', () => {
    const { members } = pool7();
    const entries = members.map((m) => e(m.units, m.threshold_units));
    const r = unitsToReach(entries, 50, 60 - 42);
    expect(r).toEqual({ kind: 'away', units: 8, bringsIn: 3 });
  });

  it('the plain gap (23) would be wrong: waiting members pull the group over sooner', () => {
    const { members } = pool7();
    const entries = members.map((m) => e(m.units, m.threshold_units));
    const r = unitsToReach(entries, 50, 18);
    expect(r.kind === 'away' && r.units).toBeLessThan(50 - 27);
  });

  it('two 25-unit conditional members at 50: zero extra units are needed to be reachable, 1 reaches 50 total', () => {
    const entries = [e(25, 50), e(25, 50)];
    // already resolved at 50 units; asking for tier 20 is reached by adding 1 unit? no: group already 50
    expect(resolve(entries).units).toBe(50);
    // unit 0 case: target below current is still answered with the minimal x >= 1
    expect(unitsToReach(entries, 50, 10)).toEqual({ kind: 'away', units: 1, bringsIn: 0 });
  });

  it('reports unreachable when capacity is exhausted', () => {
    expect(unitsToReach([e(5)], 50, 10)).toEqual({ kind: 'unreachable' });
    expect(unitsToReach([e(5)], 50, 0)).toEqual({ kind: 'unreachable' });
  });

  it('agrees with a linear scan', () => {
    let seed = 99;
    const rnd = (n: number) => ((seed = (seed * 1664525 + 1013904223) & 0x7fffffff) % n);
    for (let round = 0; round < 200; round++) {
      const entries = Array.from({ length: 1 + rnd(8) }, () => e(1 + rnd(9), rnd(2) ? null : 1 + rnd(45)));
      const target = 10 + rnd(40);
      const cap = 1 + rnd(40);
      let expected: number | null = null;
      for (let x = 1; x <= cap; x++) {
        if (resolve([...entries, e(x)]).units >= target) {
          expected = x;
          break;
        }
      }
      const got = unitsToReach(entries, target, cap);
      if (expected === null) expect(got.kind).toBe('unreachable');
      else expect(got.kind === 'away' && got.units).toBe(expected);
    }
  });
});

describe('ladderModel (mockup pool #7)', () => {
  it('matches the mockup numbers: marker 41.1%, x = 8, k = 3', () => {
    const { pool: p, members } = pool7();
    const m = ladderModel(p, members);
    expect(m.segs.map((s) => [s.from, s.to])).toEqual([[0, 20], [20, 50], [50, 60]]);
    expect(m.inUnits).toBe(27);
    expect(m.pledged).toBe(42);
    expect(m.pos).toBeCloseTo(41.11, 1);
    expect(m.segs[0].in).toBe(1);
    expect(m.segs[1].in).toBeCloseTo(0.2333, 3);
    expect(m.segs[1].pend).toBeCloseTo(0.7333, 3);
    expect(m.segs[2].pend).toBe(0);
    expect(m.rungs.map((r) => r.state)).toEqual(['passed', 'current', 'ahead']);
    expect(m.rungs[2].away).toEqual({ kind: 'away', units: 8, bringsIn: 3 });
    expect(m.rungs[2].waiting).toEqual({ agents: 3, units: 15 });
    expect(m.summary).toMatchObject({ v: 'bringsin', away: 8, k: 3, units: 27, membersIn: 9 });
    expect(m.notches).toEqual([]); // 20 and 50 are tier boundaries
    expect(m.rungs.map((r) => r.delta)).toEqual(['list', '−30%', '−50%']);
  });

  it('adds a below-minimum segment and a refunded summary', () => {
    const p = pool({
      status: 'Refunded', units_unconditional: 6, units_conditional: 0,
      offer: { ...pool().offer, max_units: 40, tiers: [{ min_units: 10, unit_price: NEAR('2.00') }, { min_units: 20, unit_price: NEAR('1.60') }] },
      projected: { units: 0, members_in: 0, tier_index: null, unit_price: null },
      result: { units: 0, members_in: 0, tier_index: null, unit_price: null, seller_payout: '0', resolved_at_ns: '1' }
    });
    const m = ladderModel(p, [member('a', 6, null, { outcome: 'Refunded' })]);
    expect(m.segs[0]).toMatchObject({ kind: 'below', from: 0, to: 10 });
    expect(m.segs[0].in).toBeCloseTo(0.6);
    expect(m.rungs[0].state).toBe('below-min');
    expect(m.summary).toEqual({ v: 'refunded', units: 6, min: 10 });
  });

  it('flags a threshold that is not a tier boundary as a notch', () => {
    const { pool: p, members } = pool7();
    members.push(member('odd', 3, 35));
    const m = ladderModel({ ...p, member_count: 13 }, members);
    expect(m.notches).toHaveLength(1);
  });

  it('colours tiers on the sequential ramp', () => {
    expect([0, 1, 2].map((i) => tierColorIndex(i, 3))).toEqual([1, 5, 8]);
    expect(tierColorIndex(0, 1)).toBe(8);
    expect(tierColorIndex(7, 8)).toBe(8);
  });

  it('settled pool 6: tier 3 of 3, half the list price', () => {
    const p = pool({
      status: 'Settled', units_unconditional: 55, units_conditional: 0,
      projected: { units: 55, members_in: 12, tier_index: 2, unit_price: NEAR('0.50') },
      result: { units: 55, members_in: 12, tier_index: 2, unit_price: NEAR('0.50'), seller_payout: NEAR('27.5'), resolved_at_ns: '1' }
    });
    const m = ladderModel(p, []);
    expect(m.summary).toEqual({ v: 'settled', tierNo: 3, tierCount: 3, units: 55, pctText: ', half the list price' });
    expect(m.rungs.map((r) => r.state)).toEqual(['passed', 'passed', 'current']);
    expect(m.rungs[2].statusText).toBe('Final price');
  });
});
