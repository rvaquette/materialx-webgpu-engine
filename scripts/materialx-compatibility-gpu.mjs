import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const server = await createServer({
  configFile: false, appType: 'custom', logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0 },
});
server.middlewares.use((request, response, next) => {
  if (request.url !== '/__materialx_compatibility_probe.html') return next();
  response.setHeader('content-type', 'text/html');
  response.end('<!doctype html><title>MaterialX compatibility probe</title>');
});
let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Vite did not provide a TCP port.');
  browser = await chromium.launch({
    ...(process.env.MX_CHROME ? { executablePath: process.env.MX_CHROME } : { channel: 'chrome' }),
    headless: true,
    args: ['--enable-unsafe-webgpu', '--force_high_performance_gpu'],
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/__materialx_compatibility_probe.html`);
  const probe = await page.evaluate(async () => {
    const load = new Function('path', 'return import(path)');
    return (await load('/tests/fixtures/materialx-compatibility-gpu.ts')).materialxGpuProbes();
  });
  const sources = [
    ...(await readdir('src/compiler')).filter(file => file.endsWith('.ts')).map(file => `src/compiler/${file}`),
    ...(await readdir('src/gpu')).filter(file => file.endsWith('.ts')).map(file => `src/gpu/${file}`),
    'scripts/materialx-compatibility-cpu.ts', 'scripts/materialx-compatibility-gpu.mjs',
    'tests/fixtures/materialx-compatibility-gpu.ts', 'docs/generated/materialx-nodedefs.json',
  ].sort();
  const hashes = Object.fromEntries(await Promise.all(sources.map(async file =>
    [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
  const report = { browser: await browser.version(), adapter: probe.adapter, sources: hashes, results: probe.results };
  const output = 'docs/generated/materialx-gpu-probes.json';
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  for (const status of ['matched', 'different', 'error']) {
    console.log(`${status}: ${report.results.filter(result => result.status === status).length}`);
  }
  console.log(`Wrote ${output}; isolated compute probes are not complete renderer or MaterialX conformance tests.`);
} finally {
  await browser?.close();
  await server.close();
}
