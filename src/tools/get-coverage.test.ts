import { describe, it, expect } from 'vitest';
import { AtlasClient, type ScoreRow } from '../atlas-client.js';
import { getCoverage } from './get-coverage.js';

function row(p: Partial<ScoreRow>): ScoreRow {
  return {
    vaultId: 'x:1:0x1', chainId: 1, protocolId: 'morpho', asset: 'USDC', assetClass: null,
    composite: 70, label: 'Balanced', pillarScores: {}, apy: 1, tvl: 100,
    dataQuality: 'sufficient', scoredAt: '2026-09-15T04:00:00.000Z', scorerVersion: '2.1.0',
    yieldQuality: null, yieldQualityReason: null, exitSafety: null, exitSafetyReason: null,
    ...p,
  };
}

const ROWS = [
  row({ vaultId: 'morpho:1:0xa', chainId: 1, protocolId: 'morpho', composite: 60, tvl: 100 }),
  row({ vaultId: 'aave-v3:1:0xb', chainId: 1, protocolId: 'aave-v3', composite: 80, tvl: 200 }),
  row({ vaultId: 'morpho:8453:0xc', chainId: 8453, protocolId: 'morpho', composite: 70, tvl: null }),
];

function clientWith(rows: ScoreRow[], seen: string[] = []) {
  return new AtlasClient({
    fetch: (async (input: RequestInfo | URL) => {
      seen.push(input.toString());
      return new Response(JSON.stringify({ success: true, scorerVersion: '2.1.0', count: rows.length, data: rows }), { status: 200 });
    }) as typeof fetch,
  });
}

describe('get_coverage', () => {
  it('summarises the scored universe: counts, TVL, composite spread, by-protocol, by-chain', async () => {
    const res = await getCoverage(clientWith(ROWS), {});
    const s = res.structuredContent!;
    expect(s['vaultCount']).toBe(3);
    expect(s['tvlUsd']).toBe(300);
    expect(s['composite']).toEqual({ min: 60, median: 70, max: 80 });
    expect(s['byProtocol']).toEqual({ morpho: 2, 'aave-v3': 1 });
    expect(s['byChain']).toEqual({ '1': 2, '8453': 1 });
    expect(s['scorerVersion']).toBe('2.1.0');
  });

  it('passes filters through to /scores', async () => {
    const seen: string[] = [];
    await getCoverage(clientWith(ROWS, seen), { chainId: 8453, protocolId: 'morpho' });
    expect(seen[0]).toContain('/scores?chainId=8453&protocolId=morpho');
  });

  it('empty universe is vaultCount 0 with null spread, not an error', async () => {
    const res = await getCoverage(clientWith([]), { protocolId: 'spark' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.['vaultCount']).toBe(0);
    expect(res.structuredContent?.['composite']).toBeNull();
  });
});
