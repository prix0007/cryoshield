import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'virtual:cryoshield-config', replacement: new URL('./test/fixtures/virtual-config.ts', import.meta.url).pathname },
      { find: /^@cryoshield\/vault-crypto\/testing$/, replacement: new URL('../../packages/vault-crypto/src/testing.ts', import.meta.url).pathname },
      { find: /^@cryoshield\/vault-crypto$/, replacement: new URL('../../packages/vault-crypto/src/index.ts', import.meta.url).pathname },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['test/setup.ts'],
  },
});
