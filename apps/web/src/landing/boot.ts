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
