/**
 * add-donation: the coffee link on every page (axe light/dark/reduced motion), the landing pill, the /support page
 * (address, QR, Open in wallet, Copy), only same-origin requests and no CSP/Trusted Types errors.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { settled } from '../fixtures/motion';

const ADDRESS = '0xfb4172e26AC8735C06656f1df14151cFe8441481';
const PAGES = ['/', '/app/', '/privacy', '/terms', '/cookies', '/architecture', '/devices', '/support'];

async function axe(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}
function watch(page: Page) {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Content-Security-Policy|Trusted Type/i.test(m.text())) problems.push(m.text());
  });
  page.on('pageerror', (e) => problems.push(e.message));
  return problems;
}

for (const [scheme, reducedMotion] of [['light', 'no-preference'], ['dark', 'no-preference'], ['light', 'reduce']] as const) {
  test(`every page links "Buy me a coffee" in its footer, and passes axe (${scheme}, motion ${reducedMotion})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion });
    const problems = watch(page);
    for (const p of PAGES) {
      await page.goto(p);
      const link = page.getByRole('contentinfo').getByRole('link', { name: 'Buy me a coffee' });
      await expect(link.first(), p).toHaveAttribute('href', '/support');
      if (p === '/app/') await settled(page);
      await axe(page, `${p} (${scheme}, ${reducedMotion})`);
    }
    expect(problems).toEqual([]);
  });
}

test('the landing pill: steam rises on hover with motion, and is static under reduced motion', async ({ page }) => {
  await page.goto('/');
  const pill = page.locator('a.coffee[data-coffee]');
  await expect(pill).toHaveAccessibleName('Buy me a coffee');
  await pill.scrollIntoViewIfNeeded();
  await pill.hover();
  await expect.poll(() => pill.locator('.coffee-steam i').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('coffee-steam');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.move(0, 0);
  await pill.hover();
  expect(await pill.locator('.coffee-steam i').first().evaluate((e) => getComputedStyle(e).animationName)).toBe('none');
  await pill.click();
  await expect(page).toHaveURL(/\/support$/);
});

test('/support shows the address, QR and wallet link, and Copy puts exactly the address on the clipboard', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const problems = watch(page);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/support');
  await expect(page.getByRole('heading', { level: 1, name: 'Buy me a coffee' })).toBeVisible();
  await expect(page.locator('#donation-address')).toHaveText(ADDRESS);
  await expect(page.getByRole('img', { name: 'QR code for the donation address on Ethereum mainnet' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open in wallet' })).toHaveAttribute('href', `ethereum:${ADDRESS}@1`);
  await expect(page.getByText('Send only ETH on Ethereum mainnet.')).toBeVisible();
  await page.getByRole('button', { name: 'Copy address' }).click();
  await expect(page.getByRole('status')).toHaveText('Address copied. Check it matches before you send.');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ADDRESS);
  // Never cleared: still there a moment later.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(ADDRESS);
  for (const u of requests) if (!u.startsWith('data:')) expect(new URL(u).origin, u).toBe(new URL(baseURL!).origin);
  expect(await page.evaluate(() => 'ethereum' in window)).toBe(false); // nothing injected or probed
  expect(problems).toEqual([]);
});
