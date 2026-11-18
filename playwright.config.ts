import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;

/**
 * End-to-end tests against the playground, which runs the library from
 * source. Desktop engines cover pointer and keyboard editing; the mobile
 * projects cover touch and the narrow, single-column layout.
 *
 * Locally only the browsers you have installed will run:
 *   pnpm e2e --project=chromium
 * CI installs all three engines and runs every project.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
  },
  webServer: {
    command: `pnpm --dir examples/playground exec vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], viewport: { width: 1360, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1360, height: 900 } } },
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', use: { ...devices['iPhone 14'] } },
  ],
});
