import { z } from 'zod';
import { AtlasApiError, type AtlasClient } from '../atlas-client.js';
import { ok, failFrom, type ToolResult } from '../result.js';

export const explainVaultScoreInput = {
  chainId: z.number().int().positive().describe('EVM chain id, e.g. 1 (Ethereum), 8453 (Base), 42161 (Arbitrum)'),
  address: z.string().min(3).describe('Vault contract address (0x…); case-insensitive'),
};

export const explainVaultScoreDescription =
  'Why a vault has its Atlas Score: all 16 factors (15 additive across four pillars + the ' +
  'multiplicative exploit-history modifier), each with sub-score (0-100), weight, raw input ' +
  'and a plain-English label, grouped by pillar, plus the three weakest factors. Exactly what ' +
  'the engine computed at scoredAt, not a recomputation. Returns found:false when unscored. Read-only.';

export async function explainVaultScore(
  client: AtlasClient,
  args: { chainId: number; address: string },
): Promise<ToolResult> {
  try {
    const res = await client.getFactors(args.chainId, args.address);
    const d = res.data;
    const byPillar: Record<string, Record<string, unknown>> = {
      yield: {}, safety: {}, liquidity: {}, sustainability: {},
    };
    for (const [key, f] of Object.entries(d.factors)) {
      (byPillar[f.pillar] ??= {})[key] = f;
    }
    // Additive factors only: EXPLOIT_HISTORY carries weight 0 and reads as multiplier × 100.
    const weakestFactors = Object.entries(d.factors)
      .filter(([, f]) => f.weight > 0)
      .sort((a, b) => a[1].score - b[1].score)
      .slice(0, 3)
      .map(([factor, f]) => ({ factor, pillar: f.pillar, score: f.score, label: f.label }));
    return ok({
      found: true,
      vaultId: d.vaultId,
      chainId: d.chainId,
      protocolId: d.protocolId,
      composite: d.composite,
      label: d.label,
      pillarScores: d.pillarScores,
      factorsByPillar: byPillar,
      weakestFactors,
      dataQuality: d.dataQuality,
      scoredAt: d.scoredAt,
      scorerVersion: d.scorerVersion,
    });
  } catch (err) {
    if (err instanceof AtlasApiError && err.status === 404) {
      return ok({ found: false, chainId: args.chainId, address: args.address.toLowerCase(), factorsByPillar: null });
    }
    return failFrom(err);
  }
}
