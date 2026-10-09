import { defineConfig, devices } from '@playwright/test';

/**
 * E2E: production build (mode e2e) served by `vite preview` on http://localhost:4173 (RP ID "localhost"),
 * a CDP virtual authenticator with PRF, and the local chain stack from e2e/stack/stack.ts.
 * Arweave / Turbo are stubbed per test with page.route (e2e/fixtures/arweave.ts).
 */
/** add-mobile-e2e D2: the specs re-run on the phone project. */
const MOBILE_SPECS = /\/(05-landing|08-legal|10-flows|11-architecture|14-devices|15-support|16-seo|17-vaults|18-vault-layout|19-theme|21-mobile|30-a11y|40-errors)\.spec\.ts$/;

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
  projects: [
    { name: 'chromium', testIgnore: [/09-analytics/, /21-mobile/], use: { ...devices['Desktop Chrome'] } },
    // add-privacy-preserving-analytics 4.5: a build WITH the (stubbed, E2E-pinned) beacon, on its own port.
    { name: 'analytics', testMatch: /09-analytics/, use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4174' } },
    // add-mobile-e2e D1/D2: a touch phone on Chromium (the PRF virtual authenticator is CDP-only, so no WebKit
    // presets). Re-runs the feature specs whose layout or input differs on a phone; exclusions are in design.md D2.
    { name: 'mobile', testMatch: MOBILE_SPECS, use: { ...devices['Pixel 7'] } },
    { name: 'mobile-small', testMatch: /21-mobile/, use: { ...devices['Pixel 7'], viewport: { width: 360, height: 740 } } },
  ],
  webServer: [
    {
      command: 'pnpm build:e2e && pnpm exec vite preview --mode e2e',
      url: 'http://localhost:4173',
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite build --mode e2e-analytics --outDir dist-analytics --emptyOutDir && pnpm exec vite preview --mode e2e-analytics --outDir dist-analytics --port 4174',
      url: 'http://localhost:4174',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
