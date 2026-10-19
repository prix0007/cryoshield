/**
 * footer-release-version D4/D5: the landing footer's Version line is hidden until /release.json has been fetched and
 * validated, is filled with text and a link only (no markup), and its labelling agrees with the app's reader.
 */
import { describe, expect, it, vi } from 'vitest';
import { parseRelease, releaseLink } from '../../src/lib/release';
import { labelFor, wireRelease } from '../../src/landing/release';

const SHA = 'b'.repeat(40);
const REPO = 'https://github.com/prix0007/cryoshield';
const json = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as unknown as Response;

function footer() {
  document.body.replaceChildren();
  const f = document.createElement('footer');
  const p = document.createElement('p');
  p.className = 'release';
  p.setAttribute('data-release', '');
  p.hidden = true;
  f.append(p);
  document.body.append(f);
  return p;
}

describe('wireRelease', () => {
  it('shows "Version <tag>" linking to the GitHub release once /release.json names one', async () => {
    const p = footer();
    await wireRelease(document, async () => json({ commit: SHA, release: 'v1.0.3' }));
    expect(p.hidden).toBe(false);
    expect(p.textContent).toBe('Version v1.0.3');
    const a = p.querySelector('a')!;
    expect(a.getAttribute('href')).toBe(`${REPO}/releases/tag/v1.0.3`);
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(p.innerHTML).not.toMatch(/<(?!a|\/a)/);
  });

  it('shows "Version dev <7 hex>" linking to the commit on the development site', async () => {
    const p = footer();
    await wireRelease(document, async () => json({ commit: SHA, release: null }));
    expect(p.textContent).toBe(`Version dev ${'b'.repeat(7)}`);
    expect(p.querySelector('a')!.getAttribute('href')).toBe(`${REPO}/commit/${SHA}`);
  });

  it.each<[string, () => Promise<Response>]>([
    ['404 (dev server, E2E preview)', async () => json({}, 404)],
    ['unexpected shape', async () => json({ commit: SHA })],
    ['markup in the tag', async () => json({ commit: SHA, release: 'v1<img src=x>' })],
    ['rejected fetch', async () => { throw new TypeError('offline'); }],
  ])('stays hidden and empty on %s', async (_n, fetch) => {
    const p = footer();
    await wireRelease(document, fetch);
    expect(p.hidden).toBe(true);
    expect(p.childNodes).toHaveLength(0);
  });

  it('does nothing, not even a fetch, when the page has no Version line', async () => {
    document.body.replaceChildren();
    const fetch = vi.fn(async () => json({ commit: SHA, release: 'v1.0.3' }));
    await wireRelease(document, fetch);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('gives up after the timeout (aborts the request) and leaves the line hidden', async () => {
    const p = footer();
    const fetch = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await wireRelease(document, fetch as unknown as typeof globalThis.fetch, 10);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(p.hidden).toBe(true);
    expect(p.childNodes).toHaveLength(0);
  });

  it('never throws (the page is complete without it)', async () => {
    footer();
    await expect(wireRelease(document, (() => { throw new Error('sync'); }) as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});

describe('parity with the app reader (D5: two modules, one behaviour)', () => {
  it.each<unknown>([
    { commit: SHA, release: 'v1.0.3' },
    { commit: SHA, release: 'v2.0.0-rc.1' },
    { commit: SHA, release: null },
    { commit: SHA },
    { commit: 'B'.repeat(40), release: null },
    { commit: SHA, release: '1.0.3' },
    { commit: SHA, release: 'v1.0.3 x' },
    // the prerelease part of the tag grammar, where two copies of TAG_RE could drift
    { commit: SHA, release: 'v1.0.3-' },
    { commit: SHA, release: 'v1.0.3-.x' },
    { commit: SHA, release: 'v1.0.3--x' },
    { commit: SHA, release: 'v1.0.3-rc.1.beta-2' },
    { commit: SHA, release: 'v1.0.3\n' },
    { commit: SHA, release: 'v01.0.3' },
    { commit: SHA, release: 'V1.0.3' },
    { commit: SHA, release: 'v1.0.3-ü' },
    // the commit grammar
    { commit: SHA.slice(0, 39), release: null },
    { commit: `${SHA}b`, release: null },
    { commit: 'g'.repeat(40), release: null },
    { commit: 42, release: null },
    { commit: null, release: 'v1.0.3' },
    { release: 'v1.0.3' },
    [SHA],
    'v1.0.3',
    null,
    undefined,
  ])('labels %j the same', (body) => {
    const info = parseRelease(body);
    expect(labelFor(body)).toEqual(info ? releaseLink(info) : null);
  });
});
