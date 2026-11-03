// Test fixtures only (never imported by app code). Shapes mirror the contract views.
import type { MemberView, PoolView } from './models';

export const NEAR = (s: string): string => {
  const [i, f = ''] = s.split('.');
  return (BigInt(i) * 10n ** 24n + BigInt(f.padEnd(24, '0'))).toString();
};

export const TIERS = [
  { min_units: 1, unit_price: NEAR('1.00') },
  { min_units: 20, unit_price: NEAR('0.70') },
  { min_units: 50, unit_price: NEAR('0.50') }
];

export function member(id: string, units: number, threshold: number | null, over: Partial<MemberView> = {}): MemberView {
  return {
    agent_id: `${id}.operator.testnet`, owner: 'operator.testnet', units, threshold_units: threshold,
    locked: NEAR('1.00'), memo: '', joined_at_ns: '0', projected_in: false,
    outcome: null, paid: null, refunded: null, delivery: null, ...over
  };
}

export function pool(over: Partial<PoolView> = {}): PoolView {
  return {
    id: 7,
    offer: {
      id: 7, seller: 'seller.operator.testnet', item_token: 'credits.operator.testnet', title: 'Inference credits',
      description: '', tiers: TIERS, max_units: 60, unit_amount: '1', inventory_held: '60',
      deadline_ns: '0', lock_window_ns: '0', lock_at_ns: '0', status: 'Open', created_at_ns: '0'
    },
    status: 'Open', member_count: 12, units_unconditional: 0, units_conditional: 0,
    projected: { units: 0, members_in: 0, tier_index: null, unit_price: null },
    result: null, settle_cursor: 0, ...over
  };
}

/** Pool #7 from the mockups: 27 in, 42 pledged, 12 agents, 3 waiting at 50. */
export function pool7(): { pool: PoolView; members: MemberView[] } {
  const members = [
    member('eager-01', 3, null, { projected_in: true }),
    member('eager-02', 2, null, { projected_in: true }),
    member('bargain-01', 3, 20, { projected_in: true }),
    member('eager-03', 4, null, { projected_in: true }),
    member('eager-04', 3, null, { projected_in: true }),
    member('bargain-02', 4, 20, { projected_in: true }),
    member('eager-05', 2, null, { projected_in: true }),
    member('eager-06', 4, null, { projected_in: true }),
    member('bargain-03', 2, 20, { projected_in: true }),
    member('bargain-04', 5, 50),
    member('bargain-05', 6, 50),
    member('bargain-06', 4, 50)
  ];
  const p = pool({
    units_unconditional: 18, units_conditional: 24,
    projected: { units: 27, members_in: 9, tier_index: 1, unit_price: NEAR('0.70') }
  });
  return { pool: p, members };
}
