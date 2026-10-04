/**
 * add-supported-devices-page: /devices renders docs/supported-devices.md, passes axe in light and dark, makes only
 * same-origin requests with no CSP / Trusted Types errors, and every page's footer links it.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { VirtualKeys } from '../fixtures/webauthn';
import { settled } from '../fixtures/motion';

const PAGES = ['/', '/app/', '/privacy', '/terms', '/cookies', '/architecture', '/devices'];

async function axe(page: Page, where: string) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`/devices renders the Markdown and passes axe (${scheme})`, async ({ page, baseURL }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const requests: string[] = [];
    const problems: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    page.on('console', (m) => {
      if (/Content Security Policy|Content-Security-Policy|Trusted Type/i.test(m.text())) problems.push(m.text());
    });
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto('/devices');
    await expect(page).toHaveTitle('Supported devices · CryoShield');
    await expect(page.getByRole('heading', { level: 1, name: 'Supported devices' })).toBeVisible();
    for (const h of ['Requirements a key must meet', 'Why phone and laptop passkeys are refused', 'Keys', 'Browsers', 'Recovery tool requirements', 'How to check your key', 'Report your device']) {
      await expect(page.getByRole('heading', { level: 2, name: h, exact: true })).toBeVisible();
    }
    await expect(page.getByText(/Last reviewed:/)).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(3);
    await expect(page.getByRole('link', { name: 'Open a device report' })).toHaveAttribute('href', 'https://github.com/prix0007/cryoshield/issues/new?template=device-report.yml');
    await axe(page, `/devices (${scheme})`);
    for (const u of requests) if (!u.startsWith('data:')) expect(new URL(u).origin, u).toBe(new URL(baseURL!).origin);
    expect(problems).toEqual([]);
  });
}

test('every page links "Supported devices" in its footer, and the link opens /devices', async ({ page }) => {
  for (const p of PAGES) {
    await page.goto(p);
    const link = page.getByRole('contentinfo').getByRole('link', { name: 'Supported devices', exact: true });
    await expect(link, p).toHaveCount(1);
    await expect(link, p).toHaveAttribute('href', '/devices');
  }
  await page.goto('/privacy');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Supported devices' }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Supported devices' })).toBeVisible();
});

test('the landing FAQ "What do I need?" links /devices', async ({ page }) => {
  await page.goto('/');
  const faq = page.locator('#faq details').filter({ has: page.getByText('What do I need?', { exact: true }) });
  await faq.locator('summary').click();
  await expect(faq.getByRole('link', { name: 'See supported devices' })).toHaveAttribute('href', '/devices');
});

test('a refused key in the app offers "See supported devices"', async ({ page }) => {
  await page.goto('/app/');
  const keys = await VirtualKeys.attach(page);
  await keys.add({ prf: false });
  await keys.use(0);
  await page.getByRole('button', { name: 'Create a new vault' }).click();
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByRole('button', { name: 'Set up key 1' }).click();
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Key not supported', { timeout: 15_000 });
  await expect(alert.getByRole('link', { name: 'See supported devices' })).toHaveAttribute('href', '/devices');
  await settled(page); // audit the settled screen, not the fading ceremony card
  await axe(page, 'app key error');
});
