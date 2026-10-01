import { defineConfig } from 'vitest/config';
import base from './vitest.config';

/** Integration tests against the local chain stack (anvil + EntryPoint v0.6 + CBSW + VaultRegistry + dev bundler). */
export default defineConfig({
  ...base,
  test: {
    environment: 'node',
    include: ['test-int/**/*.int.test.ts'],
    globalSetup: ['test-int/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
