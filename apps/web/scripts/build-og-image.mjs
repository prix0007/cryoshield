#!/usr/bin/env node
/**
 * improve-landing-seo D8: rasterise the committed share card (brand/og-image.svg, 1200x630) into public/og-image.png,
 * using the Chromium already pinned by @playwright/test and the self-hosted Inter (embedded as a data: URL, so no
 * system font and no network). Writes brand/og-image.sha256; test/build/seo.test.ts re-hashes the committed PNG.
 *   pnpm --filter @cryoshield/web og-image
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const web = new URL('..', import.meta.url).pathname;
const svg = readFileSync(join(web, 'brand', 'og-image.svg'), 'utf8');
const font = readFileSync(join(web, 'src', 'ui', 'fonts', 'inter-latin-wght-normal.woff2')).toString('base64');
const W = 1200;
const H = 630;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.route('**/*', (r) => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
await page.setContent(`<!doctype html><html><head><style>
  @font-face { font-family: 'Inter'; font-weight: 300 700; src: url(data:font/woff2;base64,${font}) format('woff2'); }
  html, body { margin: 0; background: #ffffff; }
  svg { display: block; font-feature-settings: 'ss03'; }
</style></head><body>${svg}</body></html>`);
await page.evaluate(async () => {
  await document.fonts.load("600 80px 'Inter'");
  await document.fonts.load("400 29px 'Inter'");
  await document.fonts.ready;
});
const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: W, height: H } });
await browser.close();

writeFileSync(join(web, 'public', 'og-image.png'), png);
const sum = `${createHash('sha256').update(png).digest('hex')}  og-image.png`;
writeFileSync(join(web, 'brand', 'og-image.sha256'), `${sum}\n`);
console.log(sum);
