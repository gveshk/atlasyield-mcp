import { z } from 'zod';
import type { AtlasClient } from '../atlas-client.js';
import { ok, failFrom, addressOf, type ToolResult } from '../result.js';

export const getVaultScoreInput = {
  chainId: z.number().int().positive().describe('EVM chain id, e.g. 1 (Ethereum), 8453 (Base), 42161 (Arbitrum)'),
  address: z.string().min(3).describe('Vault contract address (0x…); case-insensitive'),
};

export const getVaultScoreDescription =
  'Latest Atlas Score for one vault: composite (0-100), label, the four pillar scores ' +
  '(yield, safety, liquidity, sustainability), live APY/TVL, data quality and the scoring ' +
  'timestamp. Returns found:false when the vault is not in the scored universe. Read-only.';

export async function getVaultScore(
  client: AtlasClient,
  args: { chainId: number; address: string },
): Promise<ToolResult> {
  try {
    const res = await client.getScores({ chainId: args.chainId });
    const want = args.address.toLowerCase();
    const vault = res.data.find((r) => addressOf(r.vaultId) === want) ?? null;
    return ok({
      found: vault !== null,
      chainId: args.chainId,
      address: want,
      vault,
      scorerVersion: res.scorerVersion,
    });
  } catch (err) {
    return failFrom(err);
  }
}
