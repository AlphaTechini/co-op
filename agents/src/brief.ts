/**
 * Natural-language brief -> structured Policy.
 * Rules parser (always available) + optional LLM structured output (OpenAI-compatible endpoint).
 * The LLM is never faked: with no key configured, or on any LLM error, the rules parser answers and
 * says so in `parser`.
 */
import OpenAI from "openai";
import { z } from "zod";
import { parseNear } from "./money.js";
import { validatePolicy } from "./policy.js";
import type { Archetype, Policy } from "./types.js";

export const MAX_BRIEF_UNITS = 1000;

export class BriefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BriefError";
  }
}

export interface ParsedBrief {
  policy: Policy;
  parser: "rules" | "llm";
  /** Set when an LLM was configured but failed and the rules parser answered instead. */
  llm_error?: string;
}

// ------------------------------------------------------------------------------------------------
// Rules parser
// ------------------------------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, dozen: 12, fifteen: 15, twenty: 20,
};
const WORD_PATTERN = Object.keys(NUMBER_WORDS).join("|");
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const NEAR_SUFFIX = String.raw`(?:\s*(?:near|n|ⓝ))?`;

/** Price phrases; the first one that matches earliest in the text wins. */
const PRICE_PATTERNS: RegExp[] = [
  new RegExp(
    String.raw`(?:below|under|less than|lower than|cheaper than|at most|at or below|up to|no more than|not more than|not above|not over|max(?:imum)?(?:\s+price)?(?:\s+of)?|limit(?:\s+of)?|drops?\s+to|falls?\s+to|goes\s+(?:down\s+)?to|<=?)\s*(?:than\s+)?(?:~|\$)?\s*${NUM}`,
    "g",
  ),
  new RegExp(String.raw`${NUM}${NEAR_SUFFIX}\s*(?:or|and)\s*(?:less|lower|below|under|cheaper)`, "g"),
  new RegExp(String.raw`(?:for|at)\s+${NUM}${NEAR_SUFFIX}\s*(?:each|per\s+\w+|apiece|a\s+piece)`, "g"),
  new RegExp(String.raw`${NUM}\s*(?:near|ⓝ)\b`, "g"),
];

const STRONG_BARGAIN = /\b(if|when|once|drops?|falls?|discount|bulk|group|wait(?:ing)?|only|bargain|target)\b/;
const WEAK_BARGAIN = /\b(below|under|less than|cheaper|or less|or lower)\b/;
const EAGER = /\b(now|asap|immediately|right away|straight away|urgent(?:ly)?|today|at once)\b/;
const SWITCHER = /\b(switch(?:er)?|best price|cheapest pool|whichever pool|any pool|other pool|another pool|move to)\b/;

function findPrice(text: string): { value: string; start: number; end: number } | null {
  let best: { value: string; start: number; end: number } | null = null;
  for (const pattern of PRICE_PATTERNS) {
    pattern.lastIndex = 0;
    const m = pattern.exec(text);
    if (m && m[1] !== undefined && (best === null || m.index < best.start)) {
      best = { value: m[1], start: m.index, end: m.index + m[0].length };
    }
  }
  return best;
}

function findUnits(text: string): number | null {
  const noun = String.raw`(?:[a-z-]+\s+){0,2}?(?:credits?|units?|vouchers?|tokens?|licen[cs]es?|tickets?|hours?|items?|seats?|calls?)`;
  const withNoun = new RegExp(String.raw`(?<![\d.])(\d+|${WORD_PATTERN})\s+${noun}\b`).exec(text);
  const afterVerb = new RegExp(
    String.raw`\b(?:buy|need|get|want|purchase|take|order|grab)\s+(?:about\s+|around\s+|up to\s+)?(?<![\d.])(\d+|${WORD_PATTERN})\b(?!\.\d)`,
  ).exec(text);
  const raw = withNoun?.[1] ?? afterVerb?.[1];
  if (raw === undefined) return null;
  return /^\d+$/.test(raw) ? Number(raw) : (NUMBER_WORDS[raw] ?? null);
}

function findSellers(text: string): string[] | undefined {
  const sellers = new Set<string>();
  for (const m of text.matchAll(/\bfrom\s+([a-z0-9][a-z0-9_-]*(?:\.[a-z0-9][a-z0-9_-]*)+)/g)) {
    if (m[1]) sellers.add(m[1]);
  }
  return sellers.size > 0 ? [...sellers] : undefined;
}

function pickArchetype(text: string): Archetype {
  if (SWITCHER.test(text)) return "switcher";
  if (STRONG_BARGAIN.test(text)) return "bargain";
  if (EAGER.test(text)) return "eager";
  if (WEAK_BARGAIN.test(text)) return "bargain";
  return "eager";
}

/** Deterministic keyword/regex parser. "below/under X" is treated as "at most X". */
export function parseBriefWithRules(brief: string): ParsedBrief {
  const text = brief.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (text === "") throw new BriefError("The brief is empty. Try: buy 3 credits if the price drops below 0.6");
  const price = findPrice(text);
  if (!price) {
    throw new BriefError(
      "I could not find a price limit in that brief. Try: buy 3 credits if the price drops below 0.6",
    );
  }
  const maxYocto = parseNear(price.value);
  if (maxYocto <= 0n) throw new BriefError("The price limit must be above zero.");
  // Remove the price phrase so its digits are not mistaken for a unit count.
  const withoutPrice = `${text.slice(0, price.start)} ${text.slice(price.end)}`;
  const units = findUnits(withoutPrice) ?? 1;
  if (units < 1 || units > MAX_BRIEF_UNITS) throw new BriefError(`Units must be between 1 and ${MAX_BRIEF_UNITS}.`);
  const archetype = pickArchetype(text);
  const policy: Policy = { archetype, units, max_unit_price: maxYocto.toString(), brief: brief.trim() };
  if (archetype === "bargain") policy.target_price = maxYocto.toString();
  const sellers = findSellers(text);
  if (sellers) policy.allowed_sellers = sellers;
  validatePolicy(policy);
  return { policy, parser: "rules" };
}

// ------------------------------------------------------------------------------------------------
// LLM parser (optional)
// ------------------------------------------------------------------------------------------------

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export function llmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmConfig | null {
  const baseUrl = env.LLM_BASE_URL;
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL;
  if (!baseUrl || !apiKey || !model) return null;
  return { baseUrl, apiKey, model };
}

const decimalNear = z.string().regex(/^\d+(\.\d{1,24})?$/, "decimal NEAR amount such as 0.6");

export const LlmPolicySchema = z.object({
  archetype: z.enum(["eager", "bargain", "switcher"]),
  units: z.number().int().min(1).max(MAX_BRIEF_UNITS),
  max_price_near: decimalNear,
  target_price_near: decimalNear.nullable(),
  allowed_sellers: z.array(z.string().min(2).max(64)).max(32).nullable(),
});
export type LlmPolicy = z.infer<typeof LlmPolicySchema>;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["archetype", "units", "max_price_near", "target_price_near", "allowed_sellers"],
  properties: {
    archetype: { type: "string", enum: ["eager", "bargain", "switcher"] },
    units: { type: "integer", minimum: 1, maximum: MAX_BRIEF_UNITS },
    max_price_near: { type: "string", description: "Highest price per unit in NEAR, decimal string like 0.6" },
    target_price_near: { type: ["string", "null"], description: "Bargain only: price the buyer waits for, else null" },
    allowed_sellers: { type: ["array", "null"], items: { type: "string" } },
  },
} as const;

const SYSTEM_PROMPT = [
  "You turn a buyer's one-line brief into a purchasing policy for a group-buying contract.",
  "eager: buy now at the entry price if it is within the limit.",
  "bargain: only buy when the group reaches a discount tier, price at or below the limit.",
  "switcher: buy in whichever open pool for the item projects the lowest price.",
  "Prices are per unit in NEAR. Never invent numbers that are not in the brief.",
].join(" ");

/** The slice of the OpenAI client this module uses (lets tests inject a stub client). */
export interface ChatClient {
  chat: {
    completions: {
      create(params: Record<string, unknown>): Promise<{ choices: { message: { content?: string | null } }[] }>;
    };
  };
}

export function createChatClient(config: LlmConfig): ChatClient {
  return new OpenAI({ baseURL: config.baseUrl, apiKey: config.apiKey }) as unknown as ChatClient;
}

export function policyFromLlm(brief: string, parsed: LlmPolicy): Policy {
  const max = parseNear(parsed.max_price_near);
  if (max <= 0n) throw new BriefError("The model returned a zero price limit.");
  const policy: Policy = { archetype: parsed.archetype, units: parsed.units, max_unit_price: max.toString(), brief: brief.trim() };
  if (parsed.archetype === "bargain") {
    const target = parsed.target_price_near === null ? max : parseNear(parsed.target_price_near);
    if (target <= 0n) throw new BriefError("The model returned a zero target price.");
    policy.target_price = (target < max ? target : max).toString();
  }
  if (parsed.allowed_sellers && parsed.allowed_sellers.length > 0) policy.allowed_sellers = parsed.allowed_sellers;
  validatePolicy(policy);
  return policy;
}

export async function parseBriefWithLlm(brief: string, config: LlmConfig, client?: ChatClient): Promise<Policy> {
  const chat = client ?? createChatClient(config);
  const response = await chat.chat.completions.create({
    model: config.model,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: brief },
    ],
    response_format: { type: "json_schema", json_schema: { name: "coop_policy", strict: true, schema: JSON_SCHEMA } },
  });
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("The model returned no content");
  return policyFromLlm(brief, LlmPolicySchema.parse(JSON.parse(content)));
}

/** LLM when configured and working, rules otherwise. `parser` always tells which one answered. */
export async function parseBrief(
  brief: string,
  options: { env?: NodeJS.ProcessEnv; client?: ChatClient } = {},
): Promise<ParsedBrief> {
  const config = llmConfigFromEnv(options.env ?? process.env);
  if (!config) return parseBriefWithRules(brief);
  try {
    return { policy: await parseBriefWithLlm(brief, config, options.client), parser: "llm" };
  } catch (e) {
    const rules = parseBriefWithRules(brief);
    return { ...rules, llm_error: e instanceof Error ? e.message : String(e) };
  }
}
