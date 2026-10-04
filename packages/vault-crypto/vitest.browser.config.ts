import { playwright } from '@vitest/browser-playwright';
import { defineConfig, mergeConfig } from 'vitest/config';
import base from './vitest.config.js';

// Task 8.1: the same suite (vectors, unit, property) in headless Chromium.
export default mergeConfig(
  base,
  defineConfig({
    // Keep the Shamir package unbundled so vi.mock can substitute its
    // `shamir-secret-sharing/csprng` module with the vectors' replay stream.
    optimizeDeps: { exclude: ['shamir-secret-sharing'] },
    test: {
      // Node-only tests (they read source files with node:fs) run in the Node suite only.
      exclude: ['test/**/*.node.test.ts', 'node_modules/**'],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: 'chromium' }],
      },
    },
  }),
);
