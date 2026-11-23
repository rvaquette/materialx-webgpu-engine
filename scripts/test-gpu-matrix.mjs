// Browser and GPU family matrix: runs the headless raster and path-tracing capture
// checks (scripts/capture-engine-browser.ts) in every browser and adapter found on
// this machine, and prints the capabilities each one reports.
//
//   node scripts/test-gpu-matrix.mjs [--out matrix.json]
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { openExportSession, SWIFTSHADER_ARGS } from './export-browser-session.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const browsers = [
  ['Chrome', process.env.MX_CHROME ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync)],
  ['Edge', [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/usr/bin/microsoft-edge',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].find(existsSync)],
].filter(([, path]) => path);
const adapters = [
  ['high-performance', ['--force_high_performance_gpu'], false],
  ['low-power', ['--force_low_power_gpu'], false],
  // SwiftShader is too slow for path tracing: raster only.
  ['SwiftShader', SWIFTSHADER_ARGS, true],
];

const rows = [];
for (const [browser, executable] of browsers) {
  for (const [adapter, args, rasterOnly] of adapters) {
    process.env.MX_CHROME = executable;
    const row = { browser, adapter };
    let session;
    try {
      session = await openExportSession({ label: 'gpu-matrix', browserModule: '/scripts/gpu-matrix-browser.ts', quiet: true, browserArgs: args });
      const result = await session.call('probe', [rasterOnly], 10 * 60 * 1000);
      const { capabilities: caps } = result;
      Object.assign(row, {
        gpu: `${caps.adapter.vendor} ${caps.adapter.architecture}`.trim() || caps.adapter.description || 'unknown',
        raster: 'ok', pathtracing: rasterOnly ? 'not run' : 'ok',
        backends: Object.fromEntries(Object.entries(caps.backends).map(([name, support]) => [name, support.supported ? 'supported' : support.reason])),
        gpuTimings: caps.gpuTimings, maxTextureSize: caps.maxTextureSize,
        storageBuffers: caps.limits.maxStorageBuffersPerShaderStage, seconds: Number((result.milliseconds / 1000).toFixed(1)),
      });
    } catch (error) {
      row.error = error instanceof Error ? error.message : String(error);
    } finally {
      await session?.close();
    }
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
console.log('\n| Browser | Adapter | GPU | Raster | Path tracing | GPU timings | Storage buffers | Time (s) |');
console.log('|---|---|---|---|---|---|---:|---:|');
for (const row of rows) {
  console.log(row.error
    ? `| ${row.browser} | ${row.adapter} | – | failed: ${row.error} | | | | |`
    : `| ${row.browser} | ${row.adapter} | ${row.gpu} | ${row.raster} | ${row.pathtracing} | ${row.gpuTimings ? 'yes' : 'no'} | ${row.storageBuffers} | ${row.seconds} |`);
}
if (values.out) await writeFile(values.out, `${JSON.stringify(rows, null, 2)}\n`);
if (rows.some(row => row.error)) process.exitCode = 1;
