#!/usr/bin/env node
/**
 * add-brand-icon D2: rasterise the committed SVG sources (apps/web/brand/) into the PNG/ICO icon set in public/,
 * using the Chromium already pinned by @playwright/test (no new dependency, no install script, no network).
 * Writes brand/icons.sha256; test/build/icons.test.ts re-hashes the committed files.
 *   pnpm --filter @cryoshield/web icons
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const web = new URL('..', import.meta.url).pathname;
const src = (f) => readFileSync(join(web, 'brand', f), 'utf8');
const out = (f, b) => writeFileSync(join(web, 'public', f), b);

const browser = await chromium.launch();
async function render(svg, size, { opaque }) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // A data: document holding only the SVG, sized to the target (no network, no scripts).
  const sized = svg.replace(/width="\d+" height="\d+"/, `width="${size}" height="${size}"`);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`);
  const png = await page.screenshot({ type: 'png', omitBackground: !opaque, clip: { x: 0, y: 0, width: size, height: size } });
  await page.close();
  return png;
}

/** ICO with PNG-compressed entries (Vista+): 6-byte header, 16-byte directory entries, then the PNGs. */
function ico(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const dir = pngs.map(({ size, png }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    return e;
  });
  return Buffer.concat([header, ...dir, ...pngs.map((p) => p.png)]);
}

const files = {};
const favicon = src('favicon.svg');
files['favicon.ico'] = ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, png: await render(favicon, size, { opaque: false }) }))));
files['apple-touch-icon.png'] = await render(src('tile.svg'), 180, { opaque: true });
files['icon-192.png'] = await render(src('tile.svg'), 192, { opaque: true });
files['icon-512.png'] = await render(src('tile.svg'), 512, { opaque: true });
files['icon-maskable-512.png'] = await render(src('maskable.svg'), 512, { opaque: true });
await browser.close();

writeFileSync(join(web, 'public', 'favicon.svg'), favicon);
const sums = [];
for (const [f, b] of Object.entries(files)) {
  out(f, b);
  sums.push(`${createHash('sha256').update(b).digest('hex')}  ${f}`);
}
writeFileSync(join(web, 'brand', 'icons.sha256'), sums.join('\n') + '\n');
console.log(sums.join('\n'));
