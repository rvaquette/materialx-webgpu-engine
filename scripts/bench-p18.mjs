// Measures completed offscreen raster frames and UI timeline updates on the exported P18 scenes.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { join } from 'node:path';
import { root } from './export-browser-session.mjs';

const cases = [
  ['wind', 'docs/images/p18/p18-animated-wind.usda', 1, [1, 1, 6], 40],
  ['ribbon', 'docs/images/p18/p18-animated-ribbon.usda', 2, [3, 2, 5], 36],
  ['lattice', 'docs/images/p18/p18-imported-lattice.usda', 1.5, [3, 2, 5], 36],
];
const frames = 240;

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
    const result = await page.evaluate(async ({ path, step, eye, fov, frames }) => {
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
        for (let frame = 0; frame < 24; frame++) {
          await viewer.setTime(frame * step);
          viewer.renderRasterTo(view);
          await device.queue.onSubmittedWorkDone();
        }
        const measurements = [];
        const timeMeasurements = [];
        const renderMeasurements = [];
        const dispatchesBefore = performance.getEntriesByName('deformer:compute').length;
        for (let frame = 0; frame < frames; frame++) {
          const started = performance.now();
          await viewer.setTime((frame % 24) * step);
          const timeDone = performance.now();
          viewer.renderRasterTo(view);
          await device.queue.onSubmittedWorkDone();
          const finished = performance.now();
          measurements.push(finished - started);
          timeMeasurements.push(timeDone - started);
          renderMeasurements.push(finished - timeDone);
        }
        const dispatches = performance.getEntriesByName('deformer:compute').length - dispatchesBefore;
        if (dispatches < measurements.length) throw new Error('The benchmark did not evaluate a GPU deformer at every time step.');
        await viewer.setTime(0);
        const first = await captureRgba(device, 512, 512, { raster: target => viewer.renderRasterTo(target) }, () => {});
        await viewer.setTime(12);
        const second = await captureRgba(device, 512, 512, { raster: target => viewer.renderRasterTo(target) }, () => {});
        let difference = 0;
        for (let i = 0; i < first.rgba.length; i++) difference += Math.abs(first.rgba[i] - second.rgba[i]);
        const meanPixelDifference = difference / first.rgba.length;
        if (meanPixelDifference <= 0.1) throw new Error('The rendered frames at time codes 0 and 12 are indistinguishable.');
        if (failures.length) throw new Error(failures.join('; '));
        const computeMeasurements = performance.getEntriesByName('deformer:compute')
          .slice(dispatchesBefore, dispatchesBefore + dispatches).map(entry => entry.duration);
        return { measurements, timeMeasurements, renderMeasurements, computeMeasurements, meanPixelDifference, dispatches };
      } finally {
        const validation = await device.popErrorScope();
        const memory = await device.popErrorScope();
        viewer.dispose();
        texture.destroy();
        if (validation || memory) throw new Error([validation?.message, memory?.message].filter(Boolean).join('; '));
      }
    }, { path, step, eye, fov, frames });
    const values = result.measurements.sort((a, b) => a - b);
    if (values.length !== frames || values.some(value => !Number.isFinite(value))) throw new Error(`${name}: invalid timing results.`);
    console.log(JSON.stringify({
      scene: name, adapter, resolution: 512, frames: values.length,
      meanMs: values.reduce((sum, value) => sum + value, 0) / values.length,
      p95Ms: values[Math.ceil(values.length * 0.95) - 1], maxMs: values.at(-1),
      meanSetTimeMs: result.timeMeasurements.reduce((sum, value) => sum + value, 0) / values.length,
      meanRenderMs: result.renderMeasurements.reduce((sum, value) => sum + value, 0) / values.length,
      meanComputeMs: result.computeMeasurements.reduce((sum, value) => sum + value, 0) / result.computeMeasurements.length,
      meanPixelDifference: result.meanPixelDifference, dispatches: result.dispatches,
    }));
  }
  await page.evaluate(() => globalThis.__p18Device.destroy());
  await page.close();
  const ui = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const allowed = new Set([
    ...cases.map(([, path]) => path.split('/').at(-1)),
    'cloth_material.mtlx', 'ribbonSurface_material.mtlx', 'surface_material.mtlx',
  ]);
  await ui.route('**/scenes/bench/p18-ui/**', async route => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!allowed.has(name)) throw new Error(`Unexpected P18 resource: ${name}`);
    await route.fulfill({ path: join(root, 'docs', 'images', 'p18', name) });
  });
  for (const [name, path] of cases) {
    const file = path.split('/').at(-1);
    const entry = `./scenes/bench/p18-ui/${file}`;
    await ui.goto(`http://127.0.0.1:${address.port}/?entry=${encodeURIComponent(entry)}&res=512&backend=raster`);
    await ui.locator('#app.ui-ready').waitFor({ timeout: 120_000 });
    await ui.locator('#view-timeline:not([hidden])').waitFor({ timeout: 120_000 });
    await ui.locator('#busy-indicator').waitFor({ state: 'hidden', timeout: 120_000 });
    await ui.locator('#view-timeline-play').click();
    await ui.waitForTimeout(1000);
    const before = await ui.locator('#view').screenshot();
    await ui.waitForTimeout(500);
    const after = await ui.locator('#view').screenshot();
    const difference = await ui.evaluate(async ([a, b]) => {
      const pixels = async data => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob());
        const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d');
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
      };
      const first = await pixels(a), second = await pixels(b);
      if (first.length !== second.length) throw new Error('Canvas dimensions changed during playback.');
      let sum = 0;
      for (let i = 0; i < first.length; i++) sum += Math.abs(first[i] - second[i]);
      return sum / first.length;
    }, [before.toString('base64'), after.toString('base64')]);
    if (difference <= 0.1) throw new Error(`${name}: playback did not change the displayed canvas.`);
    const playback = await ui.evaluate(async () => {
      const canvas = document.querySelector('#view');
      const stream = canvas.captureStream();
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
      video.srcObject = stream;
      document.body.append(video);
      let callback;
      const presented = [];
      const observe = (_now, metadata) => {
        presented.push({ time: metadata.presentationTime, frames: metadata.presentedFrames });
        callback = video.requestVideoFrameCallback(observe);
      };
      try {
        await video.play();
        callback = video.requestVideoFrameCallback(observe);
        const started = performance.now();
        await new Promise(resolve => setTimeout(resolve, 8000));
        const ended = performance.now();
        const entries = performance.getEntriesByName('deformer:compute')
          .filter(entry => entry.startTime >= started && entry.startTime + entry.duration <= ended);
        const times = entries.map(entry => entry.startTime + entry.duration);
        const intervals = times.slice(1).map((time, index) => time - times[index]).sort((a, b) => a - b);
        if (!intervals.length) throw new Error('No GPU deformation updates during playback.');
        if (presented.length < 2) throw new Error('No canvas frames were presented during playback.');
        const first = presented[0], last = presented.at(-1);
        return {
          seconds: (ended - started) / 1000, updates: times.length,
          updatesPerSecond: times.length * 1000 / (ended - started),
          p95IntervalMs: intervals[Math.ceil(intervals.length * 0.95) - 1],
          maxIntervalMs: intervals.at(-1),
          canvasFramesPerSecond: (last.frames - first.frames) * 1000 / (last.time - first.time),
          observedCanvasFrames: presented.length,
        };
      } finally {
        if (callback !== undefined) video.cancelVideoFrameCallback(callback);
        video.pause();
        video.srcObject = null;
        stream.getTracks().forEach(track => track.stop());
        video.remove();
      }
    });
    if (await ui.locator('#view-timeline-play').textContent() !== 'Arrêter') throw new Error(`${name}: playback stopped.`);
    console.log(JSON.stringify({ scene: name, mode: 'ui-headless', resolution: 512, ...playback, meanPixelDifference: difference }));
  }
  await ui.close();
} finally {
  await browser?.close();
  await server.close();
}
