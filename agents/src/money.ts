/**
 * Money helpers. Everything is BigInt yoctoNEAR; strings only at the JSON boundary and for display.
 * Floats are never used for amounts.
 */

export const YOCTO_PER_NEAR = 10n ** 24n;
/** SPEC 1.4: covers NEP-145 registration on the item token (0.00125 NEAR). */
export const STORAGE_RESERVE = 1_250_000_000_000_000_000_000n;

/** "1.5" -> 1500000000000000000000000n. Exact; rejects more than 24 decimals, signs and exponents. */
export function parseNear(value: string): bigint {
  const text = value.trim();
  const match = /^(\d+)(?:\.(\d{1,24}))?$/.exec(text);
  if (!match) throw new Error(`Invalid NEAR amount "${value}": use a plain decimal such as 0.5`);
  const whole = BigInt(match[1] as string);
  const fraction = (match[2] ?? "").padEnd(24, "0");
  return whole * YOCTO_PER_NEAR + BigInt(fraction || "0");
}

/** Exact decimal string with trailing zeros removed ("1", "0.7", "0.00125"). */
export function yoctoToNearString(yocto: bigint): string {
  const negative = yocto < 0n;
  const abs = negative ? -yocto : yocto;
  const whole = abs / YOCTO_PER_NEAR;
  const fraction = (abs % YOCTO_PER_NEAR).toString().padStart(24, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/**
 * Display string rounded half-up to `decimals` places, then padded to at least `minDecimals`.
 * formatNear(1_000_000_000_000_000_000_000_000n) === "1.0000"
 */
export function formatNear(yocto: bigint, decimals = 4, minDecimals = decimals): string {
  const negative = yocto < 0n;
  const abs = negative ? -yocto : yocto;
  const unit = 10n ** BigInt(24 - decimals);
  const rounded = (abs + unit / 2n) / unit; // in units of 10^-decimals NEAR
  const scale = 10n ** BigInt(decimals);
  const whole = rounded / scale;
  let fraction = (rounded % scale).toString().padStart(decimals, "0");
  while (fraction.length > minDecimals && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

/** Unit price for memos and receipts: at least 2 decimals, up to 4 ("1.00", "0.70", "0.035"). */
export function formatPrice(yocto: bigint): string {
  return formatNear(yocto, 4, 2);
}

export function sumBig(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}

export const toBig = (value: string | number | bigint): bigint => BigInt(value);

/** Whole percentage of an amount, floor. pct(1 NEAR, 70) = 0.7 NEAR. */
export function pct(amount: bigint, percent: number): bigint {
  if (!Number.isInteger(percent) || percent < 0) throw new Error("percent must be a non-negative integer");
  return (amount * BigInt(percent)) / 100n;
}

export const teraGas = (n: number): bigint => BigInt(Math.round(n * 1e12));
export const formatTgas = (gas: bigint): string => (Number(gas) / 1e12).toFixed(2);
