import { describe, expect, it } from "vitest";
import { loadSettings } from "../../src/settings.js";

describe("loadSettings", () => {
  it("has sandbox and testnet defaults", () => {
    const sandbox = loadSettings({}, "sandbox");
    expect(sandbox).toMatchObject({ port: 8787, corsOrigin: "*", sellerLoop: true, spawnMaxAgents: 40, spawnPerIpPerHour: 3 });
    expect(sandbox.priceScale).toBe(10n ** 24n);
    const testnet = loadSettings({}, "testnet");
    expect(testnet.sellerLoop).toBe(false);
    expect(testnet.priceScale).toBe(50_000_000_000_000_000_000_000n);
  });

  it("reads overrides exactly and rejects nonsense", () => {
    const s = loadSettings({ PORT: "9000", PRICE_SCALE: "0.05", SELLER_LOOP: "1", SETTLER: "0", SPAWN_MAX_BUDGET_NEAR: "1.5" }, "testnet");
    expect(s).toMatchObject({ port: 9000, sellerLoop: true, settler: false, spawnMaxBudgetNear: 1.5 });
    expect(() => loadSettings({ PORT: "abc" }, "sandbox")).toThrow(/PORT/);
    expect(() => loadSettings({ PRICE_SCALE: "0" }, "sandbox")).toThrow(/PRICE_SCALE/);
    expect(() => loadSettings({ SELLER_LOOP: "maybe" }, "sandbox")).toThrow(/SELLER_LOOP/);
  });
});
