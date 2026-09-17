import { describe, it, expect } from 'vitest';
import { AtlasClient, type ScoreRow } from '../atlas-client.js';
import { compareVaults } from './compare-vaults.js';

const base: Omit<ScoreRow, 'vaultId' | 'chainId' | 'composite' | 'name'> = {
  protocolId: 'morpho', asset: 'USDC', assetClass: 'stable', label: 'Balanced',
  pillarScores: { yield: 60, safety: 70, liquidity: 60, sustainability: 80 },
  apy: 4, tvl: 1_000_000, dataQuality: 'sufficient',
  scoredAt: '2026-09-15T04:00:00.000Z', scorerVersion: '2.1.0',
  yieldQuality: null, yieldQualityReason: null, exitSafety: null, exitSafetyReason: null,
};
const BASE_A: ScoreRow = { ...base, vaultId: 'morpho:8453:0xaaa', chainId: 8453, composite: 65, name: 'A' };
const BASE_B: ScoreRow = { ...base, vaultId: 'morpho:8453:0xbbb', chainId: 8453, composite: 72, name: 'B' };
const ETH_C:  ScoreRow = { ...base, vaultId: 'aave-v3:1:0xccc', chainId: 1, composite: 80, name: 'C' };

function clientWith(seen: string[] = []) {
  return new AtlasClient({
    fetch: (async (input: RequestInfo | URL) => {
      const url = input.toString();
      seen.push(url);
      const rows = url.includes('chainId=8453') ? [BASE_A, BASE_B] : url.includes('chainId=1') ? [ETH_C] : [];
      return new Response(JSON.stringify({ success: true, scorerVersion: '2.1.0', count: rows.length, data: rows }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });
}

describe('compare_vaults', () => {
  it('fetches once per chain, keeps input order, ranks by composite, keeps unscored as found:false', async () => {
    const seen: string[] = [];
    const res = await compareVaults(clientWith(seen), {
      vaults: [
        { chainId: 8453, address: '0xAAA' },
        { chainId: 1,    address: '0xccc' },
        { chainId: 8453, address: '0xbbb' },
        { chainId: 8453, address: '0xdead' },
      ],
    });
    expect(res.isError).toBeUndefined();
    expect(seen).toHaveLength(2);

    const vaults = res.structuredContent!['vaults'] as Array<{ found: boolean; address: string }>;
    expect(vaults.map((v) => [v.address, v.found])).toEqual([
      ['0xaaa', true], ['0xccc', true], ['0xbbb', true], ['0xdead', false],
    ]);
    const ranking = res.structuredContent!['ranking'] as Array<{ rank: number; name: string | null }>;
    expect(ranking.map((r) => r.name)).toEqual(['C', 'B', 'A']);
    expect(ranking[0]?.rank).toBe(1);
  });

  it('surfaces an upstream failure as isError', async () => {
    const client = new AtlasClient({
      fetch: (async () => new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 })) as typeof fetch,
    });
    const res = await compareVaults(client, { vaults: [{ chainId: 1, address: '0x1' }, { chainId: 1, address: '0x2' }] });
    expect(res.isError).toBe(true);
  });
});
