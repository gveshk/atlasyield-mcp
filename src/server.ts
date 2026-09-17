/**
 * AY-204 — registers the read-only tools on an McpServer.
 * No custody, no writes, no execution surface. Execution, if it ever ships,
 * is AY-261/262 as separate /v1/execute endpoints — not tools here.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AtlasClient } from './atlas-client.js';
import { getVaultScore, getVaultScoreInput, getVaultScoreDescription } from './tools/get-vault-score.js';
import { getCoverage, getCoverageInput, getCoverageDescription } from './tools/get-coverage.js';
import { checkRouteSurvival, checkRouteSurvivalInput, checkRouteSurvivalDescription } from './tools/check-route-survival.js';
import { listOpenAlerts, listOpenAlertsInput, listOpenAlertsDescription } from './tools/list-open-alerts.js';
import { explainVaultScore, explainVaultScoreInput, explainVaultScoreDescription } from './tools/explain-vault-score.js';
import { compareVaults, compareVaultsInput, compareVaultsDescription } from './tools/compare-vaults.js';

export const SERVER_NAME = 'atlasyield';
export const SERVER_VERSION = '0.2.0';

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
    'get_vault_score',
    { title: 'Get vault score', description: getVaultScoreDescription, inputSchema: getVaultScoreInput },
    (args) => getVaultScore(client, args),
  );
  server.registerTool(
    'get_coverage',
    { title: 'Get coverage', description: getCoverageDescription, inputSchema: getCoverageInput },
    (args) => getCoverage(client, {
      ...(args.chainId !== undefined ? { chainId: args.chainId } : {}),
      ...(args.protocolId !== undefined ? { protocolId: args.protocolId } : {}),
    }),
  );
  server.registerTool(
    'check_route_survival',
    { title: 'Check route survival', description: checkRouteSurvivalDescription, inputSchema: checkRouteSurvivalInput },
    (args) => checkRouteSurvival(client, args),
  );
  server.registerTool(
    'list_open_alerts',
    { title: 'List open alerts', description: listOpenAlertsDescription, inputSchema: listOpenAlertsInput },
    (args) => listOpenAlerts(client, {
      ...(args.chainId !== undefined ? { chainId: args.chainId } : {}),
      ...(args.minSeverity !== undefined ? { minSeverity: args.minSeverity } : {}),
    }),
  );

  server.registerTool(
    'explain_vault_score',
    { title: 'Explain vault score', description: explainVaultScoreDescription, inputSchema: explainVaultScoreInput },
    (args) => explainVaultScore(client, args),
  );
  server.registerTool(
    'compare_vaults',
    { title: 'Compare vaults', description: compareVaultsDescription, inputSchema: compareVaultsInput },
    (args) => compareVaults(client, args),
  );

  return server;
}
