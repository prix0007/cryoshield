/**
 * add-privacy-preserving-analytics 4.1 (spec landing-analytics "Privacy signals suppress the beacon", "No URL
 * parameters or identifiers sent"). The beacon element ships inert in a <template> (Trusted Types 'none' forbids
 * setting script.src from JS); the loader clones it into the document only when allowed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadBeacon } from '../../src/landing/analytics';

const TOKEN = 'ab'.repeat(16);
function page(withTemplate = true) {
  document.head.replaceChildren();
  document.body.replaceChildren();
  if (withTemplate) {
    const t = document.createElement('template');
    t.id = 'cf-beacon';
    t.dataset.host = 'cryoshield.app';
    const s = document.createElement('script');
    s.setAttribute('defer', '');
    s.setAttribute('src', 'https://static.cloudflareinsights.com/beacon.min.js');
    s.setAttribute('integrity', 'sha384-abc');
    s.setAttribute('crossorigin', 'anonymous');
    s.setAttribute('data-cf-beacon', JSON.stringify({ token: TOKEN, spa: false }));
    t.content.append(s);
    document.body.append(t);
  }
}
function win(over: { gpc?: boolean; dnt?: string | null; host?: string; search?: string; hash?: string } = {}) {
  const replaceState = vi.fn();
  return {
    w: {
      navigator: { globalPrivacyControl: over.gpc ?? false, doNotTrack: over.dnt ?? null },
      location: { hostname: over.host ?? 'cryoshield.app', pathname: '/', search: over.search ?? '', hash: over.hash ?? '' },
      history: { replaceState },
    } as unknown as Window,
    replaceState,
  };
}
const beacons = () => [...document.querySelectorAll('head script[data-cf-beacon]')];

beforeEach(() => page());

describe('loadBeacon', () => {
  it('inserts exactly one integrity-pinned, anonymous-CORS beacon with spa:false when allowed', () => {
    const { w } = win();
    expect(loadBeacon(document, w)).toBe(true);
    const s = beacons();
    expect(s).toHaveLength(1);
    expect(s[0]!.getAttribute('integrity')).toBe('sha384-abc');
    expect(s[0]!.getAttribute('crossorigin')).toBe('anonymous');
    expect(JSON.parse(s[0]!.getAttribute('data-cf-beacon')!)).toEqual({ token: TOKEN, spa: false });
    expect(loadBeacon(document, w)).toBe(false); // never twice
    expect(beacons()).toHaveLength(1);
  });

  it.each([
    ['GPC', { gpc: true }],
    ['DNT', { dnt: '1' }],
    ['another host', { host: 'cryoshield-web.fly.dev' }],
  ])('inserts nothing under %s', (_n, over) => {
    const { w, replaceState } = win(over);
    expect(loadBeacon(document, w)).toBe(false);
    expect(beacons()).toHaveLength(0);
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('inserts nothing when the build has no beacon (token unset, dev or E2E build)', () => {
    page(false);
    expect(loadBeacon(document, win().w)).toBe(false);
    expect(document.querySelectorAll('script')).toHaveLength(0);
  });

  it('strips the query and fragment with history.replaceState BEFORE inserting the beacon', () => {
    const { w, replaceState } = win({ search: '?ref=abc&utm_source=x', hash: '#frag' });
    const appendSpy = vi.spyOn(document.head, 'append');
    loadBeacon(document, w);
    expect(replaceState).toHaveBeenCalledWith(null, '', '/');
    expect(replaceState.mock.invocationCallOrder[0]!).toBeLessThan(appendSpy.mock.invocationCallOrder[0]!);
  });
});
