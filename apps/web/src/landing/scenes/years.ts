import { yearAt } from './math';
import type { SceneModule } from './runtime';

/** Scenes with a year counter (fragile 2026 -> 2036, timeline 2026 -> 2126). textContent only. */
export const yearScene: SceneModule = {
  update(stage, p) {
    const el = stage.querySelector<HTMLElement>('.year');
    if (!el) return;
    const next = String(yearAt(p, Number(el.dataset.from), Number(el.dataset.to)));
    if (el.textContent !== next) el.textContent = next;
  },
};
