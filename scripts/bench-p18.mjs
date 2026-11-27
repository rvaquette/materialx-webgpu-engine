// Measures scripted raster animation on the exported P18 scenes.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { root } from './export-browser-session.mjs';

const cases = [
  ['wind', 'docs/images/p18/p18-animated-wind.usda', 1],
  ['ribbon', 'docs/images/p18/p18-animated-ribbon.usda', 2],
  ['lattice', 'docs/images/p18/p18-imported-lattice.usda', 1.5],
];

const server = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not provide a TCP port.');
  browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof globalThis.__mxRunScript === 'function');
  for (const [name, path, step] of cases) {
    const source = `
      await scene(${JSON.stringify(`./${path}`)});
      render.resolution = 512; render.backend = "raster";
      await render(1);
      measurements = [];
      for (let frame = 0; frame < 24; frame++) {
        started = performance.now();
        await setTime(frame * ${step});
        await render(1);
        await globalThis.__mxGpu.device.queue.onSubmittedWorkDone();
        measurements.push(performance.now() - started);
      }
      log("P18_TIMINGS " + JSON.stringify(measurements));
    `;
    const result = await page.evaluate(code => globalThis.__mxRunScript(code), source);
    if (!result.ok) throw new Error(`${name}: ${result.message}`);
    const line = result.logs.find(value => value.startsWith('P18_TIMINGS '));
    if (!line) throw new Error(`${name}: missing timing results.`);
    const values = JSON.parse(line.slice('P18_TIMINGS '.length)).sort((a, b) => a - b);
    if (values.length !== 24 || values.some(value => !Number.isFinite(value))) throw new Error(`${name}: invalid timing results.`);
    console.log(JSON.stringify({
      scene: name, resolution: 512, frames: values.length,
      meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95Ms: values[Math.ceil(values.length * 0.95) - 1], maxMs: values.at(-1),
    }));
  }
} finally {
  await browser?.close();
  await server.close();
}
