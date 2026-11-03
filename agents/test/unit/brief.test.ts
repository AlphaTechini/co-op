import { describe, expect, it } from "vitest";
import {
  BriefError,
  parseBrief,
  parseBriefWithLlm,
  parseBriefWithRules,
  type ChatClient,
} from "../../src/brief.js";
import { parseNear } from "../../src/money.js";

const near = (s: string) => parseNear(s).toString();

describe("rules brief parser", () => {
  const cases: Array<{ brief: string; archetype: string; units: number; max: string; target?: string }> = [
    { brief: "buy 3 API credits if the price drops below 0.6", archetype: "bargain", units: 3, max: "0.6", target: "0.6" },
    { brief: "need 2 credits now, up to 1.1", archetype: "eager", units: 2, max: "1.1" },
    { brief: "I want 5 credits under 0.8", archetype: "bargain", units: 5, max: "0.8", target: "0.8" },
    { brief: "Buy 1 credit, max 1.00", archetype: "eager", units: 1, max: "1" },
    { brief: "get four vouchers asap at most 0.95", archetype: "eager", units: 4, max: "0.95" },
    { brief: "wait for the bulk discount: 10 credits, 0.5 or less", archetype: "bargain", units: 10, max: "0.5", target: "0.5" },
    { brief: "purchase 7 units immediately for up to 1.05 NEAR", archetype: "eager", units: 7, max: "1.05" },
    { brief: "Only buy 2 credits when they cost less than 0.7 NEAR each", archetype: "bargain", units: 2, max: "0.7", target: "0.7" },
    { brief: "two credits right away, limit of 1.2", archetype: "eager", units: 2, max: "1.2" },
    { brief: "take 6 tokens if price falls to 0.55", archetype: "bargain", units: 6, max: "0.55", target: "0.55" },
    { brief: "grab a credit today at most 1", archetype: "eager", units: 1, max: "1" },
    { brief: "order 12 credits, cheaper than 0.65", archetype: "bargain", units: 12, max: "0.65", target: "0.65" },
    { brief: "buy 3 credits at the best price across pools, up to 0.9", archetype: "switcher", units: 3, max: "0.9" },
    { brief: "I need about 8 API credits <= 0.75", archetype: "eager", units: 8, max: "0.75" },
    { brief: "BUY 20 CREDITS IF PRICE DROPS TO 0.5", archetype: "bargain", units: 20, max: "0.5", target: "0.5" },
  ];

  for (const c of cases) {
    it(`parses: ${c.brief}`, () => {
      const r = parseBriefWithRules(c.brief);
      expect(r.parser).toBe("rules");
      expect(r.policy.archetype).toBe(c.archetype);
      expect(r.policy.units).toBe(c.units);
      expect(r.policy.max_unit_price).toBe(near(c.max));
      expect(r.policy.target_price).toBe(c.target === undefined ? undefined : near(c.target));
      expect(r.policy.brief).toBe(c.brief);
    });
  }

  it("extracts allowed sellers", () => {
    const r = parseBriefWithRules("buy 2 credits only from seller.testnet if below 0.7");
    expect(r.policy.allowed_sellers).toEqual(["seller.testnet"]);
  });

  it("does not mistake price digits for units", () => {
    expect(parseBriefWithRules("credits please, up to 3").policy.units).toBe(1);
  });

  it("rejects briefs with no price", () => {
    expect(() => parseBriefWithRules("buy some credits")).toThrow(BriefError);
    expect(() => parseBriefWithRules("   ")).toThrow(BriefError);
  });

  it("rejects zero price and absurd unit counts", () => {
    expect(() => parseBriefWithRules("buy 2 credits at most 0")).toThrow(BriefError);
    expect(() => parseBriefWithRules("buy 5000 credits up to 1")).toThrow(BriefError);
  });
});

function stubClient(content: string | Error): ChatClient {
  return {
    chat: {
      completions: {
        create: async () => {
          if (content instanceof Error) throw content;
          return { choices: [{ message: { content } }] };
        },
      },
    },
  };
}

// These tests exercise OUR validation and fallback logic around a client; the stub is not model output
// presented as real.
describe("llm path validation and fallback", () => {
  const config = { baseUrl: "http://llm.invalid/v1", apiKey: "k", model: "m" };
  const env = { LLM_BASE_URL: config.baseUrl, LLM_API_KEY: "k", LLM_MODEL: "m" } as NodeJS.ProcessEnv;

  it("accepts a well-formed structured answer", async () => {
    const answer = JSON.stringify({ archetype: "bargain", units: 3, max_price_near: "0.6", target_price_near: null, allowed_sellers: null });
    const policy = await parseBriefWithLlm("buy 3 if below 0.6", config, stubClient(answer));
    expect(policy).toMatchObject({ archetype: "bargain", units: 3, max_unit_price: near("0.6"), target_price: near("0.6") });
  });

  it("rejects an answer that fails the schema", async () => {
    const bad = JSON.stringify({ archetype: "wizard", units: 3, max_price_near: "0.6", target_price_near: null, allowed_sellers: null });
    await expect(parseBriefWithLlm("x", config, stubClient(bad))).rejects.toThrow();
  });

  it("falls back to rules on LLM errors and says so", async () => {
    const r = await parseBrief("buy 3 API credits if the price drops below 0.6", { env, client: stubClient(new Error("503")) });
    expect(r.parser).toBe("rules");
    expect(r.llm_error).toContain("503");
    expect(r.policy.units).toBe(3);
  });

  it("uses rules (no fake LLM) when no LLM is configured", async () => {
    const r = await parseBrief("need 2 credits now, up to 1.1", { env: {} as NodeJS.ProcessEnv });
    expect(r.parser).toBe("rules");
    expect(r.llm_error).toBeUndefined();
  });

  it("reports parser=llm when the model answered", async () => {
    const answer = JSON.stringify({ archetype: "eager", units: 2, max_price_near: "1.1", target_price_near: null, allowed_sellers: null });
    const r = await parseBrief("need 2 credits now, up to 1.1", { env, client: stubClient(answer) });
    expect(r.parser).toBe("llm");
  });
});
