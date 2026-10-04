import '../ui/tokens.css';
import '../ui/chrome.css';
import './landing.css';
import { loadBeacon } from './analytics';
import { bootCompareReveal, bootCounters, bootLanding, bootScenes, wireCoffee, wireMagnetic, wireSubnavTheme } from './boot';

const matchMedia = (q: string) => window.matchMedia(q);
const IO = typeof IntersectionObserver === 'undefined' ? undefined : IntersectionObserver;
const SCENES: Record<string, () => Promise<object>> = {
  fragile: () => import('./scenes/fragile').then((m) => m.default),
  tap: () => import('./scenes/tap').then((m) => m.default),
  timeline: () => import('./scenes/timeline').then((m) => m.default),
};

// Nav menu wiring. Tile graphics are now scenes (below), so there is no data-motion graphic left to animate.
bootLanding({ doc: document, matchMedia, IO, load: async () => ({ start: () => undefined }) });
bootScenes({
  doc: document,
  matchMedia,
  IO,
  loadRuntime: () => import('./scenes/runtime'),
  // Scenes driven purely by CSS (chain, lose, survive) need no module of their own.
  loadScene: (name) => (SCENES[name] ?? (() => Promise.resolve({})))(),
});
bootCounters(document, matchMedia, IO);
bootCompareReveal(document, matchMedia, IO);
wireMagnetic(document, matchMedia);
wireCoffee(document, matchMedia);
wireSubnavTheme(document, window);
// Cloudflare Web Analytics (landing only): gated on GPC/DNT/host; inert unless the build shipped the beacon template.
loadBeacon(document, window);
