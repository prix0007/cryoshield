import { range, scramble } from './math';
import type { SceneModule } from './runtime';

/** The tap: plaintext lines (data-plain) scramble into ciphertext while the beam is on (textContent only). The HTML
 *  carries the final ciphertext, so the static key frame (no JS, reduced motion) shows the sealed state. */
const scene: SceneModule = {
  update(stage, p) {
    const k = range(p, 0.3, 0.7);
    stage.querySelectorAll<SVGTextElement>('.tp-text').forEach((t, i) => {
      const next = scramble(t.dataset.plain ?? '', Math.min(1, k * 1.15 - i * 0.03));
      if (t.textContent !== next) t.textContent = next;
    });
  },
};
export default scene;
