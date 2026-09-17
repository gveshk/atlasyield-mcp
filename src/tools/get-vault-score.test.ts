import { describe, it, expect } from 'vitest';
import { AtlasClient, type ScoreRow } from '../atlas-client.js';
import { getVaultScore } from './get-vault-score.js';

const ROW: ScoreRow = {
  vaultId: 'morpho:8453:0x09832347586e238841f49149c84d121bc2191c53',
  chainId: 8453, protocolId: 'morpho', name: 'Morpho WETH', asset: 'WETH', assetClass: null,
  composite: 69.215, label: 'Balanced',
  pillarScores: { yield: 68.5, safety: 68.3, liquidity: 60, sustainability: 80 },
  apy: 3.1, tvl: 12_000_000, dataQuality: 'sufficient',
  scoredAt: '2026-09-15T04:00:00.000Z', scorerVersion: '2.1.0',
  yieldQuality: null, yieldQualityReason: null, exitSafety: null, exitSafetyReason: null,
};

function clientWith(rows: ScoreRow[], seen: string[] = []) {
  return new AtlasClient({
    fetch: (async (input: RequestInfo | URL) => {
      seen.push(input.toString());
      return new Response(JSON.stringify({ success: true, scorerVersion: '2.1.0', count: rows.length, data: rows }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch,
  });
}

describe('get_vault_score', () => {
  it('returns the row for a chain+address match, case-insensitive on address', async () => {
    const seen: string[] = [];
    const res = await getVaultScore(clientWith([ROW], seen), {
      chainId: 8453, address: '0x09832347586E238841F49149C84D121BC2191C53',
    });
    expect(res.isError).toBeUndefined();
    expect(seen[0]).toContain('/scores?chainId=8453');
    expect(res.structuredContent?.['found']).toBe(true);
    expect(res.structuredContent?.['vault']).toMatchObject({ vaultId: ROW.vaultId, composite: 69.215 });
  });

  it('is an honest not-found, not an error, when the address is unscored', async () => {
    const res = await getVaultScore(clientWith([ROW]), { chainId: 8453, address: '0xdead' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.['found']).toBe(false);
    expect(res.structuredContent?.['vault']).toBeNull();
  });

  it('surfaces an upstream failure as isError with the message', async () => {
    const client = new AtlasClient({
      fetch: (async () => new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 })) as typeof fetch,
    });
    const res = await getVaultScore(client, { chainId: 1, address: '0x1' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('boom');
  });
});
