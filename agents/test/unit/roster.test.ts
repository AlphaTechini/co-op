import { describe, expect, it } from "vitest";
import { parseNear } from "../../src/money.js";
import { buildRoster, storyTiers } from "../../src/roster.js";

const top = parseNear("1");

describe("demo roster", () => {
  for (const n of [6, 10, 12, 20, 40]) {
    it(`${n} agents: the 20-unit tier is reached and the 50-unit tier is not`, () => {
      const roster = buildRoster(n, top);
      expect(roster).toHaveLength(n);
      expect(new Set(roster.map((r) => r.label)).size).toBe(n);
      const total = roster.reduce((a, r) => a + r.units, 0);
      const bargain50 = roster.filter((r) => r.kind === "bargain-50");
      const without50 = total - bargain50.reduce((a, r) => a + r.units, 0);
      expect(bargain50.length).toBeGreaterThanOrEqual(1);
      expect(total).toBeLessThan(50);
      if (n >= 10) expect(without50).toBeGreaterThanOrEqual(20);
      // eager agents alone stay below the 20-unit tier for the default sizes, so the bargain agents matter
      if (n <= 12) expect(roster.filter((r) => r.kind === "eager").reduce((a, r) => a + r.units, 0)).toBeLessThan(20);
    });
  }

  it("every budget covers its maximum lock plus storage", () => {
    for (const r of buildRoster(12, top)) {
      const lockPrice = r.kind === "eager" ? top : r.kind === "bargain-20" ? (top * 70n) / 100n : (top * 50n) / 100n;
      expect(r.budget).toBeGreaterThan(BigInt(r.units) * lockPrice + parseNear("0.02"));
    }
  });

  it("tiers are 100%, 70% and 50% of the entry price", () => {
    expect(storyTiers(top).map((t) => [t.min_units, t.unit_price])).toEqual([
      [1, parseNear("1").toString()],
      [20, parseNear("0.7").toString()],
      [50, parseNear("0.5").toString()],
    ]);
  });

  it("rejects absurd sizes", () => {
    expect(() => buildRoster(3, top)).toThrow();
    expect(() => buildRoster(100, top)).toThrow();
  });
});
