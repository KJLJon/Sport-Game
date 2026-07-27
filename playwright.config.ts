/**
 * @spec    001-initial-dev
 * @phase   0 — Foundation, PWA shell, update & offline lifecycle
 * @task    T-0.1 — Scaffold, T-0.15 — CI, T-0.16 — PWA lifecycle E2E suite
 * @story   US-1.2, US-1.4, US-1.8, US-1.9
 * @design  12-quality-and-testing.md §1, 11-pwa-lifecycle.md §9
 *
 * Purpose: E2E, visual-regression, and accessibility runs. Tests are served from a real static
 * build under the deployed base path, because base-path and service-worker scope bugs only
 * reproduce there.
 */
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env['E2E_PORT'] ?? 4173);
const BASE = process.env['E2E_BASE'] ?? '/Sport-Game/';

/**
 * A pre-provisioned Chromium, for environments where Playwright's own download is unavailable.
 * CI installs the matching browser and leaves this unset.
 */
const executablePath = process.env['PW_CHROMIUM_PATH'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  // Service-worker registrations and caches are per-origin, so tests must not race each other.
  fullyParallel: false,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  webServer: {
    command: 'pnpm exec tsx tools/e2e-server.ts',
    url: `http://localhost:${PORT}${BASE}version.json`,
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
    env: { E2E_PORT: String(PORT), E2E_BASE: BASE },
  },

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
