import { defineConfig, devices } from '@playwright/test';

// Thin E2E smoke (style-guides/automated-testing.md §10). Runs nightly / on-demand, NOT on
// the per-PR gate. Selects by role / accessible name — never Tailwind classes or generated IDs.
const PORT = 4200;
const baseURL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Serve the app for the test run. Locally this reuses an already-running `ng serve`.
  webServer: {
    command: 'npm start',
    url: baseURL,
    reuseExistingServer: !process.env['CI'],
    timeout: 180_000,
  },
});
