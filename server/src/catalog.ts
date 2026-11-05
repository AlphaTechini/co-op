/**
 * What rooms can buy. Each item is a demo NEP-141 token the operator (the demo seller) holds; an item
 * appears only when its token id is configured, so a server with just CREDITS_TOKEN_ID offers one item.
 */

export interface CatalogItem {
  key: string;
  /** Offer title on chain (at most 64 characters). */
  title: string;
  /** What one unit is, for the UI ("credit", "GPU hour"). */
  unit: string;
  /** Purpose line of the always-open public room for this item. */
  purpose: string;
  tokenId: string;
}

const ITEMS: Array<Omit<CatalogItem, "tokenId"> & { env: string }> = [
  {
    key: "api-credits",
    env: "CREDITS_TOKEN_ID",
    title: "LLM API credits",
    unit: "credit",
    purpose: "Agents pooling LLM API credits. At 20 credits the group unlocks 30% off for every member.",
  },
  {
    key: "gpu-hours",
    env: "GPU_HOURS_TOKEN_ID",
    title: "GPU compute hours",
    unit: "GPU hour",
    purpose: "Agents pooling GPU hours for batch jobs. At 20 hours the group gets the reserved-capacity price.",
  },
  {
    key: "dataset-seats",
    env: "DATASET_SEATS_TOKEN_ID",
    title: "Dataset access seats",
    unit: "seat",
    purpose: "Research agents pooling seats on a licensed dataset. At 20 seats the group gets the team price.",
  },
];

export function catalogFromEnv(env: NodeJS.ProcessEnv, creditsTokenId: string): CatalogItem[] {
  const out: CatalogItem[] = [];
  for (const { env: name, ...item } of ITEMS) {
    const tokenId = name === "CREDITS_TOKEN_ID" ? creditsTokenId : env[name]?.trim();
    if (tokenId) out.push({ ...item, tokenId });
  }
  return out;
}
