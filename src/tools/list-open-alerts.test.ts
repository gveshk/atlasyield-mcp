import { describe, it, expect } from 'vitest';
import { AtlasClient, type AlertItem } from '../atlas-client.js';
import { listOpenAlerts } from './list-open-alerts.js';

function alert(p: Partial<AlertItem>): AlertItem {
  return {
    id: 'a1', vaultId: 'morpho:1:0xa', chainId: 1, protocolId: 'morpho', asset: 'USDC',
    trigger: 'TVL_FLIGHT', severity: 2, scoreBefore: 70, scoreAfter: 60,
    bandBefore: 'Balanced', bandAfter: 'Aggressive', pillarDeltas: {}, apyBefore: 5, apyAfter: 1,
    ...p,
  };
}

function clientWith(events: AlertItem[]) {
  return new AtlasClient({
    fetch: (async () => new Response(JSON.stringify({
      date: '2026-09-12', publishedAt: '2026-09-12T00:10:05.953Z', monitorVersion: 'mv-1', windowDays: 90, events,
    }), { status: 200 })) as typeof fetch,
  });
}

describe('list_open_alerts', () => {
  it('returns every event with the snapshot metadata when unfiltered', async () => {
    const res = await listOpenAlerts(clientWith([alert({ id: 'a1' }), alert({ id: 'a2', chainId: 8453 })]), {});
    const s = res.structuredContent!;
    expect(s['count']).toBe(2);
    expect(s['date']).toBe('2026-09-12');
    expect(s['monitorVersion']).toBe('mv-1');
    expect(s['windowDays']).toBe(90);
  });

  it('filters by chainId and minSeverity', async () => {
    const events = [
      alert({ id: 'low', severity: 1 }),
      alert({ id: 'hi', severity: 3 }),
      alert({ id: 'base', severity: 3, chainId: 8453 }),
    ];
    const res = await listOpenAlerts(clientWith(events), { chainId: 1, minSeverity: 2 });
    expect((res.structuredContent!['events'] as AlertItem[]).map((e) => e.id)).toEqual(['hi']);
  });

  it('zero events is count 0, not an error', async () => {
    const res = await listOpenAlerts(clientWith([]), {});
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.['count']).toBe(0);
  });
});
