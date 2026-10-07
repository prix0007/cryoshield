/** add-architecture-page 1.2 (spec architecture-page): render, axe in light and dark, phone reflow, focusable figures. */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { keccak256, toHex } from 'viem';
import { registryList } from '../../vite-plugins/registries.mjs';
import { expect, test } from '@playwright/test';

for (const scheme of ['light', 'dark'] as const) {
  test(`/architecture renders and passes axe in ${scheme} mode`, async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ colorScheme: scheme, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/architecture');
    await expect(page.getByRole('heading', { level: 1, name: 'CryoShield system map' })).toBeVisible();
    await expect(page.getByRole('img')).toHaveCount(3);
    await expect(page.locator('.sub-nav-name')).toHaveText('System design');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe(scheme === 'dark' ? 'rgb(29, 29, 31)' : 'rgb(255, 255, 255)');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id} ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
    for (const u of requests) if (!u.startsWith('data:')) expect(new URL(u).origin).toBe(new URL(baseURL!).origin);
    await ctx.close();
  });
}

test('/architecture at 390 px: no page-level horizontal scroll; wide figures scroll in focusable containers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/architecture');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const scrollers = page.locator('.arch-scroll');
  await expect(scrollers).toHaveCount(3);
  for (const s of await scrollers.all()) {
    expect(await s.getAttribute('tabindex')).toBe('0');
    expect(await s.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  }
  await scrollers.first().focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scrollers.first().evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});

// Freshness in the browser: every reference value on /architecture equals the deployment record and the build config
// for this E2E chain, so a stale label, a missing row or an unreplaced placeholder fails CI (harden-gas-sponsorship 6.1).
test('/architecture reference table matches the deployment record', async ({ page }) => {
  const env = Object.fromEntries(
    readFileSync(new URL('../../.env.e2e', import.meta.url), 'utf8')
      .split('\n')
      .filter((l) => /^VITE_[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
  const contracts = new URL('../../../../contracts/', import.meta.url);
  const dep = JSON.parse(readFileSync(new URL(`deployments/${env.VITE_CHAIN_ID}.json`, contracts), 'utf8'));
  const wallet = dep.contracts.wallets[env.VITE_RP_ID!];
  // web-registry-versions D5: every registry in the record, newest first (the build's own parser).
  const hash = (f: string) => keccak256(toHex(new Uint8Array(readFileSync(new URL(`abi/${f}`, contracts)))));
  const regs = registryList(dep, 'record', { 1: hash('VaultRegistry.json'), 2: hash('VaultRegistryV2.json') });
  await page.goto('/architecture');
  const row = (label: string) => page.locator('section[aria-labelledby="s5"] tr').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) }).locator('td');
  const heads = page.locator('section[aria-labelledby="s5"] tr th').filter({ hasText: /^VaultRegistry v\d+$/ });
  await expect(heads).toHaveText(regs.map((r) => `VaultRegistry ${r.version}`));
  for (const [i, r] of regs.entries()) await expect(row(`VaultRegistry ${r.version}`)).toHaveText(i === 0 ? r.address : `${r.address} (read-only)`);
  await expect(row('Deploy block')).toHaveText(String(regs[0]!.deployBlock));
  await expect(row('Account factory')).toHaveText(wallet.factory);
  await expect(row('Account implementation')).toHaveText(wallet.implementation);
  await expect(row('WebAuthn RP ID')).toContainText(env.VITE_RP_ID!);
  await expect(row('Network')).toContainText(`chain ${env.VITE_CHAIN_ID}`);
  await expect(row('Vault limits')).toContainText('no per-locator cap');
  await expect(page.getByText('VaultRegistry v2', { exact: true }).first()).toBeVisible();
  expect(await page.content()).not.toMatch(/__CS_[A-Z_]+__/);
});
