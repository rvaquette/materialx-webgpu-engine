import { defineConfig, devices } from '@playwright/test';

// `chromium` runs the end-to-end tests quickly; `demo` opens a visible browser
// and slows every action down so the script editor can be watched.
export default defineConfig({
  testDir: './tests/playwright',
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'demo',
      use: {
        ...devices['Desktop Chrome'],
        headless: false,
        viewport: { width: 1600, height: 900 },
        launchOptions: { slowMo: 400 },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
