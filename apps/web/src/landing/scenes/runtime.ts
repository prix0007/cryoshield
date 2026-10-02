/**
 * Scroll-scene runtime (cinematic-landing D1), lazy-loaded with the first scene. Native sticky stages; Motion's
 * scroll() reports the track's progress, written to the stage as --p via the CSSOM (CSP-safe). Only transforms and
 * opacity depend on --p in landing.css. Nothing intercepts wheel, touch or keyboard scrolling.
 */
import { scroll as motionScroll } from 'motion';

export interface SceneModule {
  init?: (stage: HTMLElement) => void;
  update?: (stage: HTMLElement, p: number) => void;
}
type ScrollFn = (cb: (p: number) => void, opts: { target: Element; offset: string[] }) => () => void;

export function mountScene(section: Element, scene: SceneModule, scroll: ScrollFn = motionScroll as unknown as ScrollFn): void {
  const track = section.querySelector('.scene-track');
  const stage = section.querySelector<HTMLElement>('.scene-stage');
  if (!track || !stage) return;
  scene.init?.(stage);
  stage.classList.add('live');
  // Pinned (sticky) stages scrub across their tall track; unpinned ones (phones, short screens) across their pass
  // through the viewport.
  const pinned = getComputedStyle(stage).position === 'sticky';
  scroll(
    (p) => {
      stage.style.setProperty('--p', p.toFixed(4));
      scene.update?.(stage, p);
    },
    { target: track, offset: pinned ? ['start start', 'end end'] : ['start end', 'end start'] },
  );
}

/** Slow parallax depth for [data-parallax] visuals while their section scrolls out. */
export function mountParallax(doc: Document, scroll: ScrollFn = motionScroll as unknown as ScrollFn): void {
  for (const el of doc.querySelectorAll<HTMLElement>('[data-parallax]')) {
    const host = el.closest('section') ?? el;
    scroll((p) => el.style.setProperty('--py', `${(p * 80).toFixed(1)}px`), { target: host, offset: ['start start', 'end start'] });
  }
}
