import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: production build (mode e2e) served by `vite preview` on http://localhost:4173 (RP ID "localhost"),
 * a CDP virtual authenticator with PRF, and the local chain stack from e2e/stack/stack.ts.
 * Arweave / Turbo are stubbed per test with page.route (e2e/fixtures/arweave.ts).
 */
export default defineConfig({
  testDir: 'e2e/specs',
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build:e2e && pnpm exec vite preview --mode e2e',
    url: 'http://localhost:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
