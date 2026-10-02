/** redesign-landing-and-app-ui 3.4 (spec landing-page): render, honesty, axe, keyboard, reduced motion, lazy motion,
 *  CSP on the landing page, and the route into the app. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { LANDING } from '../fixtures/routes';

const isMotionChunk = (url: string) => /\/assets\/motion-[^/]+\.js$/.test(url);

async function axe(page: Page, label: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${label}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

test('renders the hero and the required disclosures; axe-clean at desktop and phone widths', async ({ page }) => {
  await page.goto(LANDING);
  await expect(page.getByRole('heading', { level: 1, name: 'Backups that outlive the drive.' })).toBeVisible();
  await expect(page.getByText('runs on OP Sepolia, a test network, and has not been independently audited', { exact: false })).toBeVisible();
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

test('reduced motion: the motion chunk is never requested and graphics show their final state', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.goto(LANDING);
  for (let y = 0; y < 10; y++) await page.mouse.wheel(0, 800);
  await page.waitForTimeout(500);
  expect(requested.filter(isMotionChunk)).toEqual([]);
  expect(await page.locator('.armed').count()).toBe(0);
  await expect(page.locator('.g-keys .check')).toBeVisible();
  await expect(page.locator('.g-recover .term-ok')).toBeVisible();
  await ctx.close();
});

test('motion is lazy: requested only after scrolling towards a story graphic', async ({ page }) => {
  const requested: string[] = [];
  page.on('request', (r) => requested.push(r.url()));
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto(LANDING);
  await page.waitForTimeout(500);
  expect(requested.filter(isMotionChunk)).toEqual([]);
  await page.locator('#how').scrollIntoViewIfNeeded();
  await expect.poll(() => requested.filter(isMotionChunk).length).toBe(1);
  await expect(page.locator('.g-how.armed')).toHaveCount(1);
});

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
