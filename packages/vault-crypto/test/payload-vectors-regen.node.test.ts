/**
 * docs/spec/payload-vectors.json must be byte-identical to a fresh run of
 * scripts/gen-payload-vectors.py (change vault-list-labels-archive, task 1.1).
 *
 * Needs the generator's pinned Python environment (scripts/.venv, from scripts/requirements.txt).
 * Without it the test is skipped, unless CRYOSHIELD_REQUIRE_PY_VECTORS=1 (set it in CI), which
 * turns a missing environment into a failure. payload-vectors.test.ts independently rebuilds every
 * blob vector and checks every codec vector in TypeScript, so it runs everywhere.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const python = `${pkg}scripts/.venv/bin/python`;
const generator = `${pkg}scripts/gen-payload-vectors.py`;
const vectorsPath = fileURLToPath(new URL('../../../docs/spec/payload-vectors.json', import.meta.url));
const required = process.env.CRYOSHIELD_REQUIRE_PY_VECTORS === '1';
const available = existsSync(python);

describe('payload vectors: deterministic regeneration', () => {
  it('the pinned Python environment exists when required', () => {
    if (required) expect(available, `missing ${python}; see packages/vault-crypto/README.md`).toBe(true);
  });

  it.skipIf(!available)('a fresh generation is byte-identical to the committed file', () => {
    const out = execFileSync(python, [generator, '--check'], { encoding: 'utf8' });
    expect(out).toMatch(/^OK: /);
  });

  it.skipIf(!available)('two fresh generations are byte-identical (no clock, no randomness)', () => {
    const a = execFileSync(python, [generator, '--stdout'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    const b = execFileSync(python, [generator, '--stdout'], { encoding: 'utf8', maxBuffer: 1 << 24 });
    expect(a).toBe(b);
    expect(a).toBe(readFileSync(vectorsPath, 'utf8'));
  });

  it('the committed file is pure ASCII and ends with one newline', () => {
    const text = readFileSync(vectorsPath, 'utf8');
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
  });
});
