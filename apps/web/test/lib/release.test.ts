/**
 * footer-release-version D4: the app's /release.json reader accepts only the documented shape, labels a release or a
 * development commit, and reports "unknown" (null) for anything it cannot trust, including a slow fetch.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchRelease, parseRelease, releaseLink } from '../../src/lib/release';

const SHA = 'a'.repeat(40);
const REPO = 'https://github.com/prix0007/cryoshield';
const json = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) }) as unknown as Response;

describe('parseRelease', () => {
  it('accepts a production identity (tag) and a development one (null)', () => {
    expect(parseRelease({ name: 'cryoshield-web', commit: SHA, release: 'v1.0.3', treeHash: 'x', config: {} })).toEqual({ commit: SHA, release: 'v1.0.3' });
    expect(parseRelease({ commit: SHA, release: 'v2.0.0-rc.1' })).toEqual({ commit: SHA, release: 'v2.0.0-rc.1' });
    expect(parseRelease({ commit: SHA, release: null })).toEqual({ commit: SHA, release: null });
  });

  it.each<[string, unknown]>([
    ['no commit', { release: 'v1.0.3' }],
    ['short commit', { commit: 'abc1234', release: null }],
    ['upper-case commit', { commit: 'A'.repeat(40), release: null }],
    ['release missing (older deploys)', { commit: SHA }],
    ['release without v', { commit: SHA, release: '1.0.3' }],
    ['release with markup', { commit: SHA, release: 'v1.0.3<b>' }],
    ['release with a space', { commit: SHA, release: 'v1.0.3 beta' }],
    ['release with a slash', { commit: SHA, release: 'v1.0.3/../x' }],
    ['release not a string', { commit: SHA, release: 103 }],
    ['an array', [SHA]],
    ['a string', 'v1.0.3'],
    ['null', null],
  ])('rejects %s', (_name, body) => {
    expect(parseRelease(body)).toBeNull();
  });
});

describe('releaseLink', () => {
  it('links a tag to its GitHub release and a development commit to the commit page', () => {
    expect(releaseLink({ commit: SHA, release: 'v1.0.3' })).toEqual({ text: 'v1.0.3', href: `${REPO}/releases/tag/v1.0.3` });
    expect(releaseLink({ commit: SHA, release: null })).toEqual({ text: `dev ${'a'.repeat(7)}`, href: `${REPO}/commit/${SHA}` });
  });
});

describe('fetchRelease', () => {
  it('fetches /release.json from its own origin, uncached, and returns the parsed identity', async () => {
    const fetch = vi.fn(async () => json({ commit: SHA, release: 'v1.0.3' }));
    await expect(fetchRelease({ fetch })).resolves.toEqual({ commit: SHA, release: 'v1.0.3' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/release.json');
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'same-origin' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('returns null on 404, on a non-JSON body, on an unexpected shape and on a rejected fetch', async () => {
    await expect(fetchRelease({ fetch: async () => json({ error: 'nope' }, 404) })).resolves.toBeNull();
    await expect(fetchRelease({ fetch: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }) as unknown as Response })).resolves.toBeNull();
    await expect(fetchRelease({ fetch: async () => json({ commit: SHA }) })).resolves.toBeNull();
    await expect(fetchRelease({ fetch: async () => { throw new TypeError('offline'); } })).resolves.toBeNull();
  });

  it('gives up when the body read stalls after the headers arrived', async () => {
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: () => new Promise<unknown>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    }) as unknown as Response);
    await expect(fetchRelease({ fetch, timeoutMs: 10 })).resolves.toBeNull();
  });

  it('gives up after the timeout (aborts the request) and returns null', async () => {
    const fetch = vi.fn((_u: string, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    await expect(fetchRelease({ fetch, timeoutMs: 10 })).resolves.toBeNull();
  });
});
