import { defineConfig, devices } from '@playwright/test';

const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.capture\.ts$/,
  outputDir: './.artifacts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  timeout: 180_000,
  use: {
    baseURL: process.env.MUNIN_CAPTURE_BASE_URL ?? 'http://127.0.0.1:3000',
    colorScheme: 'light',
    locale: 'en-US',
    timezoneId: 'UTC',
  },
  projects: [
    {
      name: 'widget',
      testMatch: /widget\.capture\.ts$/,
      use: {
        ...devices['Desktop Chrome'],
        viewport,
        deviceScaleFactor: 2,
        video: { mode: 'on', size: viewport },
      },
    },
    {
      name: 'dashboard',
      testMatch: /dashboard\.capture\.ts$/,
      use: { ...devices['Desktop Chrome'], viewport, deviceScaleFactor: 2 },
    },
  ],
});
