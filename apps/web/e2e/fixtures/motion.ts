import { expect, type Page } from '@playwright/test';

/**
 * app-motion-ux: wait until the app is visually settled: no step is leaving (inert) and nothing the user reads in
 * #main is mid-fade or mid-slide. Audits (axe contrast) and end-state checks run on settled screens, not on a frame
 * of a 0.2 s transition. Decorative aria-hidden parts (the waiting pulse) are ignored.
 */
export async function settled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (document.querySelector('#main [inert]')) return false;
        const rest = ['none', 'matrix(1, 0, 0, 1, 0, 0)'];
        return [...document.querySelectorAll<HTMLElement>('#main *')]
          .filter((e) => !e.closest('[aria-hidden="true"]'))
          .every((e) => {
            const cs = getComputedStyle(e);
            return cs.opacity === '1' && (!e.classList.contains('step-motion') || rest.includes(cs.transform));
          });
      }),
    )
    .toBe(true);
}

/** Every Web Animation (CSS and Motion WAAPI) has finished or is idle. */
export async function animationsDone(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' && !a.pending));
}

/**
 * Layout has stopped moving: the document height, scroll position and the focused element's rect are identical across
 * several consecutive animation frames (catches JS-driven tweens that getAnimations() can't see).
 */
export async function layoutStable(page: Page, frames = 4) {
  await page.waitForFunction(
    (n) =>
      new Promise<boolean>((resolve) => {
        const snap = () => {
          const r = (document.activeElement ?? document.body).getBoundingClientRect();
          return `${document.documentElement.scrollHeight}|${scrollY}|${r.top}|${r.bottom}`;
        };
        let last = snap();
        let same = 0;
        const tick = () => {
          const now = snap();
          same = now === last ? same + 1 : 0;
          last = now;
          if (same >= n) resolve(true);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    frames,
  );
}
