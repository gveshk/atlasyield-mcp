/**
 * AY-204 — registers the read-only tools on an McpServer.
 * No custody, no writes, no execution surface. Execution, if it ever ships,
 * is AY-261/262 as separate /v1/execute endpoints — not tools here.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AtlasClient } from './atlas-client.ts';
import { findVaults, findVaultsInput, findVaultsDescription } from './tools/find-vaults.ts';
import { getVaultScore, getVaultScoreInput, getVaultScoreDescription } from './tools/get-vault-score.ts';
import { getCoverage, getCoverageInput, getCoverageDescription } from './tools/get-coverage.ts';
import { checkRouteSurvival, checkRouteSurvivalInput, checkRouteSurvivalDescription } from './tools/check-route-survival.ts';
import { listOpenAlerts, listOpenAlertsInput, listOpenAlertsDescription } from './tools/list-open-alerts.ts';
import { explainVaultScore, explainVaultScoreInput, explainVaultScoreDescription } from './tools/explain-vault-score.ts';
import { compareVaults, compareVaultsInput, compareVaultsDescription } from './tools/compare-vaults.ts';

export const SERVER_NAME = 'atlasyield';
export const SERVER_VERSION = '0.3.0';

/**
 * Every tool here only reads. Clients use these hints to skip confirmation prompts (ChatGPT confirms
 * unannotated tools), so they are asserted in server.test.ts rather than trusted to stay true.
 * openWorldHint is false: the tools talk only to AtlasYield's own API.
 */
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export function createServer(client: AtlasClient): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'AtlasYield is an independent judgment layer for on-chain yield. Scores are research, ' +
        'not investment advice. Call check_route_survival before any deposit; blocking:true means refuse.',
    },
  );

  server.registerTool(
    'find_vaults',
    { title: 'Find vaults', description: findVaultsDescription, inputSchema: findVaultsInput, annotations: READ_ONLY },
    (args) => findVaults(client, args),
  );
  server.registerTool(
    'get_vault_score',
    { title: 'Get vault score', description: getVaultScoreDescription, inputSchema: getVaultScoreInput, annotations: READ_ONLY },
    (args) => getVaultScore(client, args),
  );
  server.registerTool(
    'get_coverage',
    { title: 'Get coverage', description: getCoverageDescription, inputSchema: getCoverageInput, annotations: READ_ONLY },
    (args) => getCoverage(client, {
      ...(args.chainId !== undefined ? { chainId: args.chainId } : {}),
      ...(args.protocolId !== undefined ? { protocolId: args.protocolId } : {}),
    }),
  );
  server.registerTool(
    'check_route_survival',
    { title: 'Check route survival', description: checkRouteSurvivalDescription, inputSchema: checkRouteSurvivalInput, annotations: READ_ONLY },
    (args) => checkRouteSurvival(client, args),
  );
  server.registerTool(
    'list_open_alerts',
    { title: 'List open alerts', description: listOpenAlertsDescription, inputSchema: listOpenAlertsInput, annotations: READ_ONLY },
    (args) => listOpenAlerts(client, {
      ...(args.chainId !== undefined ? { chainId: args.chainId } : {}),
      ...(args.minSeverity !== undefined ? { minSeverity: args.minSeverity } : {}),
    }),
  );

  server.registerTool(
    'explain_vault_score',
    { title: 'Explain vault score', description: explainVaultScoreDescription, inputSchema: explainVaultScoreInput, annotations: READ_ONLY },
    (args) => explainVaultScore(client, args),
  );
  server.registerTool(
    'compare_vaults',
    { title: 'Compare vaults', description: compareVaultsDescription, inputSchema: compareVaultsInput, annotations: READ_ONLY },
    (args) => compareVaults(client, args),
  );

  return server;
}
