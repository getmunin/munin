import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.MUNIN_E2E_PORT ?? 3000);
const BASE_URL = process.env.MUNIN_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: process.env.MUNIN_E2E_BASE_URL
    ? undefined
    : {
        // Run Next directly rather than `pnpm dev`: the dev script waits for the
        // backend on tcp:3001, which the web-only e2e job never starts.
        command: `pnpm exec next dev --port ${PORT}`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
