/** add-donation D3: the sheen sweep on the landing's coffee pill (Motion, lazy chunk; transforms and opacity only). */
import { animate } from 'motion/mini'; // WAAPI-only animate: a few KB instead of the full engine

export function sweep(sheen: Element): void {
  animate(
    sheen,
    { transform: ['translateX(-140%) skewX(-20deg)', 'translateX(480%) skewX(-20deg)'], opacity: [0, 0.16, 0] },
    { duration: 0.8, ease: 'easeOut' },
  );
}
