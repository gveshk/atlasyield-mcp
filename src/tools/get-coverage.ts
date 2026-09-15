import { z } from 'zod';
import type { AtlasClient } from '../atlas-client.js';
import { ok, failFrom, type ToolResult } from '../result.js';

export const getCoverageInput = {
  chainId: z.number().int().positive().optional().describe('Restrict to one chain id'),
  protocolId: z.string().optional().describe('Restrict to one protocol id, e.g. morpho, aave-v3, pendle, beefy, yearn-v3, euler'),
};

export const getCoverageDescription =
  'What the Atlas Score Index covers right now: number of scored vaults, total TVL, composite ' +
  'score spread, and counts by protocol and chain. Use it before asking about a vault to learn ' +
  'whether a protocol or chain is in the scored universe at all. Read-only.';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export async function getCoverage(
  client: AtlasClient,
  args: { chainId?: number; protocolId?: string },
): Promise<ToolResult> {
  try {
    const filter: { chainId?: number; protocolId?: string } = {};
    if (args.chainId !== undefined) filter.chainId = args.chainId;
    if (args.protocolId !== undefined) filter.protocolId = args.protocolId;
    const res = await client.getScores(filter);

    const byProtocol: Record<string, number> = {};
    const byChain: Record<string, number> = {};
    let tvl = 0;
    const composites: number[] = [];
    for (const r of res.data) {
      byProtocol[r.protocolId] = (byProtocol[r.protocolId] ?? 0) + 1;
      byChain[String(r.chainId)] = (byChain[String(r.chainId)] ?? 0) + 1;
      tvl += r.tvl ?? 0;
      composites.push(r.composite);
    }

    return ok({
      filter,
      vaultCount: res.data.length,
      tvlUsd: tvl,
      composite: composites.length
        ? { min: Math.min(...composites), median: median(composites), max: Math.max(...composites) }
        : null,
      byProtocol,
      byChain,
      scorerVersion: res.scorerVersion,
      cadence: 'scored every 4 hours; the citable daily snapshot is at ' +
        'https://raw.githubusercontent.com/gveshk/atlasyield-score-history/main/latest.json',
    });
  } catch (err) {
    return failFrom(err);
  }
}
