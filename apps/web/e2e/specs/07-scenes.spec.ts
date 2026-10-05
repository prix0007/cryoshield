/** cinematic-landing 4.1 (spec landing-page "Pinned scroll scenes", "Motion respects reduced motion", accessibility). */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LANDING } from '../fixtures/routes';

const isSceneCode = (url: string) => /\/assets\/(runtime|fragile|tap|timeline|years|math)-[^/]+\.js$/.test(url);
const SCENES: [id: string, selector: string, prop: 'transform' | 'opacity' | 'stroke-dashoffset'][] = [
  ['fragile', '.fr-crack', 'stroke-dashoffset'],
  ['how', '.tp-beam', 'transform'],
  ['stored', '.ch-blob', 'transform'],
  ['lose-a-key', '.ls-key2', 'transform'],
  ['survives', '.sv-term', 'opacity'],
  ['timeline', '.tl-ruler', 'transform'],
];

/** Scroll so that `f` (0..1) of the scene's pinned track has passed. */
async function scrollScene(page: Page, id: string, f: number) {
  await page.evaluate(
    ([id, f]) => {
      const s = document.getElementById(id as string)!;
      const track = s.querySelector<HTMLElement>('.scene-track')!;
      // Motion's offset ['start start', 'end end'] over the track: progress 0 at track top = viewport top.
      const top = track.getBoundingClientRect().top + scrollY;
      window.scrollTo({ top: top + (track.offsetHeight - innerHeight) * (f as number), behavior: 'instant' });
    },
    [id, f] as const,
  );
  // fix-floating-bar-focus audit: no fixed sleep. Wait until the scene's scroll-driven progress (--p, written on an
  // animation frame by Motion's scroll()) has caught up with this position, then measure.
  await page.waitForFunction(
    ([id, f]) => {
      const stage = document.querySelector<HTMLElement>(`#${id} .scene-stage`);
      if (!stage?.classList.contains('live')) return false;
      const p = Number(stage.style.getPropertyValue('--p'));
      return Number.isFinite(p) && Math.abs(p - (f as number)) < 0.05;
    },
    [id, f] as const,
  );
}

function watchErrors(page: Page) {
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy|Trusted Type|Refused/i.test(m.text())) errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  return errs;
}

test('each scene is pinned and scrubbed by scroll: progress and visuals change, the heading stays visible', async ({ page }) => {
  const errs = watchErrors(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(LANDING);
  for (const [id, sel, prop] of SCENES) {
    const stage = page.locator(`#${id} .scene-stage`);
    await scrollScene(page, id, 0.1);
    await expect(stage).toHaveClass(/live/);
    expect(await stage.evaluate((e) => getComputedStyle(e).position)).toBe('sticky');
    const p1 = Number(await stage.evaluate((e) => e.style.getPropertyValue('--p')));
    const v1 = await page.locator(`#${id} ${sel}`).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
    await expect(page.locator(`#${id} h2`)).toBeInViewport();
    await scrollScene(page, id, 0.9);
    const p2 = Number(await stage.evaluate((e) => e.style.getPropertyValue('--p')));
    const v2 = await page.locator(`#${id} ${sel}`).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
    await expect(page.locator(`#${id} h2`)).toBeInViewport();
    expect(p1, id).toBeLessThan(0.3);
    expect(p2, id).toBeGreaterThan(0.7);
    expect(v2, `${id} ${sel} ${prop}`).not.toBe(v1);
  }
  // Text-driven effects: the year counters and the ciphertext.
  await scrollScene(page, 'fragile', 0.05);
  const early = await page.locator('#fragile .year').textContent();
  await scrollScene(page, 'fragile', 1);
  expect(Number(early)).toBeLessThan(2030);
  await expect(page.locator('#fragile .year')).toHaveText('2036');
  await scrollScene(page, 'how', 0.05);
  await expect(page.locator('#how .tp-text').first()).toHaveText('abandon able');
  await scrollScene(page, 'how', 1);
  for (const t of await page.locator('#how .tp-text').all()) await expect(t).toHaveText(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
  expect(errs).toEqual([]);
});

test('scene code is lazy and per scene', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(LANDING);
  await page.waitForTimeout(400);
  expect(requested.filter((u) => /\/assets\/(tap|timeline)-/.test(u))).toEqual([]);
  await page.locator('#how').scrollIntoViewIfNeeded();
  await expect.poll(() => requested.filter((u) => /\/assets\/tap-/.test(u)).length).toBe(1);
});

test('reduced motion: no scene code, nothing pinned, every key frame and all text visible', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto(LANDING);
  for (let y = 0; y < 30; y++) await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  expect(requested.filter(isSceneCode)).toEqual([]);
  for (const [id] of SCENES) {
    expect(await page.locator(`#${id} .scene-stage`).evaluate((e) => getComputedStyle(e).position), id).toBe('static');
    await page.locator(`#${id} h2`).scrollIntoViewIfNeeded();
    await expect(page.locator(`#${id} .scene-lead`)).toBeVisible();
  }
  await expect(page.locator('#lose-a-key .ls-check')).toBeVisible();
  await expect(page.locator('#survives .sv-l4')).toBeVisible();
  await expect(page.locator('#timeline .year')).toHaveText('2126');
  await expect(page.locator('#numbers [data-count]').first()).toHaveText('1');
  const anim = await page.evaluate(() => document.getAnimations().length);
  expect(anim).toBe(0);
  await ctx.close();
});

test('keyboard paging reaches the footer (no scroll trap), focus is never hidden under a pinned stage', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(LANDING);
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press('PageDown');
    if (await page.locator('footer .legal').isVisible() && (await page.evaluate(() => innerHeight + scrollY >= document.body.scrollHeight - 2))) break;
  }
  expect(await page.evaluate(() => innerHeight + scrollY >= document.body.scrollHeight - 2)).toBe(true);
  // Tab to a CTA inside a pinned scene: it must be visible, not covered by the sticky header.
  await page.goto(LANDING);
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    const inScene = await page.evaluate(() => !!document.activeElement?.closest('.scene'));
    if (!inScene) continue;
    // Focus scrolling is smooth (scroll-behavior), so wait for it to settle before measuring.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const r = document.activeElement!.getBoundingClientRect();
            const h = document.querySelector('.site-header')!.getBoundingClientRect();
            return r.top >= h.bottom && r.bottom <= innerHeight;
          }),
        { timeout: 3000 },
      )
      .toBe(true);
  }
});

test('phone: touch scrolling reaches the footer; scenes are unpinned and simplified; axe clean', async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto(LANDING);
  expect(await page.locator('#how .scene-stage').evaluate((e) => getComputedStyle(e).position)).toBe('static');
  for (let i = 0; i < 60; i++) {
    await page.mouse.wheel(0, 900); // Playwright has no touch-scroll primitive; native scrolling is what is tested.
    if (await page.evaluate(() => innerHeight + scrollY >= document.body.scrollHeight - 2)) break;
  }
  expect(await page.evaluate(() => innerHeight + scrollY >= document.body.scrollHeight - 2)).toBe(true);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
  await ctx.close();
});

test('desktop axe with every scene live (mid-progress)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(LANDING);
  for (const [id] of SCENES) {
    await scrollScene(page, id, 0.5);
    const r = await new AxeBuilder({ page }).include(`#${id}`).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${id}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
});

for (const width of [1280, 390]) {
  test(`timeline end labels stay fully inside the graphic at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(LANDING);
    for (const f of [0, 0.5, 1]) {
      await page.evaluate((f) => {
        const t = document.querySelector<HTMLElement>('#timeline .scene-track')!;
        window.scrollTo({ top: t.getBoundingClientRect().top + scrollY + Math.max(0, t.offsetHeight - innerHeight) * f, behavior: 'instant' });
      }, f);
      // fix-floating-bar-focus audit: no fixed sleep. The scene is driven by scroll() on animation frames, so poll the
      // real geometry until it holds (it must, once the frame for this scroll position has run).
      await expect
        .poll(() =>
          page.evaluate(() => {
            const svg = document.querySelector('#timeline svg')!.getBoundingClientRect();
            return [...document.querySelectorAll('#timeline .tl-end')].map((el) => {
              const b = el.getBoundingClientRect();
              return { text: el.textContent, inside: b.left >= svg.left - 0.5 && b.right <= svg.right + 0.5 && b.top >= svg.top - 0.5 && b.bottom <= svg.bottom + 0.5 };
            });
          }),
        )
        .toEqual([{ text: '2026', inside: true }, { text: '2126', inside: true }]);
    }
  });
}

test('the sub-nav turns dark frosted over dark tiles and back to light', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(LANDING);
  const header = page.locator('.site-header');
  await expect(header).toHaveAttribute('data-under', 'light');
  await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('#fragile .scene-track')!;
    window.scrollTo({ top: t.getBoundingClientRect().top + scrollY + 300, behavior: 'instant' });
  });
  await expect(header).toHaveAttribute('data-under', 'dark');
  await expect // colours transition for 250 ms
    .poll(() => page.locator('.sub-nav').evaluate((e) => [getComputedStyle(e).backgroundColor, getComputedStyle(e).color]))
    .toEqual(['rgba(39, 39, 41, 0.72)', 'rgb(255, 255, 255)']);
  await page.evaluate(() => {
    const t = document.querySelector<HTMLElement>('#how .scene-track')!;
    window.scrollTo({ top: t.getBoundingClientRect().top + scrollY + 200, behavior: 'instant' });
  });
  await expect(header).toHaveAttribute('data-under', 'light');
});
