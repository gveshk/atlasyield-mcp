/**
 * AY-204 — keyless HTTP client for the public Atlas surfaces.
 *
 * Talks ONLY to the public /v1 API (AY-201, no key) and the published
 * score-history repo. No @atlas/* imports on purpose: this package must be
 * publishable and runnable outside the monorepo. Read-only: nothing here
 * writes, signs, or holds anything.
 */

export const DEFAULT_API_BASE = 'https://api.atlasyield.club/v1';
export const DEFAULT_SNAPSHOT_BASE =
  'https://raw.githubusercontent.com/gveshk/atlasyield-score-history/main';

export class AtlasApiError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status: number,
    /** From the Retry-After header on a 429/503, so callers can back off instead of retrying blind. */
    readonly retryAfterSeconds?: number,
  ) {
    super(retryAfterSeconds === undefined ? message : `${message} (retry after ${retryAfterSeconds}s)`);
    this.name = 'AtlasApiError';
  }
}

/** One row of GET /v1/scores `data[]`. Mirrors rowToScore in apps/api public-api.ts. */
export interface ScoreRow {
  vaultId: string;
  chainId: number;
  protocolId: string;
  name: string | null;
  asset: string | null;
  assetClass: string | null;
  composite: number;
  label: string;
  pillarScores: Record<string, number>;
  apy: number | null;
  tvl: number | null;
  dataQuality: string;
  scoredAt: string;
  scorerVersion: string;
  yieldQuality: string | null;
  yieldQualityReason: string | null;
  exitSafety: string | null;
  exitSafetyReason: string | null;
}

export interface ScoresResponse {
  success: true;
  scorerVersion: string;
  count: number;
  disclaimer?: string;
  data: ScoreRow[];
}

/** One entry of GET /v1/vaults/:chainId/:address/factors `data.factors`. */
export interface FactorEntry {
  score: number;
  weight: number;
  rawValue: number;
  label: string;
  pillar: 'yield' | 'safety' | 'liquidity' | 'sustainability';
}

/** GET /v1/vaults/:chainId/:address/factors `data`. */
export interface FactorsData {
  vaultId: string;
  chainId: number;
  protocolId: string;
  composite: number;
  label: string;
  pillarScores: Record<string, number>;
  factors: Record<string, FactorEntry>;
  dataQuality: string;
  scoredAt: string;
  scorerVersion: string;
}

export interface FactorsResponse {
  success: true;
  disclaimer?: string;
  data: FactorsData;
}

/** GET /v1/vaults/:chainId/:address/route `data`. */
export interface RouteData {
  vaultId?: string;
  chainId: number;
  address?: string;
  screened: boolean;
  verdict: 'OK' | 'DEGRADED' | 'DANGEROUS' | 'UNPRICEABLE' | 'NO_ROUTE' | 'SKIPPED' | null;
  reasonClass?: 'protocol_refused' | 'no_aggregator_quote' | 'dust' | 'no_amount' | 'rate_limited' | 'unmapped' | null;
  usdIn: number | null;
  usdOut: number | null;
  retained: number | null;
  path: string | null;
  checkedAt: string | null;
  probe?: { scope: string; crossChain: string; notionalsUsd: number[] };
}

export interface RouteResponse {
  success: true;
  disclaimer?: string;
  data: RouteData;
}

/** alerts-latest.json, written by publish-daily-snapshot.ts (AY-163). */
export interface AlertItem {
  id: string;
  vaultId: string;
  chainId: number;
  protocolId: string;
  asset: string | null;
  trigger: string;
  severity: number;
  scoreBefore: number;
  scoreAfter: number;
  bandBefore: string | null;
  bandAfter: string | null;
  pillarDeltas: Record<string, number>;
  apyBefore: number | null;
  apyAfter: number | null;
  [k: string]: unknown;
}

export interface AlertsLatest {
  date: string;
  publishedAt: string;
  monitorVersion: string;
  windowDays: number;
  events: AlertItem[];
}

export interface AtlasClientOptions {
  apiBase?: string;
  snapshotBase?: string;
  fetch?: typeof fetch;
}

export class AtlasClient {
  private readonly apiBase: string;
  private readonly snapshotBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: AtlasClientOptions = {}) {
    this.apiBase = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/$/, '');
    this.snapshotBase = (opts.snapshotBase ?? DEFAULT_SNAPSHOT_BASE).replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async getScores(filter: { chainId?: number; protocolId?: string }): Promise<ScoresResponse> {
    const qs = new URLSearchParams();
    if (filter.chainId !== undefined) qs.set('chainId', String(filter.chainId));
    if (filter.protocolId !== undefined) qs.set('protocolId', filter.protocolId);
    const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
    return this.fetchJson<ScoresResponse>(`${this.apiBase}/scores${suffix}`);
  }

  async getFactors(chainId: number, address: string): Promise<FactorsResponse> {
    return this.fetchJson<FactorsResponse>(
      `${this.apiBase}/vaults/${chainId}/${address.toLowerCase()}/factors`,
    );
  }

  async getRoute(chainId: number, address: string): Promise<RouteResponse> {
    return this.fetchJson<RouteResponse>(
      `${this.apiBase}/vaults/${chainId}/${address.toLowerCase()}/route`,
    );
  }

  async getAlerts(): Promise<AlertsLatest> {
    return this.fetchJson<AlertsLatest>(`${this.snapshotBase}/alerts-latest.json`);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await this.fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'atlasyield-mcp' },
    });
    const retryAfter = res.headers.get('retry-after');
    const retryAfterSeconds =
      retryAfter !== null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : undefined;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new AtlasApiError(
        `HTTP ${res.status} from ${url} (non-JSON body)`, url, res.status, retryAfterSeconds,
      );
    }
    if (
      typeof body === 'object' && body !== null &&
      'success' in body && (body as { success: unknown }).success === false
    ) {
      const err = (body as { error?: unknown }).error;
      throw new AtlasApiError(
        `Atlas API error (HTTP ${res.status}): ${typeof err === 'string' ? err : JSON.stringify(err)}`,
        url,
        res.status,
        retryAfterSeconds,
      );
    }
    if (!res.ok) {
      throw new AtlasApiError(`HTTP ${res.status} from ${url}`, url, res.status, retryAfterSeconds);
    }
    return body as T;
  }
}
