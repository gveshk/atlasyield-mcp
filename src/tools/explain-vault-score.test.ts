import { describe, it, expect } from 'vitest';
import { AtlasClient, type FactorsData } from '../atlas-client.js';
import { explainVaultScore } from './explain-vault-score.js';

const DATA: FactorsData = {
  vaultId: 'morpho:8453:0x09832347586e238841f49149c84d121bc2191c53',
  chainId: 8453, protocolId: 'morpho', composite: 69.2, label: 'Balanced',
  pillarScores: { yield: 68.5, safety: 68.3, liquidity: 60, sustainability: 80 },
  factors: {
    YIELD_LEVEL:     { score: 40, weight: 0.3, rawValue: 3.1, label: '3.1% APY', pillar: 'yield' },
    AUDIT_QUALITY:   { score: 90, weight: 0.2, rawValue: 4,   label: '4 audits',  pillar: 'safety' },
    WITHDRAWAL_TYPE: { score: 60, weight: 0.5, rawValue: 0,   label: 'instant',   pillar: 'liquidity' },
    EXPLOIT_HISTORY: { score: 10, weight: 0,   rawValue: 0.1, label: 'multiplier 0.10', pillar: 'safety' },
  },
  dataQuality: 'sufficient', scoredAt: '2026-09-15T04:00:00.000Z', scorerVersion: '2.1.0',
};

function clientWith(status: number, body: unknown, seen: string[] = []) {
  return new AtlasClient({
    fetch: (async (input: RequestInfo | URL) => {
      seen.push(input.toString());
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
}

describe('explain_vault_score', () => {
  it('groups factors by pillar and names the weakest additive factors', async () => {
    const seen: string[] = [];
    const res = await explainVaultScore(clientWith(200, { success: true, data: DATA }, seen), {
      chainId: 8453, address: '0x09832347586E238841F49149C84D121BC2191C53',
    });
    expect(res.isError).toBeUndefined();
    expect(seen[0]).toContain('/vaults/8453/0x09832347586e238841f49149c84d121bc2191c53/factors');
    const sc = res.structuredContent!;
    expect(sc['found']).toBe(true);
    expect(sc['composite']).toBe(69.2);
    const byPillar = sc['factorsByPillar'] as Record<string, Record<string, unknown>>;
    expect(Object.keys(byPillar['yield']!)).toEqual(['YIELD_LEVEL']);
    expect(Object.keys(byPillar['safety']!).sort()).toEqual(['AUDIT_QUALITY', 'EXPLOIT_HISTORY']);
    // EXPLOIT_HISTORY (weight 0) has the lowest score but must not be listed as "weakest".
    const weakest = sc['weakestFactors'] as Array<{ factor: string }>;
    expect(weakest.map((w) => w.factor)).toEqual(['YIELD_LEVEL', 'WITHDRAWAL_TYPE', 'AUDIT_QUALITY']);
  });

  it('is an honest not-found on 404, not an error', async () => {
    const res = await explainVaultScore(clientWith(404, { success: false, error: 'No score found for this vault' }), {
      chainId: 1, address: '0xdead',
    });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent?.['found']).toBe(false);
  });

  it('surfaces a non-404 upstream failure as isError', async () => {
    const res = await explainVaultScore(clientWith(500, { success: false, error: 'boom' }), { chainId: 1, address: '0x1' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('boom');
  });
});
