import { describe, it, expect } from 'vitest';
import { AtlasClient, AtlasApiError } from './atlas-client.js';

type FetchLike = typeof fetch;

function fakeFetch(handler: (url: string) => { status: number; body: unknown }): FetchLike {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const { status, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as FetchLike;
}

describe('AtlasClient', () => {
  it('getScores builds the /scores URL with only the filters given', async () => {
    const seen: string[] = [];
    const client = new AtlasClient({
      fetch: fakeFetch((url) => {
        seen.push(url);
        return { status: 200, body: { success: true, scorerVersion: '2.1.0', count: 0, data: [] } };
      }),
    });
    await client.getScores({ chainId: 8453 });
    await client.getScores({});
    expect(seen).toEqual([
      'https://api.atlasyield.club/v1/scores?chainId=8453',
      'https://api.atlasyield.club/v1/scores',
    ]);
  });

  it('sends x-api-key only when an apiKey is configured', async () => {
    const seenHeaders: Array<Record<string, string>> = [];
    const spy = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seenHeaders.push({ ...(init?.headers as Record<string, string>) });
      return new Response(JSON.stringify({ success: true, scorerVersion: '2.3.0', count: 0, data: [] }), { status: 200 });
    }) as FetchLike;
    await new AtlasClient({ fetch: spy, apiKey: 'k-123' }).getScores({});
    await new AtlasClient({ fetch: spy }).getScores({});
    expect(seenHeaders[0]!['x-api-key']).toBe('k-123');
    expect(seenHeaders[1]!['x-api-key']).toBeUndefined();
    expect(seenHeaders[0]!['user-agent']).toBe('atlasyield-mcp');
  });

  it('getRoute hits /vaults/:chainId/:address/route with the address lowercased', async () => {
    const seen: string[] = [];
    const client = new AtlasClient({
      fetch: fakeFetch((url) => {
        seen.push(url);
        return { status: 200, body: { success: true, data: { screened: false } } };
      }),
    });
    await client.getRoute(1, '0xABCDEF0000000000000000000000000000000001');
    expect(seen[0]).toBe(
      'https://api.atlasyield.club/v1/vaults/1/0xabcdef0000000000000000000000000000000001/route',
    );
  });

  it('getAlerts reads alerts-latest.json from the snapshot repo', async () => {
    const seen: string[] = [];
    const client = new AtlasClient({
      fetch: fakeFetch((url) => {
        seen.push(url);
        return { status: 200, body: { date: '2026-09-12', events: [] } };
      }),
    });
    const out = await client.getAlerts();
    expect(seen[0]).toBe(
      'https://raw.githubusercontent.com/gveshk/atlasyield-score-history/main/alerts-latest.json',
    );
    expect(out.events).toEqual([]);
  });

  it('throws AtlasApiError carrying the upstream error string on success:false', async () => {
    const client = new AtlasClient({
      fetch: fakeFetch(() => ({
        status: 500,
        body: { success: false, error: 'getRouteScreenByAddress failed: exceed_egress_quota' },
      })),
    });
    await expect(client.getRoute(8453, '0x1')).rejects.toBeInstanceOf(AtlasApiError);
    await expect(client.getRoute(8453, '0x1')).rejects.toThrow(/exceed_egress_quota/);
  });

  it('surfaces Retry-After on a 429 so an agent knows how long to back off', async () => {
    const client = new AtlasClient({
      fetch: (async () =>
        new Response(JSON.stringify({ success: false, error: 'Too many requests' }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '7' },
        })) as FetchLike,
    });
    const err = await client.getScores({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AtlasApiError);
    expect((err as AtlasApiError).retryAfterSeconds).toBe(7);
    expect((err as AtlasApiError).message).toMatch(/retry after 7s/);
  });

  it('throws AtlasApiError with the HTTP status when the body is not JSON', async () => {
    const client = new AtlasClient({
      fetch: (async () => new Response('<html>502</html>', { status: 502 })) as FetchLike,
    });
    await expect(client.getScores({})).rejects.toThrow(/HTTP 502/);
  });

  it('honours custom base URLs', async () => {
    const seen: string[] = [];
    const client = new AtlasClient({
      apiBase: 'http://localhost:4000/v1',
      snapshotBase: 'http://localhost:9999',
      fetch: fakeFetch((url) => {
        seen.push(url);
        return { status: 200, body: { success: true, data: [], events: [] } };
      }),
    });
    await client.getScores({});
    await client.getAlerts();
    expect(seen).toEqual(['http://localhost:4000/v1/scores', 'http://localhost:9999/alerts-latest.json']);
  });
});
