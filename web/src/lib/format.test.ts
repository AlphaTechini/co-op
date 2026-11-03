import { describe, expect, it } from 'vitest';
import {
  STORAGE_RESERVE, THIN_SPACE, discountPct, fmtCountdown, formatNear, formatNearExact, parseNear, shortHash, splitAccount
} from './format';
import { NEAR } from './fixtures.test-util';

describe('formatNear', () => {
  it('shows at least 2 decimals and trims further zeros', () => {
    expect(formatNear(NEAR('0.5'))).toBe('0.50');
    expect(formatNear(NEAR('1'))).toBe('1.00');
    expect(formatNear(NEAR('0.7'))).toBe('0.70');
  });
  it('keeps up to 5 decimals when needed to be exact', () => {
    expect(formatNear(STORAGE_RESERVE)).toBe('0.00125');
    expect(formatNear(NEAR('0.1234567'))).toBe('0.12346');
  });
  it('rounds half up for 2dp tiles', () => {
    expect(formatNear(NEAR('27.505'), { min: 2, max: 2 })).toBe('27.51');
    expect(formatNear(NEAR('27.504'), { min: 2, max: 2 })).toBe('27.50');
  });
  it('uses a thin space above 9 999 and never loses precision on huge values', () => {
    expect(formatNear(NEAR('9999.5'))).toBe('9999.50');
    expect(formatNear(NEAR('12345.25'))).toBe(`12${THIN_SPACE}345.25`);
    expect(formatNear(10n ** 30n + 1n, { max: 5 })).toBe(`1${THIN_SPACE}000${THIN_SPACE}000.00`);
  });
  it('matches the pool #6 reconciliation: 43.915 = 27.5 + 16.4 + 0.015', () => {
    const paid = BigInt(NEAR('27.5'));
    const refunded = BigInt(NEAR('16.4'));
    const storage = 12n * STORAGE_RESERVE;
    expect(formatNearExact(paid + refunded + storage, 3)).toBe('43.915');
    expect(formatNearExact(storage, 3)).toBe('0.015');
    expect(formatNearExact(paid, 3)).toBe('27.500');
  });
});

describe('helpers', () => {
  it('parseNear', () => {
    expect(parseNear('0.6')).toBe(BigInt(NEAR('0.6')));
    expect(parseNear('2')).toBe(BigInt(NEAR('2')));
    expect(parseNear('-1')).toBeNull();
    expect(parseNear('abc')).toBeNull();
  });
  it('discount', () => {
    expect(discountPct(BigInt(NEAR('1')), BigInt(NEAR('0.7')))).toBe(30);
    expect(discountPct(BigInt(NEAR('1')), BigInt(NEAR('0.5')))).toBe(50);
  });
  it('countdown formats', () => {
    expect(fmtCountdown(222_000)).toBe('03:42');
    expect(fmtCountdown(3_723_000)).toBe('1:02:03');
    expect(fmtCountdown(2 * 86400_000 + 4 * 3600_000)).toBe('2d 4h');
    expect(fmtCountdown(-5)).toBe('00:00');
  });
  it('hash and account', () => {
    expect(shortHash('9fKq3TzWbY7rLmN2xVcD8sHgPjA4uE6tRy1oQwZkB5vF')).toBe('9fKq…B5vF');
    expect(splitAccount('bargain-01.operator.testnet')).toEqual(['bargain-01', '.operator.testnet']);
  });
});
