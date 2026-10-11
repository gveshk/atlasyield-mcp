import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SERVER_VERSION } from './server.js';

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8')) as Record<string, any>;
const pkg = read('../package.json');
const reg = read('../server.json');

/** Numeric semver compare, major.minor.patch only (no prerelease tags are used here). */
function cmp(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

describe('release versions', () => {
  it('the code, the npm package and the registry package entry are one version', () => {
    expect(SERVER_VERSION).toBe(pkg['version']);
    expect(reg['packages'][0].version).toBe(pkg['version']);
  });

  it('the registry listing version is never behind the package (it may run ahead for a registry-only change)', () => {
    expect(cmp(reg['version'], pkg['version'])).toBeGreaterThanOrEqual(0);
  });

  it('the registry entry points at this package and name', () => {
    expect(reg['packages'][0].identifier).toBe(pkg['name']);
    expect(reg['name']).toBe(pkg['mcpName']);
  });
});
