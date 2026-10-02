/** cinematic-landing 3.1 / 3.3: scene maths, runtime wiring, per-scene lazy loading, counters and magnetic CTAs. */
import { describe, expect, it, vi } from 'vitest';
import { range, scramble, yearAt } from '../../src/landing/scenes/math';
import { mountScene } from '../../src/landing/scenes/runtime';
import { bootScenes, formatStat, wireMagnetic } from '../../src/landing/boot';

describe('scene maths', () => {
  it('range clamps p into a sub-interval', () => {
    expect(range(0, 0.2, 0.6)).toBe(0);
    expect(range(0.4, 0.2, 0.6)).toBeCloseTo(0.5);
    expect(range(1, 0.2, 0.6)).toBe(1);
  });

  it('yearAt maps progress to whole years', () => {
    expect(yearAt(0, 2026, 2036)).toBe(2026);
    expect(yearAt(0.5, 2026, 2036)).toBe(2031);
    expect(yearAt(1, 2026, 2126)).toBe(2126);
  });

  it('scramble is deterministic, keeps length, starts as plaintext and ends fully hex', () => {
    const t = 'abandon ability';
    expect(scramble(t, 0)).toBe(t);
    expect(scramble(t, 0.5)).toBe(scramble(t, 0.5));
    expect(scramble(t, 0.5)).toHaveLength(t.length);
    expect(scramble(t, 1)).toMatch(/^[0-9a-f]+$/);
  });
});

describe('runtime', () => {
  it('writes --p on the stage and calls the scene update on every progress tick', () => {
    const section = document.createElement('section');
    section.innerHTML = '<div class="scene-track"><div class="scene-stage"></div></div>';
    let tick: (p: number) => void = () => {};
    const scroll = vi.fn((cb: (p: number) => void, _opts?: unknown) => {
      tick = cb;
      return () => {};
    });
    const update = vi.fn();
    mountScene(section, { update }, scroll as never);
    const stage = section.querySelector<HTMLElement>('.scene-stage')!;
    expect(stage.classList.contains('live')).toBe(true);
    tick(0.25);
    expect(stage.style.getPropertyValue('--p')).toBe('0.2500');
    expect(update).toHaveBeenCalledWith(stage, 0.25);
    expect(scroll.mock.calls[0]![1]).toMatchObject({ target: section.querySelector('.scene-track') });
  });
});

class FakeIO {
  static all: FakeIO[] = [];
  observed: Element[] = [];
  constructor(public cb: (e: { isIntersecting: boolean; target: Element }[]) => void) {
    FakeIO.all.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve(el: Element) {
    this.observed = this.observed.filter((x) => x !== el);
  }
  disconnect() {}
  fire(el: Element) {
    this.cb([{ isIntersecting: true, target: el }]);
  }
}
const mm = (reduce: boolean) => (q: string) => ({ matches: reduce && q.includes('reduce') }) as MediaQueryList;

describe('bootScenes (per-scene lazy loading)', () => {
  function page() {
    document.body.innerHTML = '<section data-scene="tap"></section><section data-scene="lose"></section>';
    return [...document.querySelectorAll('section')];
  }

  it('never loads anything under reduced motion', () => {
    page();
    const loadRuntime = vi.fn();
    const loadScene = vi.fn();
    bootScenes({ doc: document, matchMedia: mm(true), IO: FakeIO as never, loadRuntime, loadScene });
    expect(loadRuntime).not.toHaveBeenCalled();
    expect(loadScene).not.toHaveBeenCalled();
  });

  it('loads the runtime and only the intersecting scene, then mounts it', async () => {
    const [tap, lose] = page();
    const mount = vi.fn();
    const loadRuntime = vi.fn(async () => ({ mountScene: mount, mountParallax: vi.fn() }));
    const loadScene = vi.fn(async (name: string) => ({ name }));
    FakeIO.all = [];
    bootScenes({ doc: document, matchMedia: mm(false), IO: FakeIO as never, loadRuntime, loadScene });
    expect(loadScene).not.toHaveBeenCalled();
    FakeIO.all[0]!.fire(tap!);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(loadScene).toHaveBeenCalledWith('tap');
    expect(loadScene).not.toHaveBeenCalledWith('lose');
    FakeIO.all[0]!.fire(lose!);
    await vi.waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
  });

  it('a failed load leaves the scene static and throws nothing', async () => {
    const [tap] = page();
    FakeIO.all = [];
    bootScenes({ doc: document, matchMedia: mm(false), IO: FakeIO as never, loadRuntime: async () => { throw new Error('x'); }, loadScene: async () => ({}) });
    FakeIO.all[0]!.fire(tap!);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector('.live')).toBeNull();
  });
});

describe('counters and magnetic CTAs', () => {
  it('formats stat values with prefix and suffix', () => {
    expect(formatStat(2, '', '+')).toBe('2+');
    expect(formatStat(0, '$', '')).toBe('$0');
    expect(formatStat(1, '~', ' KB')).toBe('~1 KB');
  });

  it('magnetic effect is skipped for coarse pointers and reduced motion', () => {
    document.body.innerHTML = '<a class="magnetic" href="#">x</a>';
    const add = vi.spyOn(document, 'addEventListener');
    wireMagnetic(document, (q: string) => ({ matches: q.includes('coarse') || q.includes('none') ? true : false }) as MediaQueryList);
    wireMagnetic(document, (q: string) => ({ matches: q.includes('reduce') }) as MediaQueryList);
    expect(add.mock.calls.filter((c) => c[0] === 'pointermove')).toHaveLength(0);
    wireMagnetic(document, (q: string) => ({ matches: q.includes('fine') }) as MediaQueryList);
    expect(add.mock.calls.filter((c) => c[0] === 'pointermove')).toHaveLength(1);
  });
});
