import { describe, expect, it } from "vitest";
import { STORAGE_RESERVE, YOCTO_PER_NEAR, formatNear, formatPrice, parseNear, pct, sumBig, yoctoToNearString } from "../../src/money.js";

describe("money", () => {
  it("parses decimals exactly", () => {
    expect(parseNear("1")).toBe(YOCTO_PER_NEAR);
    expect(parseNear("0.00125")).toBe(STORAGE_RESERVE);
    expect(parseNear("0.000000000000000000000001")).toBe(1n);
    expect(parseNear("123456789.5")).toBe(123456789n * YOCTO_PER_NEAR + YOCTO_PER_NEAR / 2n);
  });

  it("rejects floats, signs, exponents and over-precision", () => {
    for (const bad of ["", "-1", "1e3", "1.", ".5", "0.0000000000000000000000001", "1,5", "abc"]) {
      expect(() => parseNear(bad)).toThrow();
    }
  });

  it("formats without losing precision", () => {
    expect(yoctoToNearString(parseNear("0.7"))).toBe("0.7");
    expect(yoctoToNearString(1n)).toBe("0.000000000000000000000001");
    expect(formatNear(parseNear("1"))).toBe("1.0000");
    expect(formatNear(parseNear("2.00125"), 4, 2)).toBe("2.0013");
    expect(formatNear(parseNear("0.5"), 4, 2)).toBe("0.50");
    expect(formatNear(-parseNear("0.5"), 2)).toBe("-0.50");
  });

  it("formats prices with 2 to 4 decimals", () => {
    expect(formatPrice(parseNear("1"))).toBe("1.00");
    expect(formatPrice(parseNear("0.7"))).toBe("0.70");
    expect(formatPrice(parseNear("0.035"))).toBe("0.035");
  });

  it("does integer percentage math", () => {
    expect(pct(parseNear("1"), 70)).toBe(parseNear("0.7"));
    expect(pct(parseNear("0.05"), 50)).toBe(parseNear("0.025"));
    expect(sumBig([1n, 2n, 3n])).toBe(6n);
  });
});
