import { KeyPair } from "near-api-js";
import { addFunctionCallKey, agentSigner, createSubAccount } from "../../src/chain.js";
import { parseNear } from "../../src/money.js";
import { limitsFromPolicy } from "../../src/policy.js";
import { postOffer, type PostedOffer } from "../../src/seller.js";
import type { AgentLimits, Policy, Tier } from "../../src/types.js";
import { provisionAgent, type ProvisionedAgent, type World } from "../../src/world.js";

export const near = (s: string): string => parseNear(s).toString();

export const LADDER: Tier[] = [
  { min_units: 1, unit_price: near("1") },
  { min_units: 20, unit_price: near("0.7") },
  { min_units: 50, unit_price: near("0.5") },
];

export function eagerPolicy(units: number, max = "1"): Policy {
  return { archetype: "eager", units, max_unit_price: near(max) };
}

let counter = 0;
export const uniqueLabel = (prefix: string): string => `${prefix}${Date.now().toString(36).slice(-4)}${counter++}`;

export async function agent(world: World, prefix: string, policy: Policy, budget = "20", limits?: AgentLimits): Promise<ProvisionedAgent> {
  return provisionAgent(world, {
    label: uniqueLabel(prefix),
    limits: limits ?? limitsFromPolicy(policy),
    budget: parseNear(budget),
    gasBalance: parseNear("0.5"),
  });
}

export function offer(
  world: World,
  options: { tiers?: Tier[]; maxUnits?: number; durationMs?: number; lockWindowMs?: number; title?: string } = {},
): Promise<PostedOffer> {
  return postOffer(world.client, world.operator, world.tokenId, {
    title: options.title ?? "Test credits",
    description: "integration test offer",
    tiers: options.tiers ?? LADDER,
    maxUnits: options.maxUnits ?? 60,
    durationMs: options.durationMs ?? 20_000,
    lockWindowMs: options.lockWindowMs ?? 6_000,
  });
}

/** An agent whose function-call key may only call `methods` (default: the intended join/leave pair). */
export async function agentWithKeyMethods(world: World, prefix: string, policy: Policy, methods: string[]) {
  const created = await createSubAccount(world.client, world.operator, uniqueLabel(prefix), parseNear("0.5"));
  const full = agentSigner(created.accountId, world.provider, (created.keyPair as KeyPair).toString());
  const key = await addFunctionCallKey(world.client, full, world.coopId, methods);
  await world.client.registerAgent(world.operator, created.accountId, limitsFromPolicy(policy), parseNear("10"));
  return { id: created.accountId, account: agentSigner(created.accountId, world.provider, key.keyPair.toString()), full };
}
