/**
 * redesign-landing-and-app-ui 3.2 (spec landing-page "Motion respects reduced motion"): the motion chunk is never
 * loaded under reduced motion, is loaded lazily when a graphic nears the viewport, and a failure leaves the page static.
 */
import { describe, expect, it, vi } from 'vitest';
import { bootLanding } from '../../src/landing/boot';

function page() {
  document.body.replaceChildren();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('data-motion', 'how');
  const details = document.createElement('details');
  details.className = 'nav-menu';
  details.open = true;
  const link = document.createElement('a');
  link.href = '#faq';
  details.append(document.createElement('summary'), link);
  document.body.append(details, svg);
  return { svg, details, link };
}

class FakeIO {
  static last: FakeIO | undefined;
  observed: Element[] = [];
  disconnected = false;
  constructor(public cb: (e: { isIntersecting: boolean; target: Element }[]) => void, public opts: IntersectionObserverInit) {
    FakeIO.last = this;
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  fire(isIntersecting: boolean) {
    this.cb(this.observed.map((target) => ({ isIntersecting, target })));
  }
}
const mm = (reduce: boolean) => (q: string) => ({ matches: reduce && q.includes('reduce') }) as MediaQueryList;

describe('bootLanding', () => {
  it('never imports motion when the user prefers reduced motion', () => {
    page();
    const load = vi.fn();
    bootLanding({ doc: document, matchMedia: mm(true), IO: FakeIO as never, load });
    expect(load).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('motion-ok')).toBe(false);
  });

  it('imports motion only once a graphic approaches the viewport, then starts it', async () => {
    const { svg } = page();
    const start = vi.fn();
    const load = vi.fn(async () => ({ start }));
    bootLanding({ doc: document, matchMedia: mm(false), IO: FakeIO as never, load });
    expect(load).not.toHaveBeenCalled();
    expect(FakeIO.last!.observed).toEqual([svg]);
    expect(FakeIO.last!.opts.rootMargin).toMatch(/px/);
    FakeIO.last!.fire(false);
    expect(load).not.toHaveBeenCalled();
    FakeIO.last!.fire(true);
    expect(load).toHaveBeenCalledTimes(1);
    expect(FakeIO.last!.disconnected).toBe(true);
    await vi.waitFor(() => expect(start).toHaveBeenCalledWith(document));
  });

  it('a failed import or start leaves the page static and throws nothing', async () => {
    page();
    const load = vi.fn(async () => {
      throw new Error('offline');
    });
    bootLanding({ doc: document, matchMedia: mm(false), IO: FakeIO as never, load });
    FakeIO.last!.fire(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.armed')).toBeNull();
  });

  it('without IntersectionObserver, motion is skipped (static page)', () => {
    page();
    const load = vi.fn();
    bootLanding({ doc: document, matchMedia: mm(false), IO: undefined, load });
    expect(load).not.toHaveBeenCalled();
  });

  it('closes the narrow nav menu on Escape and after following a link', () => {
    const { details, link } = page();
    bootLanding({ doc: document, matchMedia: mm(true), IO: FakeIO as never, load: vi.fn() });
    details.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(details.open).toBe(false);
    details.open = true;
    link.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(details.open).toBe(false);
  });
});
