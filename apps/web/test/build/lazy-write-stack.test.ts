/**
 * harden-gas-sponsorship 5.5: the write stack (viem account abstraction, the Pimlico client, our wallet wrapper and the
 * write operations) is loaded on the first save or account action, never in the initial /app graph. This walks the
 * STATIC import graph from the /app entry (src/main.tsx) through our sources; dynamic `import()` edges are lazy chunks.
 * `import type` is erased at build time; any other import (even `import { type X }`, which keeps a side-effect import
 * under verbatimModuleSyntax) counts as static.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = resolve(__dirname, '../../src');

function resolveLocal(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const p of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(p) && /\.tsx?$/.test(p)) return p;
  }
  return null;
}

/** Static (non-type) import/export-from specifiers of a module. */
function staticSpecifiers(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/^\s*(import|export)\s+(type\s+)?([^'";]*?)\s*from\s*['"]([^'"]+)['"]/gm)) {
    if (m[2]) continue; // import type / export type
    out.push(m[4]!);
  }
  for (const m of code.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) out.push(m[1]!);
  return out;
}

function initialGraph(entry: string) {
  const files = new Set<string>();
  const bare = new Set<string>();
  const visit = (f: string) => {
    if (files.has(f)) return;
    files.add(f);
    for (const s of staticSpecifiers(readFileSync(f, 'utf8'))) {
      if (s.startsWith('.')) {
        const r = resolveLocal(f, s);
        if (r) visit(r);
      } else bare.add(s);
    }
  };
  visit(entry);
  return { files: [...files].map((f) => relative(src, f)), bare: [...bare] };
}

describe('lazy write stack (harden-gas-sponsorship 5.5)', () => {
  const g = initialGraph(join(src, 'main.tsx'));

  it('the walker sees the app (sanity)', () => {
    expect(g.files).toContain('ui/operations.ts');
    expect(g.files).toContain('chain/registry.ts');
    expect(g.bare).toContain('viem');
  });

  it('no write-stack module is in the initial /app graph', () => {
    for (const f of ['account/account.ts', 'account/writes.ts', 'account/wallet.ts', 'account/policy.ts', 'account/stack.ts']) {
      expect(g.files, f).not.toContain(f);
    }
  });

  it('neither viem account abstraction nor permissionless is imported statically', () => {
    expect(g.bare.filter((b) => b.startsWith('viem/account-abstraction') || b.startsWith('permissionless'))).toEqual([]);
  });
});
