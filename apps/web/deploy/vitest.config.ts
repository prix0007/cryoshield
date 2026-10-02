import { defineConfig } from 'vitest/config';

/** Hosting tests. The container test needs Docker; run with `pnpm test:deploy`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['deploy/test/**/*.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    fileParallelism: false,
  },
});
