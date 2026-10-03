// @vitest-environment node
/** add-brand-icon 1.1 (spec brand-icon): files, sizes, opacity, safe adaptive SVG, manifest, reproducibility hashes. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const web = join(__dirname, '..', '..');
const pub = (f: string) => join(web, 'public', f);
const read = (f: string) => readFileSync(pub(f));

function pngSize(b: Buffer) {
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25]!, bitDepth: b[24]! };
}

/** Decodes an 8-bit RGBA/RGB PNG (no interlace) and reports whether every pixel is opaque. */
function fullyOpaque(b: Buffer): boolean {
  const { w, h, colorType, bitDepth } = pngSize(b);
  expect(bitDepth).toBe(8);
  if (colorType === 2) return true; // RGB: no alpha channel
  expect(colorType).toBe(6);
  const chunks: Buffer[] = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    const type = b.subarray(o + 4, o + 8).toString('latin1');
    if (type === 'IDAT') chunks.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const bpp = 4;
  const stride = w * bpp;
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp]! : 0;
      const up = prev[x]!;
      const c = x >= bpp ? prev[x - bpp]! : 0;
      const p = a + up - c;
      const pr = Math.abs(p - a) <= Math.abs(p - up) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - up) <= Math.abs(p - c) ? up : c;
      const pred = [0, a, up, (a + up) >> 1, pr][f]!;
      cur[x] = (line[x]! + pred) & 0xff;
    }
    for (let x = 3; x < stride; x += 4) if (cur[x] !== 255) return false;
    cur.copy(prev);
  }
  return true;
}

describe('icon files (add-brand-icon)', () => {
  it.each([
    ['apple-touch-icon.png', 180],
    ['icon-192.png', 192],
    ['icon-512.png', 512],
    ['icon-maskable-512.png', 512],
  ])('%s is %ipx square', (f, n) => {
    expect(existsSync(pub(f)), f).toBe(true);
    const s = pngSize(read(f));
    expect([s.w, s.h]).toEqual([n, n]);
  });

  it('favicon.ico holds 16, 32 and 48 px PNG images', () => {
    const b = read('favicon.ico');
    expect(b.readUInt16LE(0)).toBe(0);
    expect(b.readUInt16LE(2)).toBe(1);
    const n = b.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < n; i++) {
      const e = 6 + i * 16;
      const w = b[e] || 256;
      const size = b.readUInt32LE(e + 8);
      const off = b.readUInt32LE(e + 12);
      const img = b.subarray(off, off + size);
      expect(pngSize(img).w).toBe(w);
      sizes.push(w);
    }
    expect(sizes.sort((a, c) => a - c)).toEqual([16, 32, 48]);
  });

  it('the apple-touch icon and the app tiles are opaque', () => {
    for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) expect(fullyOpaque(read(f)), f).toBe(true);
  });

  it('favicon.svg adapts to dark mode and is safe (no script, handlers, foreignObject or external references)', () => {
    const svg = read('favicon.svg').toString('utf8');
    expect(svg).toMatch(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    expect(svg).not.toMatch(/<script|\son[a-z]+\s*=|foreignObject|href\s*=|url\(|@import|<!ENTITY|<!DOCTYPE/i);
    for (const f of ['tile.svg', 'maskable.svg', 'favicon.svg']) {
      const src = readFileSync(join(web, 'brand', f), 'utf8');
      expect(src, f).not.toMatch(/<script|\son[a-z]+\s*=|foreignObject|href\s*=|url\(|@import|gradient/i);
    }
  });

  it('site.webmanifest: names, start_url /app/, colours from the tokens, icons that exist', () => {
    const m = JSON.parse(read('site.webmanifest').toString('utf8'));
    const tokens = readFileSync(join(web, 'src', 'ui', 'tokens.css'), 'utf8');
    const token = (name: string) => tokens.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, 'i'))![1]!.toLowerCase();
    expect(m.name).toBe('CryoShield');
    expect(m.short_name).toBe('CryoShield');
    expect(m.start_url).toBe('/app/');
    expect(m.theme_color.toLowerCase()).toBe(token('--surface-black'));
    expect(m.background_color.toLowerCase()).toBe(token('--canvas-parchment'));
    const srcs = m.icons.map((i: { src: string; sizes: string; purpose?: string }) => `${i.src} ${i.sizes} ${i.purpose ?? 'any'}`);
    expect(srcs).toEqual(expect.arrayContaining(['/icon-192.png 192x192 any', '/icon-512.png 512x512 any', '/icon-maskable-512.png 512x512 maskable']));
    for (const i of m.icons) expect(existsSync(pub(i.src.slice(1))), i.src).toBe(true);
  });

  it('every generated binary matches its recorded SHA-256 (reproducible from the SVG sources)', () => {
    const lines = readFileSync(join(web, 'brand', 'icons.sha256'), 'utf8').trim().split('\n');
    const recorded = Object.fromEntries(lines.map((l) => l.split(/\s+/).reverse()));
    for (const f of ['favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
      expect(createHash('sha256').update(read(f)).digest('hex'), f).toBe(recorded[f]);
    }
  });
});
