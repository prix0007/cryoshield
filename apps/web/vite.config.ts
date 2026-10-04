import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { cryoshield, defaultContractsDir } from './vite-plugins/cryoshield.ts';
import { legalPagesPlugin } from './vite-plugins/legal-plugin.ts';
import { appMotionIsolation } from './vite-plugins/app-motion-isolation.ts';

export default defineConfig(({ mode }) => {
  const root = import.meta.dirname;
  const env = { ...loadEnv(mode, root, 'VITE_'), ...pick(process.env) };
  return {
    // Multi-page: unknown paths are 404 (no SPA fallback), as in production.
    appType: 'mpa',
    plugins: [appMotionIsolation(`${root}/src/ui/`), react(), legalPagesPlugin(root), cryoshield(env, process.env.CRYOSHIELD_CONTRACTS_DIR ?? defaultContractsDir(root), mode, root)],
    // Always build against the vault-crypto source (never a stale dist/).
    resolve: { alias: [{ find: /^@cryoshield\/vault-crypto$/, replacement: `${root}/../../packages/vault-crypto/src/index.ts` }] },
    build: {
      sourcemap: false,
      modulePreload: { polyfill: false },
      assetsInlineLimit: 0,
      target: 'es2022',
      // Strip every console call from the shipped bundle (our code is also lint-banned from using console).
      rolldownOptions: {
        // Two pages (redesign-landing-and-app-ui D1): the landing page at / and the vault app at /app/.
        input: {
          landing: `${root}/index.html`,
          app: `${root}/app/index.html`,
          privacy: `${root}/privacy/index.html`,
          terms: `${root}/terms/index.html`,
          cookies: `${root}/cookies/index.html`,
          architecture: `${root}/architecture/index.html`,
          devices: `${root}/devices/index.html`,
        },
        output: { minify: { compress: { dropConsole: true } } },
      },
    },
    server: { host: 'localhost', port: 5173, strictPort: true },
    preview: { host: 'localhost', port: 4173, strictPort: true },
  };
});

function pick(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith('VITE_') && v !== undefined)) as Record<string, string>;
}
