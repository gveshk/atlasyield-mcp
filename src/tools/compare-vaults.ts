import { z } from 'zod';
import type { AtlasClient, ScoreRow } from '../atlas-client.js';
import { ok, failFrom, addressOf, type ToolResult } from '../result.js';

const VaultRef = z.object({
  chainId: z.number().int().positive().describe('EVM chain id'),
  address: z.string().min(3).describe('Vault contract address (0x…); case-insensitive'),
});

export const compareVaultsInput = {
  vaults: z.array(VaultRef).min(2).max(8).describe('2-8 vaults to compare, any mix of chains'),
};

export const compareVaultsDescription =
  'Side-by-side Atlas Scores for 2-8 vaults: composite, label, four pillars, live APY/TVL, ' +
  'data quality, yieldQuality and exitSafety, with a ranking by composite. Unscored vaults ' +
  'come back found:false rather than silently dropped. Read-only.';

export async function compareVaults(
  client: AtlasClient,
  args: { vaults: Array<{ chainId: number; address: string }> },
): Promise<ToolResult> {
  try {
    // One /scores read per distinct chain, not one per vault.
    const rowsByChain = new Map<number, ScoreRow[]>();
    let scorerVersion: string | null = null;
    for (const chainId of new Set(args.vaults.map((v) => v.chainId))) {
      const res = await client.getScores({ chainId });
      rowsByChain.set(chainId, res.data);
      scorerVersion ??= res.scorerVersion;
    }

    const vaults = args.vaults.map(({ chainId, address }) => {
      const want = address.toLowerCase();
      const vault = rowsByChain.get(chainId)?.find((r) => addressOf(r.vaultId) === want) ?? null;
      return { found: vault !== null, chainId, address: want, vault };
    });

    const ranking = vaults
      .flatMap((v) => (v.vault ? [v.vault] : []))
      .sort((a, b) => b.composite - a.composite)
      .map((r, i) => ({ rank: i + 1, vaultId: r.vaultId, name: r.name, composite: r.composite }));

    return ok({ vaults, ranking, scorerVersion });
  } catch (err) {
    return failFrom(err);
  }
}
