import { describe, it, expect } from 'vitest';
import { AtlasClient, type CompactScoreRow } from '../atlas-client.js';
import { findVaults, resolveChain } from './find-vaults.js';

const ROW: CompactScoreRow = {
  vaultId: 'morpho:8453:0xbbb2', chainId: 8453, protocolId: 'morpho', name: 'Morpho USDC', asset: 'USDC',
  composite: 80, label: 'Good', apy: 8, tvl: 2_000_000, dataQuality: 'sufficient', routable: true,
  scoredAt: '2026-10-08T04:00:00.000Z', pageUrl: 'https://atlasyield.club/vaults/morpho/8453/0xbbb2',
};

function clientWith(rows: CompactScoreRow[], opts: { total?: number; seen?: string[] } = {}) {
  return new AtlasClient({
    fetch: (async (input: RequestInfo | URL) => {
      opts.seen?.push(input.toString());
      return new Response(JSON.stringify({
        success: true, scorerVersion: '2.3.0', count: rows.length, total: opts.total ?? rows.length, data: rows,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
}

describe('resolveChain', () => {
  it.each([
    ['base', 8453], ['Base', 8453], ['ethereum', 1], ['eth', 1], ['mainnet', 1], ['arbitrum', 42161],
    ['optimism', 10], ['op', 10], ['bnb', 56], ['bsc', 56], ['solana', 792703809],
  ])('%s -> %d', (name, id) => {
    expect(resolveChain(name)).toBe(id);
  });
  it('passes a numeric chain id through, including a numeric string', () => {
    expect(resolveChain(8453)).toBe(8453);
    expect(resolveChain('8453')).toBe(8453);
  });
  it('returns undefined for an unknown name', () => {
    expect(resolveChain('narnia')).toBeUndefined();
  });
});

describe('find_vaults', () => {
  it('sends the compact, routable, non-fallback, composite-ranked query by default', async () => {
    const seen: string[] = [];
    await findVaults(clientWith([ROW], { seen }), { asset: 'USDC', chain: 'base' });
    const url = new URL(seen[0]!);
    expect(url.pathname.endsWith('/scores')).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      asset: 'USDC', chainId: '8453', routable: 'true', excludeFallback: 'true',
      sort: 'composite', limit: '5', fields: 'compact',
    });
  });

  it('forwards the optional filters and clamps limit to 10', async () => {
    const seen: string[] = [];
    await findVaults(clientWith([ROW], { seen }), {
      protocolId: 'morpho', minScore: 70, minTvlUsd: 1_000_000, sortBy: 'apy', limit: 50,
    });
    const q = new URL(seen[0]!).searchParams;
    expect(q.get('protocolId')).toBe('morpho');
    expect(q.get('minScore')).toBe('70');
    expect(q.get('minTvl')).toBe('1000000');
    expect(q.get('sort')).toBe('apy');
    expect(q.get('limit')).toBe('10');
  });

  it('returns ranked compact rows, the matched/returned counts, and a pointer to the deposit check', async () => {
    const res = await findVaults(clientWith([ROW], { total: 12 }), { asset: 'USDC', chain: 'base' });
    expect(res.isError).toBeUndefined();
    const out = res.structuredContent!;
    expect(out['returned']).toBe(1);
    expect(out['matched']).toBe(12);
    expect(out['vaults']).toEqual([ROW]);
    expect(String(out['rankedBy'])).toMatch(/not a recommendation/i);
    expect(String(out['next'])).toMatch(/check_route_survival/);
    expect(JSON.stringify(out)).not.toMatch(/safest/i);
  });

  it('an empty result is data with a note, not an error', async () => {
    const res = await findVaults(clientWith([]), { asset: 'USDC', chain: 'base' });
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent!['returned']).toBe(0);
    expect(String(res.structuredContent!['note'])).toMatch(/no routable vaults matched/i);
  });

  it('an unknown chain name is a clear error that lists what is supported', async () => {
    const seen: string[] = [];
    const res = await findVaults(clientWith([ROW], { seen }), { chain: 'narnia' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toMatch(/narnia/);
    expect(res.content[0]?.text).toMatch(/base/);
    expect(seen).toHaveLength(0);
  });

  it('surfaces an upstream failure as isError with the message', async () => {
    const client = new AtlasClient({
      fetch: (async () => new Response(JSON.stringify({ success: false, error: 'boom' }), { status: 500 })) as typeof fetch,
    });
    const res = await findVaults(client, { asset: 'USDC' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text).toContain('boom');
  });
});
