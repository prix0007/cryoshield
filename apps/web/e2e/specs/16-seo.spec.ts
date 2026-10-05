/** improve-landing-seo 3.1 (spec landing-page "JSON-LD under the strict CSP", "Structured data and visible FAQ",
 *  "Crawl files", "The app is not indexed"): the JSON-LD data block causes no CSP or Trusted Types violation, the FAQ
 *  works by keyboard and passes axe, and the crawl files are served. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { LANDING } from '../fixtures/routes';

test('the landing JSON-LD loads with no CSP or Trusted Types violation and parses', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Trusted Type|Refused to/i.test(m.text())) violations.push(m.text());
  });
  // Listen before any document script runs, so a violation during parsing is caught too.
  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => (window as unknown as { __cspViolations: string[] }).__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  await page.goto(LANDING);
  await page.waitForLoadState('networkidle');
  const r = await page.evaluate(() => {
    const blocks = [...document.querySelectorAll('script[type="application/ld+json"]')];
    const parsed = JSON.parse(blocks[0]?.textContent ?? 'null') as { '@graph': { '@type': string }[] } | null;
    return {
      count: blocks.length,
      types: parsed?.['@graph'].map((n) => n['@type']),
      seen: (window as unknown as { __cspViolations: string[] }).__cspViolations,
    };
  });
  expect(r.count).toBe(1);
  expect(r.types).toEqual(['Organization', 'SoftwareApplication', 'FAQPage']);
  expect(r.seen).toEqual([]);
  expect(violations).toEqual([]);
});

test('the FAQ opens by keyboard and the FAQ section passes axe', async ({ page }) => {
  await page.goto(LANDING);
  const faq = page.locator('#faq');
  await expect(faq.getByRole('heading', { level: 2, name: 'Backup questions, answered.' })).toBeAttached();
  const item = faq.locator('details').filter({ has: page.getByText('How do I back up my seed phrase forever?', { exact: true }) });
  await item.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(item).toHaveAttribute('open', '');
  await expect(item.getByText('No backup lasts forever', { exact: false })).toBeVisible();
  const r = await new AxeBuilder({ page }).include('#faq').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('robots.txt and sitemap.xml are served; /app/ is noindex', async ({ page, request }) => {
  const robots = await request.get('/robots.txt');
  expect(robots.status()).toBe(200);
  expect(await robots.text()).toContain('Disallow: /app/');
  const sitemap = await request.get('/sitemap.xml');
  expect(sitemap.status()).toBe(200);
  expect(await sitemap.text()).toContain('<loc>https://cryoshield.app/</loc>');
  const og = await request.get('/og-image.png');
  expect(og.status()).toBe(200);
  await page.goto('/app/');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
});
