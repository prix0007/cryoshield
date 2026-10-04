/**
 * app-motion-ux guardrail (c): the landing bundle stays unchanged. The landing page (vanilla `motion`) and /app
 * (`motion/react`) share some motion-dom / motion-utils / framer-motion modules; left alone, the bundler hoists those
 * into shared chunks, which re-splits the landing's lazy runtime. This plugin gives /app its OWN instances of every
 * Motion module it reaches (an `?app-motion` suffix on the module id), so the landing graph is byte-for-byte what it
 * was and the two pages never share a Motion chunk. Build-only; the package and version are the same single pin.
 */
import type { Plugin } from 'vite';

const TAG = 'app-motion';
const MOTION = /[\\/]node_modules[\\/](?:\.pnpm[\\/][^\\/]+[\\/]node_modules[\\/])?(?:motion|motion-dom|motion-utils|framer-motion)[\\/]/;
const clean = (id: string) => id.replace(/\?.*$/, '');
const tagged = (id: string | undefined) => !!id && new RegExp(`[?&]${TAG}\\b`).test(id);

export function appMotionIsolation(appSrc: string): Plugin {
  return {
    name: 'cryoshield:app-motion-isolation',
    apply: 'build',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const fromApp = tagged(importer) || (clean(importer).startsWith(appSrc) && /^motion\/react/.test(source));
      if (!fromApp) return null;
      const r = await this.resolve(source, clean(importer), { ...options, skipSelf: true });
      if (!r || r.external || !MOTION.test(r.id) || tagged(r.id)) return null;
      return { ...r, id: `${r.id}${r.id.includes('?') ? '&' : '?'}${TAG}` };
    },
    async load(id) {
      if (!tagged(id)) return null;
      const { readFile } = await import('node:fs/promises');
      return readFile(clean(id), 'utf8');
    },
  };
}
