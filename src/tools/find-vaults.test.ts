import { describe, it, expect } from 'vitest';
import { AtlasClient, type CompactScoreRow, type ExplainBlock } from '../atlas-client.js';
import { findVaults, resolveChain } from './find-vaults.js';

const ROW: CompactScoreRow = {
  vaultId: 'morpho:8453:0xbbb2', chainId: 8453, protocolId: 'morpho', name: 'Morpho USDC', asset: 'USDC',
  composite: 80, label: 'Good', apy: 8, tvl: 2_000_000, dataQuality: 'sufficient', routable: true, flags: [],
  scoredAt: '2026-10-08T04:00:00.000Z', pageUrl: 'https://atlasyield.club/vaults/morpho/8453/0xbbb2',
};

const EXPLAIN: ExplainBlock = {
  universe: 521, candidates: 85, matched: 3, returned: 3, truncated: false,
  failed: { belowMinScore: 0, belowMinTvl: 0, belowMinApy: 70, noDepositRoute: 12, noLiveEntry: 0, fallbackData: 1 },
  liveCatalogEntries: 1100,
  notable: [
    { vaultId: 'pendle:1:0xdead', name: 'Pendle PT-X', composite: 82.1, apy: 14, tvl: 9_000_000, reasons: ['noDepositRoute'] },
  ],
  similarAssets: [{ asset: 'syrupUSDC', count: 1 }],
};

interface Env { total?: number; seen?: string[]; applied?: Record<string, unknown> | null; explain?: ExplainBlock | null }

function clientWith(rows: CompactScoreRow[], env: Env = {}) {
  return new AtlasClient({
    fetch: (async (input: RequestInfo | URL) => {
      env.seen?.push(input.toString());
      return new Response(JSON.stringify({
        success: true, scorerVersion: '2.3.0', count: rows.length, total: env.total ?? rows.length,
        // `applied: null` simulates an API that predates the echo (key omitted).
        ...(env.applied === null ? {} : { applied: env.applied ?? { explain: true } }),
        ...(env.explain === null || env.explain === undefined ? {} : { explain: env.explain }),
        data: rows,
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
  it('sends the compact, routable, non-fallback, composite-ranked, explained query by default', async () => {
    const seen: string[] = [];
    await findVaults(clientWith([ROW], { seen }), { asset: 'USDC', chain: 'base' });
    const url = new URL(seen[0]!);
    expect(url.pathname.endsWith('/scores')).toBe(true);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      asset: 'USDC', chainId: '8453', routable: 'true', excludeFallback: 'true', explain: 'true',
      sort: 'composite', limit: '5', fields: 'compact',
    });
  });

  it('forwards the optional filters and clamps limit to 10', async () => {
    const seen: string[] = [];
    await findVaults(clientWith([ROW], { seen, applied: { minApy: 4 } }), {
      protocolId: 'morpho', minScore: 70, minTvlUsd: 1_000_000, minApy: 4, sortBy: 'apy', limit: 50,
    });
    const q = new URL(seen[0]!).searchParams;
    expect(q.get('protocolId')).toBe('morpho');
    expect(q.get('minScore')).toBe('70');
    expect(q.get('minTvl')).toBe('1000000');
    expect(q.get('minApy')).toBe('4');
    expect(q.get('sort')).toBe('apy');
    expect(q.get('limit')).toBe('10');
  });

  it('asset accepts a list and sends it comma-joined', async () => {
    const seen: string[] = [];
    await findVaults(clientWith([ROW], { seen, applied: { asset: ['USDC', 'USDT0'] } }), { asset: ['USDC', 'USDT0'] });
    expect(new URL(seen[0]!).searchParams.get('asset')).toBe('USDC,USDT0');
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

  describe('fail closed on an API that does not confirm a filter', () => {
    it('minApy sent but not echoed in applied: refuses to return unfiltered rows', async () => {
      const res = await findVaults(clientWith([ROW], { applied: null }), { asset: 'USDC', minApy: 10 });
      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toMatch(/minApy/);
      expect(res.content[0]?.text).toMatch(/not (APY-)?filtered|did not confirm/i);
      expect(res.structuredContent).toBeUndefined();
    });

    it('minApy echoed with a different value is also refused', async () => {
      const res = await findVaults(clientWith([ROW], { applied: { minApy: 5 } }), { asset: 'USDC', minApy: 10 });
      expect(res.isError).toBe(true);
    });

    it('a multi-symbol asset list not echoed is refused (an old API would read it as one odd symbol and return nothing)', async () => {
      const res = await findVaults(clientWith([], { applied: null }), { asset: ['USDC', 'USDT0'] });
      expect(res.isError).toBe(true);
      expect(res.content[0]?.text).toMatch(/asset/);
    });

    it('a single symbol still works against an API with no echo', async () => {
      const res = await findVaults(clientWith([ROW], { applied: null }), { asset: 'USDC' });
      expect(res.isError).toBeUndefined();
      expect(res.structuredContent!['funnel']).toBeNull();
      expect(String(res.structuredContent!['funnelNote'])).toMatch(/predates|unavailable/i);
    });
  });

  describe('what was kept and what was dropped', () => {
    const call = (env: Env = {}, args: Parameters<typeof findVaults>[1] = { asset: 'USDC', chain: 'ethereum', minApy: 10 }) =>
      findVaults(clientWith([ROW, ROW, ROW], { total: 3, applied: { minApy: 10, explain: true }, explain: EXPLAIN, ...env }), args);

    it('carries the funnel with only the filters that removed something named, and the live catalog size', async () => {
      const out = (await call()).structuredContent!;
      expect(out['funnel']).toMatchObject({
        universe: 521, candidates: 85, matched: 3, liveCatalogEntries: 1100,
        removedBy: { belowMinApy: 70, noDepositRoute: 12, fallbackData: 1 },
      });
      expect((out['funnel'] as { removedBy: Record<string, number> }).removedBy).not.toHaveProperty('belowMinScore');
    });

    it('states the funnel in one deterministic sentence a model can repeat', async () => {
      const out = (await call()).structuredContent!;
      const s = String(out['summary']);
      expect(s).toMatch(/3 of 85 USDC vaults on Ethereum matched/);
      expect(s).toMatch(/APY of at least 10%/);
      expect(s).toMatch(/70 below the APY floor/);
      expect(s).toMatch(/12 with no deposit route/);
      expect(s).toMatch(/overlap/i);
    });

    it('lists the best dropped vaults with plain-language reasons', async () => {
      const out = (await call()).structuredContent!;
      expect(out['notableExcluded']).toEqual([
        expect.objectContaining({ vaultId: 'pendle:1:0xdead', reasons: ['noDepositRoute'], reasonText: ['no deposit route (route screen)'] }),
      ]);
    });

    it('names near-miss asset symbols the exact match left out', async () => {
      const out = (await call()).structuredContent!;
      expect(out['similarAssets']).toEqual([{ asset: 'syrupUSDC', count: 1 }]);
      expect(String(out['summary'])).toMatch(/syrupUSDC/);
    });

    it('says when results were cut by the row limit', async () => {
      const out = (await call({ total: 12, explain: { ...EXPLAIN, matched: 12, returned: 3, truncated: true } })).structuredContent!;
      expect(out['truncated']).toBe(true);
      expect(String(out['truncationNote'])).toMatch(/9 more matched/);
    });

    it('does not claim truncation when everything that matched is shown', async () => {
      const out = (await call()).structuredContent!;
      expect(out['truncated']).toBe(false);
      expect(out).not.toHaveProperty('truncationNote');
    });

    it('warns when the live catalog looks cold, since routable results are then too short', async () => {
      const cold: ExplainBlock = { ...EXPLAIN, liveCatalogEntries: 128, failed: { ...EXPLAIN.failed, noLiveEntry: 40 } };
      const out = (await call({ explain: cold })).structuredContent!;
      expect(String(out['cacheWarning'])).toMatch(/cold|retry/i);
      const healthy = (await call()).structuredContent!;
      expect(healthy).not.toHaveProperty('cacheWarning');
    });

    it('explain missing but filters honoured: funnel is null with a note, rows still returned', async () => {
      const res = await call({ explain: null });
      expect(res.isError).toBeUndefined();
      expect(res.structuredContent!['funnel']).toBeNull();
      expect(res.structuredContent!['notableExcluded']).toEqual([]);
      expect(res.structuredContent!['vaults']).toHaveLength(3);
    });
  });

  describe('how the answer is presented', () => {
    it('ships presentation rules: show flags by APY, show what was dropped, never call an APY sustainable', async () => {
      const out = (await findVaults(clientWith([ROW], { explain: EXPLAIN }), { asset: 'USDC' })).structuredContent!;
      const rules = (out['presentation'] as string[]).join(' ');
      expect(rules).toMatch(/flags/i);
      expect(rules).toMatch(/excluded|dropped/i);
      expect(rules).toMatch(/sustainable/i);
      expect(rules).toMatch(/not (a )?verdict|no flag/i);
    });

    it('defines every flag it can emit, so a model never has to guess one', async () => {
      const out = (await findVaults(clientWith([ROW], { explain: EXPLAIN }), { asset: 'USDC' })).structuredContent!;
      expect(Object.keys(out['flagLegend'] as object).sort()).toEqual(
        ['apy_outlier', 'fallback_data', 'no_yield', 'partial_data', 'stale_score', 'thin_tvl'],
      );
      expect((out['flagLegend'] as Record<string, string>)['no_yield']).toBe(
        '7-day median APY is 0.1% or less, so this is not a yield product (usually a collateral reserve). The score rates holding it safely; no Atlas portfolio includes it.',
      );
    });

    it('links the same query on the shareable page', async () => {
      const out = (await findVaults(
        clientWith([ROW], { explain: EXPLAIN, applied: { minApy: 10, asset: ['USDC', 'USDT0'] } }),
        { asset: ['USDC', 'USDT0'], chain: 'ethereum', minApy: 10, sortBy: 'apy' },
      )).structuredContent!;
      const url = new URL(String(out['viewUrl']));
      expect(url.origin + url.pathname).toBe('https://atlasyield.club/find');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        asset: 'USDC,USDT0', chain: '1', minApy: '10', sort: 'apy', limit: '5',
      });
    });
  });
});
