/** redesign-landing-and-app-ui 3.4 (spec landing-page): render, honesty, axe, keyboard, reduced motion, lazy motion,
 *  CSP on the landing page, and the route into the app. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LANDING } from '../fixtures/routes';


async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('renders the hero and the required disclosures; axe-clean at desktop and phone widths', async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.getByRole('heading', { level: 1, name: 'Seed phrase backups that outlive the drive.' })).toBeVisible();
  await expect(page.getByText(/stored on OP Sepolia \(a test network\).*has not been independently audited/)).toBeVisible();
  await expect(page.getByText('If you lose every key, nobody can open the vault', { exact: false })).toBeVisible();
  await axe(page, 'landing 1280');
  await page.setViewportSize({ width: 375, height: 740 });
  await axe(page, 'landing 375');
  // The narrow menu is keyboard-operable.
  await page.locator('details.nav-menu summary').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('details.nav-menu')).toHaveAttribute('open', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('details.nav-menu')).not.toHaveAttribute('open', '');
});

test('keyboard: Tab reaches "Open the app" and every footer link, each with a visible focus ring', async ({ page }) => {
  await page.goto(LANDING);
  const footerHrefs = await page.locator('footer a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const reached = new Set<string>();
  let sawOpen = false;
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      return { href: el.getAttribute('href'), text: el.textContent?.trim(), inFooter: !!el.closest('footer'), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
    });
    if (!f) continue;
    expect(f.outline, `no visible focus ring on ${f.text}`).toBe(true);
    if (f.text === 'Open the app' && f.href === '/app/') sawOpen = true;
    if (f.inFooter && f.href) reached.add(f.href);
  }
  expect(sawOpen).toBe(true);
  for (const h of footerHrefs) expect(reached.has(h!), `footer link ${h} not reachable by Tab`).toBe(true);
});

// Reduced motion, lazy loading and per-scene behaviour moved to 07-scenes.spec.ts (cinematic-landing).

test('the CSP blocks injected inline script and innerHTML on the landing page', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Trusted Type/i.test(m.text())) violations.push(m.text());
  });
  await page.goto(LANDING);
  const r = await page.evaluate(async () => {
    const seen: string[] = [];
    document.addEventListener('securitypolicyviolation', (e) => seen.push(e.violatedDirective));
    const s = document.createElement('script');
    try {
      s.textContent = 'window.__pwned = true';
    } catch {
      seen.push('tt:script');
    }
    document.body.appendChild(s);
    try {
      document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__pwned=true">');
    } catch {
      seen.push('tt:html');
    }
    await new Promise((res) => setTimeout(res, 100));
    return { pwned: (window as unknown as { __pwned?: boolean }).__pwned === true, seen };
  });
  expect(r.pwned).toBe(false);
  expect(r.seen.length + violations.length).toBeGreaterThan(0);
});

test('"Open the app" leads to the vault app at /app/', async ({ page }) => {
  await page.goto(LANDING);
  await page.getByRole('link', { name: 'Open the app' }).first().click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByRole('button', { name: 'Unlock my vault' })).toBeVisible();
});

test('reflows at 320px with no horizontal scroll (landing and app)', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const url of [LANDING, '/app/']) {
    await page.goto(url);
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw, url).toBeLessThanOrEqual(cw);
  }
});

test('"Only you can read it.": the comparison table renders, reveals row by row, and passes axe (landing-only-you-can-read 1.2)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(LANDING);
  const tile = page.locator('#only-you');
  await expect(tile.getByRole('heading', { level: 2, name: 'Only you can read it.' })).toBeVisible();
  const table = tile.getByRole('table', { name: 'How CryoShield compares with typical cloud storage' });
  await expect(table.getByRole('columnheader', { name: 'CryoShield' })).toBeAttached();
  await expect(table.getByRole('rowheader')).toHaveCount(4);
  await expect(table).not.toHaveClass(/armed/); // far below the fold on load: untouched (axe sees real contrast)
  // Approach from below: arm just before it enters the viewport, then reveal.
  await page.evaluate(() => {
    const t = document.querySelector('#only-you table')!;
    window.scrollTo({ top: t.getBoundingClientRect().top + scrollY - innerHeight * 1.5, behavior: 'instant' });
  });
  await expect(table).toHaveClass(/armed/);
  await table.scrollIntoViewIfNeeded();
  await expect(table).toHaveClass(/\bin\b/);
  await expect.poll(() => table.locator('tbody tr').last().evaluate((tr) => getComputedStyle(tr).opacity)).toBe('1');
  await expect(tile.getByText('Some password managers also encrypt end to end.', { exact: false })).toBeVisible();
  const r = await new AxeBuilder({ page }).include('#only-you').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('"Only you can read it." under reduced motion: static, every row visible, nothing animates', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(LANDING);
  const table = page.locator('#only-you table');
  await table.scrollIntoViewIfNeeded();
  await expect(table).not.toHaveClass(/armed/);
  for (const tr of await table.locator('tbody tr').all()) {
    await expect(tr).toBeVisible();
    expect(await tr.evaluate((e) => [getComputedStyle(e).opacity, getComputedStyle(e).transform])).toEqual(['1', 'none']);
  }
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  await ctx.close();
});

test('"Only you can read it." at 390 px: no horizontal overflow, axe clean', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(LANDING);
  await page.locator('#only-you table').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const box = await page.locator('#only-you table').boundingBox();
  expect(box!.width).toBeLessThanOrEqual(390);
  const r = await new AxeBuilder({ page }).include('#only-you').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});
