// @vitest-environment node
/**
 * harden-codeql-web-findings (CodeQL #4, js/bad-tag-filter): the legal Markdown renderer passes through ONLY the
 * exact build-time markers it knows. Any other comment-looking line could smuggle raw HTML (`<!-- --><script>…`), so
 * it fails the build instead of being copied into the page.
 */
import { describe, expect, it } from 'vitest';
import { LEGAL_MARKERS, renderMarkdown } from '../../vite-plugins/legal';

describe('legal renderer markers', () => {
  it('passes the known markers through exactly', () => {
    expect([...LEGAL_MARKERS].sort()).toEqual(['<!--legal-note-->', '<!--storage-inventory-->', '<!--storage-preferences-->']);
    expect(renderMarkdown('a\n\n<!--legal-note-->\n\nb')).toBe('<p>a</p>\n<!--legal-note-->\n<p>b</p>');
    expect(renderMarkdown('<!--storage-inventory-->')).toBe('<!--storage-inventory-->');
    expect(renderMarkdown('<!--storage-preferences-->')).toBe('<!--storage-preferences-->');
  });
  it('refuses a comment line that smuggles markup', () => {
    expect(() => renderMarkdown('<!-- --><script>alert(1)</script><!-- -->')).toThrow(/marker/);
    expect(() => renderMarkdown('<!--x--><img src=x onerror=alert(1)><!--y-->')).toThrow(/marker/);
  });
  it('refuses unknown or near-miss markers (exact match only)', () => {
    for (const l of ['<!-- legal-note -->', '<!--legal-note --!>', '<!--storage-inventory--><b>x</b><!---->', '<!--todo: fix-->']) {
      expect(() => renderMarkdown(l), l).toThrow(/marker/);
    }
  });
  it('the real legal and repo documents still render (they use only the known markers)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { resolveNetworkCopy } = await import('../../vite-plugins/network-copy');
    const web = join(__dirname, '..', '..');
    // launch-op-mainnet D6: the legal text's network blocks are resolved for the build's chain before rendering, so the
    // renderer never sees them; an unresolved one is refused like any other comment line.
    for (const chainId of [11155420, 10]) {
      const network = (md: string) => resolveNetworkCopy(md, { chainId, rpId: 'cryoshield.app', now: 0, rpc: { host: 'rpc.example', vendor: 'Example', policy: 'Not published' } });
      for (const f of ['legal/privacy.md', 'legal/terms.md', 'legal/cookies.md', '../../docs/supported-devices.md']) {
        expect(() => renderMarkdown(network(readFileSync(join(web, f), 'utf8'))), `${f} (chain ${chainId})`).not.toThrow();
      }
    }
    expect(() => renderMarkdown(readFileSync(join(web, 'legal', 'terms.md'), 'utf8'))).toThrow(/marker/);
  });
});
