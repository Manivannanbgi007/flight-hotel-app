import { defineConfig, devices } from '@playwright/test';

import { BASE_URL } from './e2e/support/env';

/**
 * Browser end-to-end tests (npm run test:e2e) against a running stack: by default the Docker Compose frontend on
 * http://localhost:3000; E2E_BASE_URL points elsewhere (e.g. http://localhost:5173 for `npm run dev`).
 * One worker: the journeys share the gateway's rate limits and the demo inventory.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // A whole journey waits for several Kafka saga steps (hold, confirm, cancel, refund).
  timeout: 4 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    acceptDownloads: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } } }],
});
