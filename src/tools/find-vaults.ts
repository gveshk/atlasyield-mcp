import { z } from 'zod';
import type { AtlasClient } from '../atlas-client.js';
import { ok, fail, failFrom, type ToolResult } from '../result.js';

/** Names an agent or a user will actually say. The API itself stays numeric. */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1, eth: 1, mainnet: 1,
  base: 8453,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  bnb: 56, bsc: 56,
  solana: 792703809, sol: 792703809,
};

const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;

export function resolveChain(chain: number | string): number | undefined {
  if (typeof chain === 'number') return chain;
  const trimmed = chain.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return CHAIN_IDS[trimmed];
}

export const findVaultsInput = {
  asset: z.string().min(1).optional().describe('Underlying asset symbol, e.g. USDC, WETH, USDT'),
  chain: z.union([z.string(), z.number().int().positive()]).optional()
    .describe('Chain name (base, ethereum, arbitrum, optimism, bnb, solana) or EVM chain id'),
  protocolId: z.string().min(1).optional().describe('Protocol slug, e.g. morpho, aave-v3, pendle'),
  minScore: z.number().min(0).max(100).optional().describe('Minimum Atlas composite (0-100)'),
  minTvlUsd: z.number().min(0).optional().describe('Minimum live TVL in USD'),
  sortBy: z.enum(['composite', 'apy', 'tvl']).optional().describe('Rank by this, descending. Default composite'),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Rows to return, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}`),
};

export const findVaultsDescription =
  'Start here when you do not already have a vault address. Answers "which vaults for this asset on this chain?": ' +
  'returns a short ranked list (default 5, max 10) of scored vaults with composite, label, live APY/TVL, ' +
  'whether a deposit can reach it (routable), and a citable page URL. Vaults with no deposit route and rows ' +
  'scored on fallback data are excluded. Ranked by Atlas composite, a ranking and not a recommendation. ' +
  'Take a chosen vaultId/address to check_route_survival before any deposit. Read-only.';

export async function findVaults(
  client: AtlasClient,
  args: {
    asset?: string | undefined; chain?: number | string | undefined; protocolId?: string | undefined;
    minScore?: number | undefined; minTvlUsd?: number | undefined;
    sortBy?: 'composite' | 'apy' | 'tvl' | undefined; limit?: number | undefined;
  },
): Promise<ToolResult> {
  let chainId: number | undefined;
  if (args.chain !== undefined) {
    chainId = resolveChain(args.chain);
    if (chainId === undefined) {
      return fail(
        `atlasyield-mcp: unknown chain "${String(args.chain)}". Use one of: ` +
        `${Object.keys(CHAIN_IDS).join(', ')}, or a numeric chain id.`,
      );
    }
  }
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const sortBy = args.sortBy ?? 'composite';
  try {
    const res = await client.findVaults({
      ...(chainId !== undefined ? { chainId } : {}),
      ...(args.protocolId !== undefined ? { protocolId: args.protocolId } : {}),
      ...(args.asset !== undefined ? { asset: args.asset } : {}),
      ...(args.minScore !== undefined ? { minScore: args.minScore } : {}),
      ...(args.minTvlUsd !== undefined ? { minTvl: args.minTvlUsd } : {}),
      routable: true,
      excludeFallback: true,
      sort: sortBy,
      limit,
    });
    return ok({
      criteria: {
        ...(args.asset !== undefined ? { asset: args.asset } : {}),
        ...(chainId !== undefined ? { chainId } : {}),
        ...(args.protocolId !== undefined ? { protocolId: args.protocolId } : {}),
        ...(args.minScore !== undefined ? { minScore: args.minScore } : {}),
        ...(args.minTvlUsd !== undefined ? { minTvlUsd: args.minTvlUsd } : {}),
        routableOnly: true,
        excludesFallbackData: true,
      },
      matched: res.total ?? res.count,
      returned: res.count,
      rankedBy: `${sortBy}, descending. A ranking by the Atlas score, not a recommendation`,
      vaults: res.data,
      scorerVersion: res.scorerVersion,
      next: 'Call check_route_survival for a chosen vault before any deposit; blocking:true means refuse.',
      ...(res.count === 0
        ? { note: 'No routable vaults matched. Loosen the filters, or retry later: an unavailable live catalog also empties this list.' }
        : {}),
    });
  } catch (err) {
    return failFrom(err);
  }
}
