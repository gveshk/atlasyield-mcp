import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AtlasClient } from './atlas-client.js';
import { createServer } from './server.js';

describe('createServer', () => {
  it('every registered tool declares itself read-only (clients skip confirmations on this, and we ship no write surface)', async () => {
    const server = createServer(new AtlasClient({ fetch: (async () => new Response('{}')) as typeof fetch }));
    const client = new Client({ name: 'test', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'check_route_survival', 'compare_vaults', 'explain_vault_score', 'find_vaults',
      'get_coverage', 'get_vault_score', 'list_open_alerts',
    ]);
    for (const t of tools) {
      expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    }
    await client.close();
  });
});
