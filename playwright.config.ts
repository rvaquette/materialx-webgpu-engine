import { defineConfig, devices } from '@playwright/test';

const preview = process.env['PLAYWRIGHT_PREVIEW'] === '1';
const baseURL = preview ? 'http://localhost:4173' : 'http://localhost:5173';

// `chromium` runs the end-to-end tests quickly; `demo` opens a visible browser
// and slows every action down so the script editor can be watched. `firefox` and
// `webkit` run the cross-browser engine smoke test (npm run test:playwright:browsers).
export default defineConfig({
  testDir: './tests/playwright',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', testIgnore: /mobile-/, use: { ...devices['Desktop Chrome'] } },
    // Installed Chrome: Playwright's bundled headless shell has no WebGPU adapter.
    { name: 'chrome', testMatch: /engine-smoke/, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    {
      name: 'firefox', testMatch: /engine-smoke/,
      use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'dom.webgpu.enabled': true } } },
    },
    { name: 'webkit', testMatch: /engine-smoke/, use: { ...devices['Desktop Safari'] } },
    // Chrome on the Android device connected through adb (no desktop browser is launched).
    { name: 'android', testMatch: /mobile-/ },
    {
      name: 'demo',
      testIgnore: /mobile-/,
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        viewport: { width: 1600, height: 900 },
        launchOptions: { slowMo: 400 },
      },
    },
  ],
  webServer: {
    command: preview ? 'npm run preview' : 'npm run dev',
    url: baseURL,
    reuseExistingServer: !preview,
    timeout: 120_000,
  },
});
