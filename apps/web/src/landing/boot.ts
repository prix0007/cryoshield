/**
 * Landing page bootstrap (redesign-landing-and-app-ui D2). Everything here is progressive enhancement: the page is
 * complete and readable without it. The motion chunk is imported only when motion is allowed and a story graphic
 * approaches the viewport; any failure leaves the page static.
 */
export interface MotionModule {
  start(doc: Document): void;
}

export interface BootDeps {
  doc: Document;
  matchMedia: (q: string) => MediaQueryList;
  IO: typeof IntersectionObserver | undefined;
  load: () => Promise<MotionModule>;
}

export function bootLanding({ doc, matchMedia, IO, load }: BootDeps): void {
  wireNavMenu(doc);
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const graphics = [...doc.querySelectorAll('[data-motion]')];
  if (!IO || graphics.length === 0) return;
  const io = new IO(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      load()
        .then((m) => m.start(doc))
        .catch(() => {
          // Static page: undo anything a partial start may have armed.
          doc.querySelectorAll('.armed').forEach((el) => el.classList.remove('armed'));
        });
    },
    { rootMargin: '200px 0px' },
  );
  graphics.forEach((g) => io.observe(g));
}

function wireNavMenu(doc: Document) {
  for (const menu of doc.querySelectorAll<HTMLDetailsElement>('details.nav-menu')) {
    menu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.open) {
        menu.open = false;
        menu.querySelector('summary')?.focus();
      }
    });
    menu.addEventListener('click', (e) => {
      if ((e.target as Element | null)?.closest('a')) menu.open = false;
    });
  }
}

/* ---------------- cinematic-landing D3: per-scene lazy loading, counters, magnetic CTAs ---------------- */

export interface SceneRuntime {
  mountScene(section: Element, scene: object): void;
  mountParallax(doc: Document): void;
}
export interface SceneDeps {
  doc: Document;
  matchMedia: (q: string) => MediaQueryList;
  IO: typeof IntersectionObserver | undefined;
  loadRuntime: () => Promise<SceneRuntime>;
  loadScene: (name: string) => Promise<object>;
}

/** Imports the shared runtime and each scene's own module only when that scene is within one viewport. */
export function bootScenes({ doc, matchMedia, IO, loadRuntime, loadScene }: SceneDeps): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !IO) return;
  const scenes = [...doc.querySelectorAll<HTMLElement>('[data-scene]')];
  if (scenes.length === 0) return;
  let runtime: Promise<SceneRuntime> | undefined;
  const io = new IO(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const name = (e.target as HTMLElement).dataset.scene ?? '';
        if (!runtime) {
          runtime = loadRuntime();
          runtime.then((rt) => rt.mountParallax(doc)).catch(() => undefined);
        }
        Promise.all([runtime, loadScene(name)])
          .then(([rt, scene]) => rt.mountScene(e.target, scene))
          .catch(() => undefined); // the scene stays on its static key frame
      }
    },
    { rootMargin: '100% 0px' },
  );
  scenes.forEach((s) => io.observe(s));
}

export function formatStat(n: number, prefix: string, suffix: string): string {
  return `${prefix}${n}${suffix}`;
}

/** Count the numbers band up (or down to 0) once in view. The final values are already in the HTML. */
export function bootCounters(doc: Document, matchMedia: (q: string) => MediaQueryList, IO: typeof IntersectionObserver | undefined) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !IO) return;
  const els = [...doc.querySelectorAll<HTMLElement>('[data-count]')];
  const io = new IO(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        const el = e.target as HTMLElement;
        const to = Number(el.dataset.count);
        const from = to === 0 ? 10 : 0;
        const [pre, suf] = [el.dataset.prefix ?? '', el.dataset.suffix ?? ''];
        const t0 = performance.now();
        const step = (t: number) => {
          const k = Math.min(1, (t - t0) / 1200);
          const eased = 1 - (1 - k) ** 3;
          el.textContent = formatStat(Math.round(from + (to - from) * eased), pre, suf);
          if (k < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }
    },
    { threshold: 0.6 },
  );
  els.forEach((el) => io.observe(el));
}

/** Magnetic CTAs: pills lean toward a nearby fine pointer (CSS `translate`, so the press `scale` still works). */
export function wireMagnetic(doc: Document, matchMedia: (q: string) => MediaQueryList): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(pointer: fine)').matches) return;
  const els = [...doc.querySelectorAll<HTMLElement>('.magnetic')];
  if (els.length === 0) return;
  doc.addEventListener(
    'pointermove',
    (e) => {
      for (const el of els) {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const near = Math.hypot(dx, dy) < Math.max(r.width, r.height);
        el.style.setProperty('--mx', near ? `${(dx * 0.18).toFixed(1)}px` : '0px');
        el.style.setProperty('--my', near ? `${(dy * 0.25).toFixed(1)}px` : '0px');
      }
    },
    { passive: true },
  );
}

/* ---------------- Sub-nav theme: dark frosted variant over dark tiles ---------------- */

const DARK_SURFACES = '.tile-dark, .tile-dark-2, .tile-dark-3, .tile-black';

/** Sets header[data-under] from the elements found under the sub-nav (topmost first; the header itself is skipped). */
export function subnavThemeAt(header: HTMLElement, elementsUnder: Element[]): void {
  const below = elementsUnder.find((el) => !header.contains(el));
  const dark = !!below?.closest(DARK_SURFACES);
  const next = dark ? 'dark' : 'light';
  if (header.dataset.under !== next) header.dataset.under = next;
}

/** Scroll-linked (rAF-throttled, passive): no layout change, so no CLS. Also active under reduced motion. */
export function wireSubnavTheme(doc: Document, win: Window): void {
  const header = doc.querySelector<HTMLElement>('.site-header');
  const sub = doc.querySelector<HTMLElement>('.sub-nav');
  if (!header || !sub || typeof doc.elementsFromPoint !== 'function') return;
  let queued = false;
  const check = () => {
    queued = false;
    const r = sub.getBoundingClientRect();
    subnavThemeAt(header, doc.elementsFromPoint(win.innerWidth / 2, r.top + r.height / 2));
  };
  const queue = () => {
    if (!queued) {
      queued = true;
      win.requestAnimationFrame(check);
    }
  };
  win.addEventListener('scroll', queue, { passive: true });
  win.addEventListener('resize', queue, { passive: true });
  check();
}

/**
 * "Only you can read it." comparison (landing-only-you-can-read D3): arm the table so its rows reveal one by one when
 * it scrolls into view. Without JS, under reduced motion or without IntersectionObserver, it is never armed: static.
 */
export function bootCompareReveal(doc: Document, matchMedia: (q: string) => MediaQueryList, IO: typeof IntersectionObserver | undefined): void {
  const table = doc.querySelector<HTMLElement>('#only-you table');
  if (!table || !IO || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // Arm only while the table is still BELOW the viewport and approaching (never hide text the reader can already see,
  // e.g. after a deep link), then reveal once 40% of it is visible.
  const arm = new IO(
    (entries) => {
      const e = entries.find((x) => x.isIntersecting);
      if (!e) return;
      arm.disconnect();
      const view = doc.defaultView;
      if (!view || e.boundingClientRect.top <= view.innerHeight) return; // already in view: stay static
      table.classList.add('armed');
      const reveal = new IO(
        (r) => {
          if (!r.some((x) => x.isIntersecting)) return;
          reveal.disconnect();
          table.classList.add('in');
        },
        { threshold: 0.4 },
      );
      reveal.observe(table);
    },
    { rootMargin: '0px 0px 75% 0px' },
  );
  arm.observe(table);
}

/* ---------------- "Buy me a coffee" sheen (add-donation D3) ---------------- */

type CoffeeModule = { sweep: (sheen: Element) => void };

/**
 * Motion sweeps a sheen across the coffee pill on hover or keyboard focus. The Motion code is a lazy chunk fetched on
 * first use, so the landing's initial JS barely grows. Off under reduced motion; the CSS steam is separate.
 */
export function wireCoffee(
  doc: Document,
  matchMedia: (q: string) => MediaQueryList,
  load: () => Promise<CoffeeModule> = () => import('./coffee'),
): void {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let mod: Promise<CoffeeModule> | undefined;
  for (const el of doc.querySelectorAll<HTMLElement>('[data-coffee]')) {
    const sheen = el.querySelector('.coffee-sheen');
    if (!sheen) continue;
    const go = () => {
      // Re-checked at every hover: a later switch to reduced motion stops the sheen too.
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      mod ??= load();
      mod.then((m) => m.sweep(sheen)).catch(() => undefined);
    };
    el.addEventListener('pointerenter', go);
    el.addEventListener('focus', go);
  }
}
