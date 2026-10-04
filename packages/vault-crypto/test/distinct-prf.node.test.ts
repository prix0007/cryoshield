/** Node-only source checks for REC-L2 (ECC review of PR #22). Excluded from the browser run. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('assertDistinctPrfs source guards', () => {
  it('compares raw bytes without building string copies of secret PRF outputs', () => {
    const src = readFileSync(new URL('../src/vault.ts', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('function assertDistinctPrfs'), src.indexOf('function assertDistinctPrfs') + 900);
    expect(fn).not.toMatch(/toString\(16\)|new Set<string>|join\(''\)/);
  });

  it('keeps the createVault JSDoc attached to createVault', () => {
    const src = readFileSync(new URL('../src/vault.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/\*\/\nexport async function createVault\(/);
    const before = src.slice(0, src.indexOf('export async function createVault('));
    expect(before.slice(before.lastIndexOf('/**'))).toMatch(/Creates a vault/);
  });
});
