/**
 * Landing motion graphics (redesign-landing-and-app-ui D3). Lazily imported by boot.ts, never under reduced motion.
 * Uses only Motion's WAAPI `animate` (motion/mini) plus `inView` and `scroll`: no innerHTML, eval or WASM.
 *
 * Contract with landing.css: the static (no-JS / reduced-motion) look of every graphic is its FINAL state.
 * `.armed` puts a graphic into its initial state until `.in` is added; the animations below go initial -> final,
 * so when they finish the CSS final state takes over seamlessly.
 */
import { animate } from 'motion/mini';
import { inView, scroll } from 'motion';

type Step = [selector: string, keyframes: Record<string, (string | number)[]>, delay: number];

const EASE = [0.25, 0.1, 0.25, 1] as const;
const SEQUENCES: Record<string, Step[]> = {
  sealed: [
    ['.cipher-row:nth-of-type(2)', { opacity: [0, 1], transform: ['translateX(-16px)', 'none'] }, 0],
    ['.cipher-row:nth-of-type(3)', { opacity: [0, 1], transform: ['translateX(-16px)', 'none'] }, 0.12],
    ['.cipher-row:nth-of-type(4)', { opacity: [0, 1], transform: ['translateX(-16px)', 'none'] }, 0.24],
    ['.cipher-row:nth-of-type(5)', { opacity: [0, 1], transform: ['translateX(-16px)', 'none'] }, 0.36],
    ['.lock-shackle', { transform: ['translateY(-14px)', 'none'] }, 0.7],
  ],
  keys: [
    ['.key-lost', { opacity: [1, 0.3], transform: ['none', 'translateY(14px) rotate(-8deg)'] }, 0.2],
    ['.lost-mark', { opacity: [0, 1] }, 0.6],
    ['.key-ok', { transform: ['translateX(-24px)', 'none'] }, 0.9],
    ['.vault-shackle', { transform: ['none', 'translateY(-10px)'] }, 1.4],
    ['.check', { strokeDashoffset: [1, 0] }, 1.7],
  ],
  recover: [
    ['.offline-slash', { strokeDashoffset: [1, 0] }, 0],
    ['.term-line:nth-of-type(1)', { opacity: [0, 1] }, 0.4],
    ['.term-line:nth-of-type(2)', { opacity: [0, 1] }, 1.0],
    ['.term-line:nth-of-type(3)', { opacity: [0, 1] }, 1.6],
    ['.term-line:nth-of-type(4)', { opacity: [0, 1] }, 2.2],
  ],
  free: [
    ['.receipt', { opacity: [0, 1], transform: ['translateY(24px)', 'none'] }, 0],
    ['.receipt-zero', { opacity: [0, 1], transform: ['scale(0.6)', 'none'] }, 0.5],
  ],
};

function play(el: Element) {
  const steps = SEQUENCES[(el as HTMLElement).dataset.motion ?? ''] ?? [];
  for (const [sel, keyframes, delay] of steps) {
    el.querySelectorAll(sel).forEach((t) => {
      animate(t, keyframes, { duration: 0.6, delay, ease: EASE });
    });
  }
  el.classList.add('in');
}

/** "How it works": the connector fills and each step lights up as the section scrolls through the viewport. */
function howScroll(el: HTMLElement) {
  const section = el.closest('section') ?? el;
  const nodes = [...el.querySelectorAll('.how-node')];
  scroll(
    (p: number) => {
      const progress = Math.min(1, Math.max(0, (p - 0.15) / 0.45));
      el.style.setProperty('--how-p', progress.toFixed(3));
      nodes.forEach((n, i) => n.classList.toggle('is-on', progress >= i / 2 - 0.001));
    },
    { target: section, offset: ['start end', 'end start'] },
  );
}

export function start(doc: Document): void {
  const graphics = [...doc.querySelectorAll<HTMLElement>('[data-motion]')];
  try {
    graphics.forEach((g) => g.classList.add('armed'));
    for (const g of graphics) {
      if (g.dataset.motion === 'how') {
        howScroll(g);
        g.classList.add('in');
        continue;
      }
      inView(g, (target) => {
        play(target);
      }, { amount: 0.35 });
    }
  } catch {
    graphics.forEach((g) => g.classList.remove('armed', 'in'));
  }
}
