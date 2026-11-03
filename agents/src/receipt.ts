import { formatNear, formatPrice, sumBig } from "./money.js";
import type { Verification } from "./verify.js";

function pad(text: string, width: number, right = false): string {
  return right ? text.padStart(width) : text.padEnd(width);
}

/** Human-readable settlement receipt followed by the invariant check section. */
export function renderReceipt(v: Verification, labels: Map<string, string> = new Map()): string {
  const { pool, rows, checks } = v;
  const result = pool.result;
  const tiers = pool.offer.tiers.map((t) => `${t.min_units}+ at ${formatPrice(BigInt(t.unit_price))}`).join(" | ");
  const lines: string[] = [];
  lines.push(`SETTLEMENT RECEIPT  pool ${pool.id}  "${pool.offer.title}"`);
  lines.push(`seller ${pool.offer.seller}   item token ${pool.offer.item_token}`);
  lines.push(`tiers  ${tiers}`);
  if (result && result.tier_index !== null && result.unit_price) {
    const tier = pool.offer.tiers[result.tier_index];
    lines.push(
      `RESULT ${pool.status.toUpperCase()} at tier ${result.tier_index + 1} (${tier?.min_units}+ units): ${result.units} units from ${result.members_in} of ${rows.length} agents at ${formatPrice(BigInt(result.unit_price))} NEAR each`,
    );
  } else {
    lines.push(`RESULT ${pool.status.toUpperCase()}: no tier was reached, every agent got its full lock back, the seller was not paid`);
  }
  lines.push("");

  const header = [
    pad("agent", 14), pad("units", 5, true), pad("joined", 10), pad("limit", 6, true), pad("outcome", 9),
    pad("price/unit", 10, true), pad("paid", 8, true), pad("refund", 8, true), pad("tokens", 6, true), "delivery",
  ].join("  ");
  lines.push(header);
  lines.push("-".repeat(header.length));
  for (const r of rows) {
    const m = r.member;
    const label = labels.get(m.agent_id) ?? m.agent_id.split(".")[0] ?? m.agent_id;
    const perUnit = m.outcome === "Filled" && result?.unit_price ? formatPrice(BigInt(result.unit_price)) : "-";
    lines.push(
      [
        pad(label, 14),
        pad(String(m.units), 5, true),
        pad(m.threshold_units === null ? "now" : `if >= ${m.threshold_units}`, 10),
        pad(formatPrice(r.limit), 6, true),
        pad(m.outcome ?? "-", 9),
        pad(perUnit, 10, true),
        pad(formatNear(r.paid, 4, 2), 8, true),
        pad(formatNear(r.refunded, 4, 2), 8, true),
        pad(r.tokens.toString(), 6, true),
        m.delivery ?? "-",
      ].join("  "),
    );
  }
  lines.push("-".repeat(header.length));
  const totalPaid = sumBig(rows.map((r) => r.paid));
  const totalRefund = sumBig(rows.map((r) => r.refunded));
  lines.push(`total paid ${formatNear(totalPaid, 4, 2)} NEAR | total refunded ${formatNear(totalRefund, 4, 2)} NEAR | seller payout ${formatNear(BigInt(result?.seller_payout ?? "0"), 4, 2)} NEAR`);
  const first = pool.offer.tiers[0];
  if (first && result && result.units > 0) {
    const naive = BigInt(result.units) * BigInt(first.unit_price);
    const saved = naive - totalPaid;
    lines.push(`the same ${result.units} units at the entry price would have cost ${formatNear(naive, 4, 2)} NEAR: the group saved ${formatNear(saved, 4, 2)} NEAR`);
  }
  lines.push("");
  lines.push("INVARIANT CHECK (recomputed from chain views)");
  for (const c of checks) lines.push(`  [${c.pass ? "PASS" : "FAIL"}] ${c.name}: ${c.detail}`);
  lines.push(v.ok ? "ALL INVARIANTS HOLD" : "INVARIANT VIOLATION");
  return lines.join("\n");
}
