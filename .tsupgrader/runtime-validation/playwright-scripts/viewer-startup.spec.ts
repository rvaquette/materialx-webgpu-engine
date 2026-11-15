import { test, expect } from '@playwright/test';

test.use({ channel: 'msedge' });

test('viewer-startup', async ({ page }) => {
  await page.route("**/*", async route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === "http://127.0.0.1:5173") {
      await route.continue();
    } else {
      await route.abort("blockedbyclient");
    }
  });
  await page.goto('http://127.0.0.1:5173');
  await page.getByLabel('Rendu de la scène').click();
  await expect(page.getByLabel('Rendu de la scène')).toBeVisible();
});
