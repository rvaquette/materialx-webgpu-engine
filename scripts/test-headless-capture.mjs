import { test } from 'node:test';
import { openExportSession } from './export-browser-session.mjs';

const rasterOnly = process.env.MX_CAPTURE_RASTER_ONLY === '1';
const backends = rasterOnly ? 'raster' : 'raster and fixed-sample path tracing';

test(`captures repeatable images in headless WebGPU: ${backends}`, async () => {
  const session = await openExportSession({
    label: 'headless-capture',
    browserModule: '/scripts/capture-engine-browser.ts',
    browserArgs: process.platform === 'linux'
      ? ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-webgpu-adapter=swiftshader']
      : [],
  });
  try {
    const result = await session.call('verifyHeadlessCaptures', [rasterOnly], rasterOnly ? 60_000 : 360_000);
    const pathTracing = rasterOnly ? '' : `, path tracing ${result.pathTraceCenter}`;
    console.log(`Headless WebGPU ${result.width}x${result.height}: raster ${result.rasterCenter}${pathTracing}`);
  } finally {
    await session.close();
  }
});
