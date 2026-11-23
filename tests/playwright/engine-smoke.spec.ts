import { expect, test } from '@playwright/test';
import { decodePng } from '../../scripts/png.mjs';

// Cross-browser contract: the engine example either renders its blue triangle or states why
// WebGPU is unavailable. It must never stay silent or show an empty canvas without a message.
test('renders the engine example or explains why WebGPU is unavailable', async ({ page, browserName }, testInfo) => {
  await page.goto('/examples/engine/index.html');
  const status = page.getByRole('status');
  await expect(status).not.toHaveText('Chargement…', { timeout: 90_000 });
  const text = (await status.textContent()) ?? '';
  testInfo.annotations.push({ type: 'webgpu', description: `${browserName}: ${text}` });
  if (!text.startsWith('Raster')) {
    expect(text).toMatch(/WebGPU is not available|No WebGPU adapter|No WebGPU canvas context/);
    return;
  }
  expect(text).toBe('Raster — 1 objet(s)');
  const { width, height, rgba } = decodePng(await page.locator('canvas').screenshot());
  const center = ((height >> 1) * width + (width >> 1)) * 4;
  expect(rgba[center + 2]!, 'blue triangle at the canvas centre').toBeGreaterThan(rgba[center]! + 25);
});
