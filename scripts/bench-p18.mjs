// Measures CPU animation and completed offscreen raster frames on the exported P18 scenes.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { root } from './export-browser-session.mjs';

const cases = [
  ['wind', 'docs/images/p18/p18-animated-wind.usda', 1, [1, 1, 6], 40],
  ['ribbon', 'docs/images/p18/p18-animated-ribbon.usda', 2, [3, 2, 5], 36],
  ['lattice', 'docs/images/p18/p18-imported-lattice.usda', 1.5, [3, 2, 5], 36],
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
  await page.route('**/__p18_bench__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>P18 benchmark</title>' }));
  await page.goto(`http://127.0.0.1:${address.port}/__p18_bench__`);
  const adapter = await page.evaluate(async () => {
    const { sceneDeviceDescriptor } = await import('/src/gpu/device.ts');
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter available.');
    globalThis.__p18Device = await adapter.requestDevice(sceneDeviceDescriptor(adapter));
    const info = adapter.info;
    return { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description };
  });
  for (const [name, path, step, eye, fov] of cases) {
    const result = await page.evaluate(async ({ path, step, eye, fov }) => {
      const { InteractiveViewer } = await import('/src/render/viewer.ts');
      const { captureRgba } = await import('/src/gpu/capture.ts');
      const device = globalThis.__p18Device;
      const failures = [];
      const viewer = new InteractiveViewer({
        device, width: 512, height: 512, outputFormat: 'rgba8unorm',
        onDiagnostic: diagnostic => { if (diagnostic.level === 'error') failures.push(diagnostic.message); },
        onShaderErrors: errors => failures.push(...errors.map(error => error.message)),
      });
      const texture = device.createTexture({ size: [512, 512], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT });
      device.pushErrorScope('out-of-memory');
      device.pushErrorScope('validation');
      try {
        await viewer.load(new URL(path, location.href).href);
        if (!viewer.timeline?.animated) throw new Error('The scene has no animated timeline.');
        viewer.setBackend('raster');
        await viewer.setCamera({ eye, target: [0, 0, 0], fovY: fov * Math.PI / 180 });
        await viewer.prepareRaster();
        const view = texture.createView();
        viewer.renderRasterTo(view);
        await device.queue.onSubmittedWorkDone();
        const measurements = [];
        for (let frame = 0; frame < 24; frame++) {
          const started = performance.now();
          await viewer.setTime(frame * step);
          viewer.renderRasterTo(view);
          await device.queue.onSubmittedWorkDone();
          measurements.push(performance.now() - started);
        }
        await viewer.setTime(0);
        const first = await captureRgba(device, 512, 512, { raster: target => viewer.renderRasterTo(target) }, () => {});
        await viewer.setTime(12);
        const second = await captureRgba(device, 512, 512, { raster: target => viewer.renderRasterTo(target) }, () => {});
        let difference = 0;
        for (let i = 0; i < first.rgba.length; i++) difference += Math.abs(first.rgba[i] - second.rgba[i]);
        const meanPixelDifference = difference / first.rgba.length;
        if (meanPixelDifference <= 0.1) throw new Error('The rendered frames at time codes 0 and 12 are indistinguishable.');
        if (failures.length) throw new Error(failures.join('; '));
        return { measurements, meanPixelDifference };
      } finally {
        const validation = await device.popErrorScope();
        const memory = await device.popErrorScope();
        viewer.dispose();
        texture.destroy();
        if (validation || memory) throw new Error([validation?.message, memory?.message].filter(Boolean).join('; '));
      }
    }, { path, step, eye, fov });
    const values = result.measurements.sort((a, b) => a - b);
    if (values.length !== 24 || values.some(value => !Number.isFinite(value))) throw new Error(`${name}: invalid timing results.`);
    console.log(JSON.stringify({
      scene: name, adapter, resolution: 512, frames: values.length,
      meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95Ms: values[Math.ceil(values.length * 0.95) - 1], maxMs: values.at(-1),
      meanPixelDifference: result.meanPixelDifference,
    }));
  }
  await page.evaluate(() => globalThis.__p18Device.destroy());
} finally {
  await browser?.close();
  await server.close();
}
