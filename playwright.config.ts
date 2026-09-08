import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end configuration.
 *
 * The app is a Tauri shell around a Vue SPA. These tests drive the SPA in a
 * plain browser, which covers routing, rendering and page structure, but not
 * anything behind a Tauri command - those only exist inside the shell.
 *
 * Chromium only: the shipped app runs on a single WebView2 engine, so testing
 * three browsers would say nothing about what users actually run while tripling
 * the browser download on CI.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['list'], ['junit', { outputFile: 'tests/results/junit.xml' }]]
    : [['html', { outputFolder: 'tests/results/html', open: 'never' }], ['list']],

  use: {
    // Tests navigate with hash routes relative to this, e.g. `#/entries`.
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Starts Vite automatically so the suite is one command everywhere.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
