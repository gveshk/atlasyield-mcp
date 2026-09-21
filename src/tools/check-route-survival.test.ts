import { describe, it, expect } from 'vitest';
import { AtlasClient, type RouteData } from '../atlas-client.js';
import { checkRouteSurvival } from './check-route-survival.js';

function clientWith(data: RouteData) {
  return new AtlasClient({
    fetch: (async () => new Response(JSON.stringify({ success: true, data }), { status: 200 })) as typeof fetch,
  });
}

const BASE: RouteData = {
  vaultId: 'pendle:1:0xabc', chainId: 1, screened: true, verdict: 'OK',
  usdIn: 10, usdOut: 9.8, retained: 0.98, path: 'usdc->pendle->usdc', checkedAt: '2026-09-15T00:00:00.000Z',
};

describe('check_route_survival', () => {
  it('NO_ROUTE is a refusal: safeToEnter false, blocking true, reason names the verdict', async () => {
    const res = await checkRouteSurvival(clientWith({ ...BASE, verdict: 'NO_ROUTE', usdOut: null, retained: null }), { chainId: 1, address: '0xabc' });
    const s = res.structuredContent!;
    expect(res.isError).toBeUndefined();
    expect(s['screened']).toBe(true);
    expect(s['verdict']).toBe('NO_ROUTE');
    expect(s['blocking']).toBe(true);
    expect(s['safeToEnter']).toBe(false);
    expect(String(s['answer'])).toMatch(/NO_ROUTE/);
    expect(String(s['answer'])).toMatch(/do not deposit/i);
  });

  it('tells the agent WHY: protocol_refused reads as dead, no_aggregator_quote as no priced route, both same-chain', async () => {
    const dead = await checkRouteSurvival(clientWith({ ...BASE, verdict: 'NO_ROUTE', usdOut: null, retained: null, reasonClass: 'protocol_refused' }), { chainId: 1, address: '0xabc' });
    expect(dead.structuredContent?.['reasonClass']).toBe('protocol_refused');
    expect(String(dead.structuredContent?.['answer'])).toMatch(/own router refuses/i);
    expect(String(dead.structuredContent?.['answer'])).toMatch(/same-chain/i);

    const lp = await checkRouteSurvival(clientWith({ ...BASE, verdict: 'NO_ROUTE', usdOut: null, retained: null, reasonClass: 'no_aggregator_quote' }), { chainId: 1, address: '0xabc' });
    expect(lp.structuredContent?.['blocking']).toBe(true);
    expect(String(lp.structuredContent?.['answer'])).toMatch(/no same-chain aggregator/i);
    expect(lp.structuredContent?.['probeScope']).toBe('same-chain');
  });

  it('DANGEROUS and UNPRICEABLE are also blocking', async () => {
    for (const verdict of ['DANGEROUS', 'UNPRICEABLE'] as const) {
      const res = await checkRouteSurvival(clientWith({ ...BASE, verdict }), { chainId: 1, address: '0xabc' });
      expect(res.structuredContent?.['blocking']).toBe(true);
      expect(res.structuredContent?.['safeToEnter']).toBe(false);
    }
  });

  it('OK passes with the retained fraction in the answer', async () => {
    const res = await checkRouteSurvival(clientWith(BASE), { chainId: 1, address: '0xabc' });
    expect(res.structuredContent?.['blocking']).toBe(false);
    expect(res.structuredContent?.['safeToEnter']).toBe(true);
    expect(String(res.structuredContent?.['answer'])).toMatch(/98/);
  });

  it('DEGRADED is not blocking but safeToEnter is false (warn, do not refuse)', async () => {
    const res = await checkRouteSurvival(clientWith({ ...BASE, verdict: 'DEGRADED', retained: 0.9 }), { chainId: 1, address: '0xabc' });
    expect(res.structuredContent?.['blocking']).toBe(false);
    expect(res.structuredContent?.['safeToEnter']).toBe(false);
  });

  it('SKIPPED (our own rate limit) is unjudged: safeToEnter null', async () => {
    const res = await checkRouteSurvival(clientWith({ ...BASE, verdict: 'SKIPPED' }), { chainId: 1, address: '0xabc' });
    expect(res.structuredContent?.['safeToEnter']).toBeNull();
    expect(res.structuredContent?.['blocking']).toBe(false);
  });

  it('never screened is honest: screened false, verdict null, safeToEnter null', async () => {
    const res = await checkRouteSurvival(
      clientWith({ chainId: 8453, address: '0xnew', screened: false, verdict: null, usdIn: null, usdOut: null, retained: null, path: null, checkedAt: null }),
      { chainId: 8453, address: '0xnew' },
    );
    expect(res.structuredContent?.['screened']).toBe(false);
    expect(res.structuredContent?.['verdict']).toBeNull();
    expect(res.structuredContent?.['safeToEnter']).toBeNull();
    expect(String(res.structuredContent?.['answer'])).toMatch(/not been screened/i);
  });

  it('upstream outage is isError, never a fabricated verdict', async () => {
    const client = new AtlasClient({
      fetch: (async () => new Response(JSON.stringify({ success: false, error: 'exceed_egress_quota' }), { status: 500 })) as typeof fetch,
    });
    const res = await checkRouteSurvival(client, { chainId: 8453, address: '0x1' });
    expect(res.isError).toBe(true);
    expect(res.structuredContent).toBeUndefined();
    expect(res.content[0]?.text).toContain('exceed_egress_quota');
  });
});
