/**
 * reload-on-new-build D1–D3: the build check compares the running page's module entry scripts with the served page's.
 * Only a definite difference is `outdated`; anything undecidable is `unknown` and never blocks a write.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertCurrentBuild, checkBuild, moduleScriptsInHtml, type BuildState } from '../../src/lib/build-check';
import { WriteError } from '../../src/account/errors';

const HREF = 'https://cryoshield.test/app/?x=1#top';
const page = (...srcs: string[]) =>
  `<!doctype html><html><head><meta charset="utf-8" />${srcs.map((s) => `<script type="module" crossorigin src="${s}"></script>`).join('')}<link rel="stylesheet" href="/assets/app-1.css"></head><body><div id="root"></div></body></html>`;

function running(...srcs: string[]): Document {
  const doc = document.implementation.createHTMLDocument('app');
  for (const s of srcs) {
    const el = doc.createElement('script');
    el.type = 'module';
    el.setAttribute('src', s);
    doc.head.append(el);
  }
  // Vite injects these at runtime for lazy chunks; they must not count.
  const pre = doc.createElement('link');
  pre.rel = 'modulepreload';
  pre.href = '/assets/lazy-9.js';
  doc.head.append(pre);
  return doc;
}

const html = (body: string, init: ResponseInit = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

afterEach(() => vi.useRealTimers());

describe('moduleScriptsInHtml', () => {
  it('reads module script paths in any attribute order and quoting, ignores classic scripts and links', () => {
    const h = `<script src="/assets/legacy.js"></script><script crossorigin type='module' src='/assets/app-A.js'></script><SCRIPT TYPE="module" SRC="https://cryoshield.test/assets/b-B.js"></SCRIPT><link rel="modulepreload" href="/assets/c.js">`;
    expect(moduleScriptsInHtml(h, HREF)).toEqual(['/assets/app-A.js', '/assets/b-B.js']);
  });

  it('ignores scripts on another origin and inline module scripts', () => {
    expect(moduleScriptsInHtml(`<script type="module" src="https://evil.test/x.js"></script><script type="module">1</script>`, HREF)).toEqual([]);
  });
});

describe('checkBuild', () => {
  it('current: the same entry (relative vs absolute, any order)', async () => {
    const fetch = vi.fn(async () => html(page('https://cryoshield.test/assets/b.js', '/assets/app-A.js')));
    expect(await checkBuild({ fetch, doc: running('/assets/app-A.js', '/assets/b.js'), href: HREF })).toBe('current');
  });

  it('fetches the same page path, same origin, bypassing the HTTP cache, with no query string', async () => {
    const fetch = vi.fn(async (_u: RequestInfo | URL, _i?: RequestInit) => html(page('/assets/app-A.js')));
    await checkBuild({ fetch, doc: running('/assets/app-A.js'), href: HREF });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('/app/');
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin', method: 'GET' });
    expect(init?.body).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('outdated: the served page names a different entry', async () => {
    const fetch = vi.fn(async () => html(page('/assets/app-B.js')));
    expect(await checkBuild({ fetch, doc: running('/assets/app-A.js'), href: HREF })).toBe('outdated');
  });

  it('outdated: an extra entry on either side', async () => {
    const fetch = vi.fn(async () => html(page('/assets/app-A.js', '/assets/extra.js')));
    expect(await checkBuild({ fetch, doc: running('/assets/app-A.js'), href: HREF })).toBe('outdated');
  });

  it.each<[string, () => Promise<Response>]>([
    ['the fetch rejects (offline)', async () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a non-2xx status', async () => html(page('/assets/app-B.js'), { status: 503 })],
    ['a non-HTML response', async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })],
    ['no module script in the served page', async () => html('<html><body>captive</body></html>')],
    ['the body cannot be read', async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), text: () => Promise.reject(new Error('x')) }) as unknown as Response],
  ])('unknown: %s', async (_name, impl) => {
    expect(await checkBuild({ fetch: vi.fn(impl), doc: running('/assets/app-A.js'), href: HREF })).toBe('unknown');
  });

  it('unknown: no module script in the running document', async () => {
    const fetch = vi.fn(async () => html(page('/assets/app-B.js')));
    expect(await checkBuild({ fetch, doc: running(), href: HREF })).toBe('unknown');
  });

  it('unknown: no answer within the timeout, and the fetch is aborted', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_u: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_res, rej) => signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
    });
    const p = checkBuild({ fetch, doc: running('/assets/app-A.js'), href: HREF, timeoutMs: 4000 });
    await vi.advanceTimersByTimeAsync(4000);
    expect(await p).toBe('unknown');
    expect(signal?.aborted).toBe(true);
  });
});

describe('assertCurrentBuild', () => {
  it('throws WriteError OUTDATED only for outdated', async () => {
    await expect(assertCurrentBuild(async () => 'outdated')).rejects.toMatchObject({ code: 'OUTDATED' });
    await expect(assertCurrentBuild(async () => 'outdated')).rejects.toBeInstanceOf(WriteError);
  });

  it.each<BuildState>(['current', 'unknown'])('lets %s through', async (state) => {
    await expect(assertCurrentBuild(async () => state)).resolves.toBeUndefined();
  });

  it('a check that throws counts as unknown (fail open, D3)', async () => {
    await expect(assertCurrentBuild(async () => Promise.reject(new Error('boom')))).resolves.toBeUndefined();
  });

  it('no check configured: lets the write through', async () => {
    await expect(assertCurrentBuild(undefined)).resolves.toBeUndefined();
  });
});
