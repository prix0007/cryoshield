// @vitest-environment jsdom
/**
 * launch-op-mainnet pre-launch review H2 / L5: the honesty denylist's audit rules (no audit promise, no "audited yet")
 * apply to every public page and to llms.txt, on both chains, as built (legal Markdown and partials included).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildForChain, type NetworkBuild } from '../fixtures/network-build';
import { AUDIT_PROMISES } from '../landing/banned';
import { PUBLIC_PAGES } from '../../vite-plugins/seo';

const builds: Record<number, NetworkBuild> = {};
beforeAll(() => {
  builds[11155420] = buildForChain(11155420);
  builds[10] = buildForChain(10);
}, 240_000);
afterAll(() => Object.values(builds).forEach((b) => b.cleanup()));

describe.each([11155420, 10])('chain %i: no audit promise on any public page', (chainId) => {
  it.each(PUBLIC_PAGES.map((p) => p.html.slice(1)))('%s', (page) => {
    const b = builds[chainId]!;
    const d = b.doc(page);
    const text = `${(d.body.textContent ?? '').replace(/\s+/g, ' ')} ${d.querySelector('meta[name="description"]')?.getAttribute('content') ?? ''}`;
    for (const r of AUDIT_PROMISES) expect(text, String(r)).not.toMatch(r);
  });

  it('llms.txt', () => {
    const llms = readFileSync(join(builds[chainId]!.out, 'llms.txt'), 'utf8');
    for (const r of AUDIT_PROMISES) expect(llms, String(r)).not.toMatch(r);
  });
});
