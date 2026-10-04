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
