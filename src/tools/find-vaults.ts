import { z } from 'zod';
import type { AtlasClient, CompactScoresResponse, FindReason } from '../atlas-client.ts';
import { ok, fail, failFrom, type ToolResult } from '../result.ts';

/** Names an agent or a user will actually say. The API itself stays numeric. */
const CHAIN_IDS: Record<string, number> = {
  ethereum: 1, eth: 1, mainnet: 1,
  base: 8453,
  arbitrum: 42161, arb: 42161,
  optimism: 10, op: 10,
  bnb: 56, bsc: 56,
  solana: 792703809, sol: 792703809,
};

const CHAIN_LABELS: Record<number, string> = {
  1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum', 10: 'Optimism', 56: 'BNB', 792703809: 'Solana',
};

const SITE_URL = 'https://atlasyield.club';
const MAX_LIMIT = 10;
const DEFAULT_LIMIT = 5;

export function resolveChain(chain: number | string): number | undefined {
  if (typeof chain === 'number') return chain;
  const trimmed = chain.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return CHAIN_IDS[trimmed];
}

export const findVaultsInput = {
  asset: z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(10)]).optional()
    .describe('Underlying asset symbol, or a list of up to 10, e.g. USDC or ["USDC","USDT0"]. Exact match: USDC does not include syrupUSDC (similarAssets lists near misses)'),
  chain: z.union([z.string(), z.number().int().positive()]).optional()
    .describe('Chain name (base, ethereum, arbitrum, optimism, bnb, solana) or EVM chain id'),
  protocolId: z.string().min(1).optional().describe('Protocol slug, e.g. morpho, aave-v3, pendle'),
  minScore: z.number().min(0).max(100).optional().describe('Minimum Atlas composite (0-100)'),
  minTvlUsd: z.number().min(0).optional().describe('Minimum live TVL in USD'),
  minApy: z.number().min(0).optional().describe('Minimum live APY in percentage points, e.g. 10 for 10%'),
  sortBy: z.enum(['composite', 'apy', 'tvl']).optional().describe('Rank by this, descending. Default composite'),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`Rows to return, default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}`),
};

export const findVaultsDescription =
  'Start here when you do not already have a vault address. Answers "which vaults for this asset on this chain?": ' +
  'returns a short ranked list (default 5, max 10) of scored vaults with composite, label, live APY/TVL, ' +
  'risk flags (thin_tvl, apy_outlier, no_yield, ...), whether a deposit can reach it (routable), and a citable page URL. ' +
  'It also returns what the filters REMOVED: counts per filter, the best-ranked dropped vaults with reasons, ' +
  'near-miss asset symbols, and whether more matched than were returned. Vaults with no deposit route and rows ' +
  'scored on fallback data are excluded. Ranked by the chosen metric, a ranking and not a recommendation. A flag is a ' +
  'caution, not a verdict, and no flag does not mean safe. Take a chosen vaultId/address to check_route_survival ' +
  'before any deposit. Read-only.';

const FLAG_LEGEND: Record<string, string> = {
  thin_tvl: 'Live TVL under $2M (or unknown): APY moves a lot when deposits arrive or leave.',
  apy_outlier: 'APY is at least 10% and at least 3x the median of its chain and asset peers: often a small-vault spike.',
  fallback_data: 'Scored on fallback data: lower confidence in the score.',
  partial_data: 'Some score inputs were missing: lower confidence in the score.',
  stale_score: 'Scored more than 8 hours ago (scoring runs every 4 hours).',
  no_yield: '7-day median APY is 0.1% or less, so this is not a yield product (usually a collateral reserve). The score rates holding it safely; no Atlas portfolio includes it.',
};

const PRESENTATION = [
  'Tell the user how many vaults matched out of how many candidates, and what the filters removed (see summary).',
  'Show each vault\'s flags beside its APY. A flag is a caution, not a verdict; no flag does not mean safe.',
  'If notableExcluded is not empty, say which vaults were dropped and why. Name any dropped for no deposit route or low-confidence data, even if their APY is low: those are the ones a reader most needs to know about.',
  'If truncated is true, say that more vaults matched than are shown.',
  'Do not call any APY sustainable or expected: it is a live reading and moves with deposit size.',
  'The order is a ranking by the Atlas score or the chosen metric, not a recommendation. Run check_route_survival before any deposit.',
];

const REASON_TEXT: Record<FindReason, string> = {
  belowMinScore: 'below the minimum score',
  belowMinTvl: 'below the minimum TVL',
  belowMinApy: 'below the minimum APY',
  noDepositRoute: 'no deposit route (route screen)',
  noLiveEntry: 'not in the live catalog (unverified, treated as unroutable)',
  fallbackData: 'scored on fallback data',
};

const REMOVED_PHRASE: Record<FindReason, string> = {
  belowMinScore: 'below the score floor',
  belowMinTvl: 'below the TVL floor',
  belowMinApy: 'below the APY floor',
  noDepositRoute: 'with no deposit route',
  noLiveEntry: 'missing from the live catalog',
  fallbackData: 'on fallback data',
};

const REASON_ORDER: FindReason[] = ['belowMinScore', 'belowMinTvl', 'belowMinApy', 'noDepositRoute', 'noLiveEntry', 'fallbackData'];

interface FindArgs {
  asset?: string | string[] | undefined; chain?: number | string | undefined; protocolId?: string | undefined;
  minScore?: number | undefined; minTvlUsd?: number | undefined; minApy?: number | undefined;
  sortBy?: 'composite' | 'apy' | 'tvl' | undefined; limit?: number | undefined;
}

const usd = (n: number): string => (n >= 1_000_000 ? `$${n / 1_000_000}M` : n >= 1_000 ? `$${n / 1_000}K` : `$${n}`);

function criteriaPhrase(args: FindArgs): string {
  const parts: string[] = [];
  if (args.minApy !== undefined) parts.push(`APY of at least ${args.minApy}%`);
  if (args.minScore !== undefined) parts.push(`score of at least ${args.minScore}`);
  if (args.minTvlUsd !== undefined) parts.push(`TVL of at least ${usd(args.minTvlUsd)}`);
  parts.push('a deposit route', 'not on fallback data');
  return parts.join(', ');
}

function buildSummary(args: FindArgs, assets: string[] | undefined, chainId: number | undefined, res: CompactScoresResponse): string | null {
  const ex = res.explain;
  if (ex === undefined) return null;
  const what = assets !== undefined ? assets.join(' / ') : 'scored';
  const where = chainId !== undefined ? ` on ${CHAIN_LABELS[chainId] ?? `chain ${chainId}`}` : '';
  const proto = args.protocolId !== undefined ? ` in ${args.protocolId}` : '';
  let s = `${ex.matched} of ${ex.candidates} ${what} vaults${where}${proto} matched (${criteriaPhrase(args)}); showing ${res.count}.`;
  const removed = REASON_ORDER.filter((r) => ex.failed[r] > 0).map((r) => `${ex.failed[r]} ${REMOVED_PHRASE[r]}`);
  if (removed.length > 0) s += ` Removed by the filters (counts are per filter and overlap): ${removed.join(', ')}.`;
  if (ex.similarAssets.length > 0) {
    s += ` Near-miss symbols the exact asset match did not include: ${ex.similarAssets.map((a) => `${a.asset} (${a.count})`).join(', ')}.`;
  }
  return s;
}

/** Filters the API did not echo back cannot be trusted as applied: fail closed instead of returning unfiltered rows. */
function unconfirmedFilter(args: FindArgs, assets: string[] | undefined, applied: CompactScoresResponse['applied']): string | null {
  if (args.minApy !== undefined && applied?.minApy !== args.minApy) return 'minApy';
  if (assets !== undefined && assets.length > 1) {
    const got = applied?.asset;
    if (!Array.isArray(got) || got.length !== assets.length) return 'asset list';
  }
  return null;
}

export async function findVaults(client: AtlasClient, args: FindArgs): Promise<ToolResult> {
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
  const assets = args.asset === undefined ? undefined : (Array.isArray(args.asset) ? args.asset : [args.asset]);
  const limit = Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const sortBy = args.sortBy ?? 'composite';
  try {
    const res = await client.findVaults({
      ...(chainId !== undefined ? { chainId } : {}),
      ...(args.protocolId !== undefined ? { protocolId: args.protocolId } : {}),
      ...(assets !== undefined ? { asset: assets.join(',') } : {}),
      ...(args.minScore !== undefined ? { minScore: args.minScore } : {}),
      ...(args.minTvlUsd !== undefined ? { minTvl: args.minTvlUsd } : {}),
      ...(args.minApy !== undefined ? { minApy: args.minApy } : {}),
      routable: true,
      excludeFallback: true,
      explain: true,
      sort: sortBy,
      limit,
    });

    const unconfirmed = unconfirmedFilter(args, assets, res.applied);
    if (unconfirmed !== null) {
      return fail(
        `atlasyield-mcp: the API did not confirm the ${unconfirmed} filter (it may predate it), so these rows would not be ` +
        'filtered by it. Nothing was returned. Retry later, or ask without that filter.',
      );
    }

    const matched = res.total ?? res.count;
    const truncated = matched > res.count;
    const ex = res.explain;
    const removedBy = ex === undefined ? undefined : Object.fromEntries(
      REASON_ORDER.filter((r) => ex.failed[r] > 0).map((r) => [r, ex.failed[r]]),
    );
    const coldWarning = ex !== undefined && ex.liveCatalogEntries < ex.universe * 0.5
      ? `The live catalog has only ${ex.liveCatalogEntries} entries for ${ex.universe} scored vaults, so it looks cold: ` +
        'routable results may be too short. Retry in a minute.'
      : undefined;

    const view = new URLSearchParams();
    if (assets !== undefined) view.set('asset', assets.join(','));
    if (chainId !== undefined) view.set('chain', String(chainId));
    if (args.protocolId !== undefined) view.set('protocol', args.protocolId);
    if (args.minScore !== undefined) view.set('minScore', String(args.minScore));
    if (args.minTvlUsd !== undefined) view.set('minTvl', String(args.minTvlUsd));
    if (args.minApy !== undefined) view.set('minApy', String(args.minApy));
    view.set('sort', sortBy);
    view.set('limit', String(limit));

    return ok({
      criteria: {
        ...(assets !== undefined ? { asset: assets } : {}),
        ...(chainId !== undefined ? { chainId } : {}),
        ...(args.protocolId !== undefined ? { protocolId: args.protocolId } : {}),
        ...(args.minScore !== undefined ? { minScore: args.minScore } : {}),
        ...(args.minTvlUsd !== undefined ? { minTvlUsd: args.minTvlUsd } : {}),
        ...(args.minApy !== undefined ? { minApy: args.minApy } : {}),
        routableOnly: true,
        excludesFallbackData: true,
      },
      summary: buildSummary(args, assets, chainId, res),
      matched,
      returned: res.count,
      truncated,
      ...(truncated ? { truncationNote: `${matched - res.count} more matched than are shown. Raise limit (max ${MAX_LIMIT}) or narrow the filters.` } : {}),
      rankedBy: `${sortBy}, descending. A ranking by the Atlas score, not a recommendation`,
      vaults: res.data,
      funnel: ex === undefined ? null : {
        universe: ex.universe, candidates: ex.candidates, matched: ex.matched,
        removedBy, liveCatalogEntries: ex.liveCatalogEntries,
      },
      ...(ex === undefined ? { funnelNote: 'Filter breakdown unavailable: this API predates explain, so what the filters removed is not shown.' } : {}),
      notableExcluded: (ex?.notable ?? []).map((n) => ({ ...n, reasonText: n.reasons.map((r) => REASON_TEXT[r]) })),
      similarAssets: ex?.similarAssets ?? [],
      ...(coldWarning !== undefined ? { cacheWarning: coldWarning } : {}),
      flagLegend: FLAG_LEGEND,
      presentation: PRESENTATION,
      viewUrl: `${SITE_URL}/find?${view.toString()}`,
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
