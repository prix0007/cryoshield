/**
 * footer-release-version: the landing and /app footers show the release line the served /release.json describes. On
 * `vite preview` that is the development shape (release null): "Version dev <commit>" linking to the commit, under the
 * real CSP, with no console errors.
 */
import { expect, test } from '@playwright/test';

test('landing and /app footers show "Version dev <commit>" from /release.json, with no console errors', async ({ page, request }) => {
  const r = await request.get('/release.json');
  expect(r.ok()).toBe(true);
  const { commit, release } = (await r.json()) as { commit: string; release: unknown };
  expect(commit).toMatch(/^[0-9a-f]{40}$/);
  expect(release).toBeNull();
  const errs: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || /Content Security Policy|Trusted Type|Refused/i.test(m.text())) errs.push(m.text());
  });
  page.on('pageerror', (e) => errs.push(String(e)));
  for (const p of ['/', '/app/']) {
    await page.goto(p);
    const line = page.getByRole('contentinfo').locator('.release');
    await expect(line, p).toHaveText(`Version dev ${commit.slice(0, 7)}`);
    await expect(line.getByRole('link'), p).toHaveAttribute('href', `https://github.com/prix0007/cryoshield/commit/${commit}`);
  }
  expect(errs).toEqual([]);
});
