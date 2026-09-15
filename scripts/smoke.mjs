#!/usr/bin/env node
// Raw JSON-RPC smoke over stdio: initialize → tools/list → tools/call.
// Usage: node scripts/smoke.mjs [toolName] [jsonArgs]
//   node scripts/smoke.mjs check_route_survival '{"chainId":8453,"address":"0x..."}'
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bin = join(here, '..', 'dist', 'index.js');
const [tool = 'get_coverage', rawArgs = '{}'] = process.argv.slice(2);

const child = spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}
function notify(method, params) {
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

const init = await send('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'smoke', version: '0' },
});
console.log('initialize →', init.result?.serverInfo);
notify('notifications/initialized', {});

const list = await send('tools/list', {});
const names = (list.result?.tools ?? []).map((t) => t.name);
console.log('tools/list →', names);
const expected = ['get_vault_score', 'get_coverage', 'check_route_survival', 'list_open_alerts'];
for (const n of expected) if (!names.includes(n)) { console.error(`MISSING TOOL ${n}`); process.exit(2); }

const call = await send('tools/call', { name: tool, arguments: JSON.parse(rawArgs) });
console.log(`tools/call ${tool} →`, JSON.stringify(call.result, null, 2));
child.kill();
process.exit(call.result?.isError ? 3 : 0);
