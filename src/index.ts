#!/usr/bin/env node
/**
 * atlasyield-mcp — stdio entry point.
 *   ATLAS_API_BASE       override https://api.atlasyield.club/v1 (local dev)
 *   ATLAS_SNAPSHOT_BASE  override the score-history raw base
 * Logs go to stderr only; stdout is the MCP transport.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AtlasClient } from './atlas-client.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

async function main(): Promise<void> {
  const client = new AtlasClient({
    ...(process.env['ATLAS_API_BASE'] ? { apiBase: process.env['ATLAS_API_BASE'] } : {}),
    ...(process.env['ATLAS_SNAPSHOT_BASE'] ? { snapshotBase: process.env['ATLAS_SNAPSHOT_BASE'] } : {}),
  });
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} ${SERVER_VERSION} ready on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`atlasyield-mcp fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
