/**
 * add-compromised-key-guide: /lost-key renders docs/lost-or-compromised-key.md, passes axe in light and dark, makes
 * only same-origin requests with no CSP / Trusted Types errors, and is reachable from every footer, the landing FAQ and
 * an unlocked vault. Runs on the desktop and phone projects.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { APP } from '../fixtures/routes';
import { ArweaveStub } from '../fixtures/arweave';
import { VirtualKeys } from '../fixtures/webauthn';
import { createVault } from '../fixtures/app';

const TITLE = 'Lost or Compromised Security Key · CryoShield';
const H1 = 'If a key is lost or compromised';
const PAGES = ['/', '/app/', '/privacy', '/terms', '/cookies', '/architecture', '/devices', '/support', '/lost-key'];

async function axe(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`/lost-key renders the guide and passes axe (${scheme})`, async ({ page, baseURL }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const requests: string[] = [];
    const problems: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('console', (m) => {
      if (/Content Security Policy|Content-Security-Policy|Trusted Type/i.test(m.text())) problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto('/lost-key');
    await expect(page).toHaveTitle(TITLE);
    await expect(page.getByRole('heading', { level: 1, name: H1 })).toBeVisible();
    for (const h of ['What one key can do', 'Which situation are you in?', 'Steps when a key is compromised', 'What CryoShield can and can’t do']) {
      await expect(page.getByRole('heading', { level: 2, name: h, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 3, name: /^Step \d\./ })).toHaveCount(6);
    await expect(page.getByText(/Last reviewed:/)).toBeVisible();
    // No horizontal scroll at this project's width (desktop or phone).
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await axe(page, `/lost-key (${scheme})`);
    for (const u of requests) if (!u.startsWith('data:')) expect(new URL(u).origin, u).toBe(new URL(baseURL!).origin);
    expect(problems).toEqual([]);
  });
}

test('every page links "Lost or compromised key" in its footer, and the link opens /lost-key', async ({ page }) => {
  for (const p of PAGES) {
    await page.goto(p);
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Lost or compromised key', exact: true });
    await expect(link, p).toHaveCount(1);
    await expect(link, p).toHaveAttribute('href', '/lost-key');
  }
  await page.goto('/devices');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Lost or compromised key' }).click();
  await expect(page).toHaveURL(/\/lost-key$/);
  await expect(page.getByRole('heading', { level: 1, name: H1 })).toBeVisible();
});

test('the landing FAQ "What happens if I lose my YubiKey?" links /lost-key', async ({ page }) => {
  await page.goto('/');
  const faq = page.locator('#faq details').filter({ has: page.getByText('What happens if I lose my YubiKey?', { exact: true }) });
  await faq.locator('summary').click();
  await expect(faq.getByRole('link', { name: 'read what to do if a key is lost or compromised' })).toHaveAttribute('href', '/lost-key');
});

test('an unlocked vault links the guide under Manage vault, and the link opens it', async ({ page }) => {
  await new ArweaveStub().install(page);
  await page.goto(APP);
  const keys = await VirtualKeys.attach(page);
  await keys.add();
  await keys.add();
  await createVault(page, keys, [{ label: 'Bitcoin seed', secret: 'abandon ability able about' }]);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'Manage vault' })).toBeVisible();
  const link = page.getByRole('link', { name: 'Lost a key, or think someone has it?' });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '/lost-key');
  await link.click();
  await expect(page).toHaveURL(/\/lost-key$/);
  await expect(page.getByRole('heading', { level: 1, name: H1 })).toBeVisible();
});
