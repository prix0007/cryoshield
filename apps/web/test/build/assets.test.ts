// @vitest-environment node
/** redesign-landing-and-app-ui 1.1: every third-party asset/library is pinned and recorded in docs/design/ASSETS.md. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
const assetsMd = readFileSync(join(web, '..', '..', 'docs', 'design', 'ASSETS.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(web, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };

describe('third-party assets (ASSETS.md)', () => {
  it('records the vendored Inter woff2 with its exact SHA-256 and the OFL', () => {
    const font = readFileSync(join(web, 'src', 'ui', 'fonts', 'inter-latin-wght-normal.woff2'));
    const sha = createHash('sha256').update(font).digest('hex');
    expect(assetsMd).toContain(sha);
    expect(assetsMd).toMatch(/SIL Open Font License 1\.1/);
    expect(readFileSync(join(web, 'src', 'ui', 'fonts', 'OFL.txt'), 'utf8')).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it('pins motion exactly and records it with its MIT license', () => {
    expect(pkg.dependencies.motion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(assetsMd).toContain(`motion@${pkg.dependencies.motion}`);
    expect(assetsMd).toMatch(/\bMIT\b/);
  });
});
