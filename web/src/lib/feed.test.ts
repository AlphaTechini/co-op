import { describe, expect, it } from 'vitest';
import { fromServer, partsFromText } from './feed';
import { member, pool7 } from './fixtures.test-util';

describe('feed', () => {
  it('turns account ids in server messages into agent parts', () => {
    const parts = partsFromText('bargain-04.operator.testnet joined, then eager-01.operator.testnet left.');
    expect(parts.filter((p) => p.t === 'agent').map((p) => p.v)).toEqual(['bargain-04', 'eager-01']);
    expect(parts.map((p) => p.v).join('')).toBe('bargain-04 joined, then eager-01 left.');
  });

  it('resolves join kind from the member threshold and keeps the reason verbatim', () => {
    const { pool, members } = pool7();
    const ctx = { pool, members: new Map(members.map((m) => [m.agent_id, m])) };
    const item = fromServer(
      { id: 1, ts: 1000, kind: 'pool_joined', pool_id: 7, agent_id: 'bargain-04.operator.testnet', message: 'x', reason: 'Only at 0.50.' },
      ctx
    );
    expect(item.kind).toBe('joined-conditional');
    expect(item.reason).toBe('Only at 0.50.');
    const text = item.parts.map((p) => p.v).join('');
    expect(text).toBe('bargain-04 joined on a condition: 5 units if the group reaches 50.');
  });

  it('never invents a reason', () => {
    const m = member('eager-09', 2, null);
    const item = fromServer(
      { id: 2, ts: 1, kind: 'pool_joined', pool_id: 7, agent_id: m.agent_id, message: 'joined' },
      { pool: null, members: new Map([[m.agent_id, m]]) }
    );
    expect(item.reason).toBeUndefined();
  });
});
