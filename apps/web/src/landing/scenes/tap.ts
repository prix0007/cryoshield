import { range, resolveCipher } from './math';
import type { SceneModule } from './runtime';

/** The tap: each line resolves from plaintext (data-plain) to ciphertext (data-cipher) character by character while the
 *  beam is on (textContent only). The HTML carries the final ciphertext: the static key frame shows the sealed state. */
const scene: SceneModule = {
  update(stage, p) {
    const k = range(p, 0.22, 0.48); // beam reaches the card at ~0.32; sealed by ~0.5
    stage.querySelectorAll<SVGTextElement>('.tp-text').forEach((t, i) => {
      const next = resolveCipher(t.dataset.plain ?? '', t.dataset.cipher ?? '', Math.min(1, k * 1.15 - i * 0.03));
      if (t.textContent !== next) t.textContent = next;
    });
  },
};
export default scene;
