/**
 * add-theme-switch D1: ships src/theme/theme-init.js on every page as a classic, render-blocking, same-origin script at
 * the end of <head> (after the CSP meta), so the saved theme is applied before the first paint. In a build it is
 * minified and emitted as assets/theme-<sha256/8>.js (content-hashed: reproducible, and covered by the immutable
 * /assets/* cache rule); the dev server serves the source file. No inline code, so the CSP is unchanged.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { minifySync, type Plugin } from 'vite';

export const THEME_SOURCE = 'src/theme/theme-init.js';

/** Minified (oxc, deterministic) and named by the hash of the shipped bytes. */
export function themeAsset(source: string): { fileName: string; source: string } {
  const out = minifySync('theme-init.js', source, { compress: true, mangle: true });
  if (out.errors.length) throw new Error(`[theme] cannot minify ${THEME_SOURCE}: ${out.errors.map((e) => e.message).join('; ')}`);
  const code = out.code;
  return { fileName: `assets/theme-${createHash('sha256').update(code).digest('hex').slice(0, 8)}.js`, source: code };
}

export function injectThemeScript(html: string, src: string): string {
  if (!html.includes('</head>')) throw new Error('[theme] page has no </head>');
  if (/<script src="[^"]*theme[^"]*\.js"><\/script>/.test(html)) throw new Error('[theme] page already has the theme script');
  return html.replace(/\s*<\/head>/, `\n    <script src="${src}"></script>\n  </head>`);
}

export function themePlugin(root: string): Plugin {
  const read = () => readFileSync(join(root, THEME_SOURCE), 'utf8');
  let asset = themeAsset(read());
  return {
    name: 'cryoshield-theme',
    buildStart() {
      asset = themeAsset(read());
      this.addWatchFile(join(root, THEME_SOURCE));
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        return injectThemeScript(html, ctx.server ? `/${THEME_SOURCE}` : `/${asset.fileName}`);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: asset.fileName, source: asset.source });
    },
  };
}
