import { z } from 'zod';
import type { AtlasClient, RouteData } from '../atlas-client.js';
import { ok, failFrom, type ToolResult } from '../result.js';

export const checkRouteSurvivalInput = {
  chainId: z.number().int().positive().describe('EVM chain id of the vault'),
  address: z.string().min(3).describe('Vault contract address (0x…)'),
};

export const checkRouteSurvivalDescription =
  'Can a deposit into this vault be exited at size, measured today? Returns the daily ' +
  'round-trip route screen (USDC -> position -> USDC): verdict, USD in/out, fraction retained, ' +
  'the path probed, and when. blocking:true means refuse the deposit (NO_ROUTE, DANGEROUS, ' +
  "UNPRICEABLE). reasonClass says why: protocol_refused (the protocol's own router refuses, " +
  'the vault is dead) vs no_aggregator_quote (no same-chain swap into the underlying, common ' +
  'for LP vaults; redeeming by hand may still work). The probe is SAME-CHAIN only: USDC on the ' +
  "vault's own chain. It says nothing about bridging in from elsewhere. A vault that was never " +
  'screened returns screened:false with no verdict — never a fabricated one. Call this BEFORE ' +
  'moving money. Read-only.';

function judge(d: RouteData): { blocking: boolean; safeToEnter: boolean | null; answer: string } {
  const where = `${d.vaultId ?? d.address ?? 'vault'} on chain ${d.chainId}`;
  if (!d.screened || d.verdict === null) {
    return {
      blocking: false, safeToEnter: null,
      answer: `${where} has not been screened yet, so there is no exit-liquidity verdict. Treat as unjudged, not as safe.`,
    };
  }
  const pct = d.retained !== null ? `${(d.retained * 100).toFixed(1)}%` : 'an unknown fraction';
  switch (d.verdict) {
    case 'OK':
      return { blocking: false, safeToEnter: true,
        answer: `${where}: OK. A round trip on ${d.checkedAt} returned ${pct} of the USD put in via ${d.path ?? 'the protocol path'}.` };
    case 'DEGRADED':
      return { blocking: false, safeToEnter: false,
        answer: `${where}: DEGRADED. Exit works but only ${pct} came back on ${d.checkedAt}. Warn before depositing; size down.` };
    case 'SKIPPED':
      return { blocking: false, safeToEnter: null,
        answer: `${where}: SKIPPED. Our screen could not run on ${d.checkedAt} (rate limit on our side). Unjudged, not cleared.` };
    default: {
      // DANGEROUS | UNPRICEABLE | NO_ROUTE — mirrors BLOCKING_VERDICTS in apps/api/src/lib/route-screen.ts
      const why =
        d.reasonClass === 'protocol_refused'    ? "The protocol's own router refuses to quote the position, so there is no entry or exit at all." :
        d.reasonClass === 'no_aggregator_quote' ? 'No same-chain aggregator quotes USDC into the underlying (typical for an LP-token vault); a manual redeem-and-unwind may still exist, but there is no priced route.' :
        d.reasonClass === 'dust'                ? `Value came back, but only ${pct}: a deposit here can look successful and still be a loss.` :
                                                  `The round-trip screen could not get value back out (${pct} retained).`;
      return { blocking: true, safeToEnter: false,
        answer: `${where}: ${d.verdict}. Do not deposit. Same-chain round trip on ${d.checkedAt}: ${why}` };
    }
  }
}

export async function checkRouteSurvival(
  client: AtlasClient,
  args: { chainId: number; address: string },
): Promise<ToolResult> {
  try {
    const res = await client.getRoute(args.chainId, args.address);
    const d = res.data;
    const { blocking, safeToEnter, answer } = judge(d);
    return ok({
      chainId: d.chainId,
      address: args.address.toLowerCase(),
      vaultId: d.vaultId ?? null,
      screened: d.screened,
      verdict: d.verdict,
      blocking,
      safeToEnter,
      usdIn: d.usdIn,
      usdOut: d.usdOut,
      retained: d.retained,
      path: d.path,
      reasonClass: d.reasonClass ?? null,
      probeScope: d.probe?.scope ?? 'same-chain',
      checkedAt: d.checkedAt,
      answer,
    });
  } catch (err) {
    return failFrom(err);
  }
}
