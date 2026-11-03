import { describe, expect, it } from 'vitest';
import { describePolicy, matchPools, parseBrief } from './brief';
import { NEAR, pool } from './fixtures.test-util';

describe('parseBrief', () => {
  it('PRD example: bargain, 3 units, max 0.60', () => {
    const p = parseBrief('buy 3 API credits if the price drops below 0.6');
    expect(p).toMatchObject({ units: 3, archetype: 'bargain', mode: 'conditional', tierUnits: null, missing: [] });
    expect(p.maxPrice).toBe(BigInt(NEAR('0.6')));
  });
  it('eager: "buy 2 now if under 1.00"', () => {
    const p = parseBrief('buy 2 now if under 1.00');
    expect(p).toMatchObject({ units: 2, archetype: 'eager' });
    expect(p.maxPrice).toBe(BigInt(NEAR('1')));
  });
  it('tier brief: "buy 5 only at the 50-unit price"', () => {
    const p = parseBrief('buy 5 only at the 50-unit price');
    expect(p).toMatchObject({ units: 5, tierUnits: 50, archetype: 'bargain', maxPrice: null, missing: [] });
  });
  it('reports what is missing and never guesses', () => {
    expect(parseBrief('get me some credits')).toMatchObject({ units: null, maxPrice: null, missing: ['units', 'price'] });
    expect(parseBrief('buy 4 credits').missing).toEqual(['price']);
    expect(parseBrief('').missing).toEqual(['units', 'price']);
  });
  it('plain integer ceilings', () => {
    const p = parseBrief('take 6 units up to 2 NEAR');
    expect(p.units).toBe(6);
    expect(p.maxPrice).toBe(BigInt(NEAR('2')));
  });
});

describe('policy preview', () => {
  const p7 = pool();
  it('matches the best open pool and builds the mockup sentence', () => {
    const parsed = parseBrief('buy 3 API credits if the price drops below 0.6');
    const m = matchPools(parsed, [p7]);
    expect(m).toMatchObject({ poolId: 7, threshold: 50 });
    const v = describePolicy('rin', parsed, [p7]);
    expect(v.sentenceParts.map((x) => x.v).join('')).toBe('rin buys 3 units at 0.60 or less, so it waits for the group to reach 50.');
    expect(v.locksText).toBe('1.50');
    expect(v.joinsText).toBe('if group ≥ 50');
  });
  it('eager sentence', () => {
    const v = describePolicy('rin', parseBrief('buy 2 now if under 1.00'), [p7]);
    expect(v.sentenceParts.map((x) => x.v).join('')).toBe('rin buys 2 units now, at up to 1.00 per unit.');
  });
  it('no open pool: no match, no invented threshold', () => {
    const v = describePolicy('rin', parseBrief('buy 3 if it drops below 0.6'), []);
    expect(v.match).toBeNull();
    expect(v.locksText).toBe('1.80');
  });
});
