/** app-motion-ux guardrail (g): Motion comes from ONE exact pin, motion@13.5.0, with no second copy or direct framer-motion. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(__dirname, '..', '..', '..', '..');
const pkg = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8')) as { dependencies: Record<string, string>; devDependencies?: Record<string, string> };
const lock = readFileSync(join(repo, 'pnpm-lock.yaml'), 'utf8');

describe('motion pin', () => {
  it('apps/web depends on motion at exactly 13.5.0 and not on framer-motion directly', () => {
    expect(pkg.dependencies.motion).toBe('13.5.0');
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty('framer-motion');
  });
  it('the lockfile resolves a single 13.5.0 of motion and its internals', () => {
    for (const name of ['motion', 'framer-motion', 'motion-dom', 'motion-utils']) {
      const versions = new Set([...lock.matchAll(new RegExp(`^  ${name}@(\\d+\\.\\d+\\.\\d+)`, 'gm'))].map((m) => m[1]));
      expect([...versions], name).toEqual(['13.5.0']);
    }
  });
});
