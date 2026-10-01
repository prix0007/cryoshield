#!/usr/bin/env node
// README doctest (task 7.1): extracts every ```ts block from README.md into
// test/readme/snippet-N.test-d.ts so `vitest --typecheck` compiles each one
// against the real source. The package import is rewritten to ../../src/index.js.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const blocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((m) => m[1]);
if (blocks.length === 0) throw new Error('README has no ```ts snippets');

const outDir = join(root, 'test', 'readme');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
blocks.forEach((code, i) => {
  const body = code.replaceAll("'@cryoshield/vault-crypto'", "'../../src/index.js'");
  const file = [
    '// GENERATED from README.md by scripts/extract-readme-snippets.mjs; do not edit.',
    "import { test as __readmeTest } from 'vitest';",
    body,
    `__readmeTest('README snippet ${i + 1} compiles', () => {});`,
    'export {};',
    '',
  ].join('\n');
  writeFileSync(join(outDir, `snippet-${i + 1}.test-d.ts`), file);
});
console.log(`extracted ${blocks.length} README snippets`);
