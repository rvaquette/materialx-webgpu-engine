// Temporary bisect probe: node scripts/tmp-mobile-probe.mjs <root> <entry> [seconds]
// <root> is a sparse worktree without scenes/: /scenes/* is served read-only from this repository.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { createServer } from 'vite';
import { androidDevice, openAndroidTab } from '../tests/playwright/android.ts';

const SCENES = resolve(import.meta.dirname, '..', 'scenes');
const sharedScenes = {
  name: 'shared-scenes',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const path = decodeURIComponent((req.url ?? '').split('?')[0]);
      if (!path.startsWith('/scenes/')) return next();
      const file = normalize(join(SCENES, path.slice('/scenes/'.length)));
      if (!file.startsWith(SCENES) || !existsSync(file) || !statSync(file).isFile()) return next();
      const types = { '.usda': 'text/plain', '.mtlx': 'application/xml', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.hdr': 'application/octet-stream' };
      res.setHeader('Content-Type', types[extname(file).toLowerCase()] ?? 'application/octet-stream');
      res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      createReadStream(file).pipe(res);
    });
  },
};

const [root, entry, seconds = '240', extra = '', setup = ''] = process.argv.slice(2);
const sparse = !existsSync(join(root, 'scenes'));
const server = await createServer({
  root, configFile: join(root, 'vite.config.ts'), logLevel: 'error', plugins: sparse ? [sharedScenes] : [],
  server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null, forwardConsole: false },
});
await server.listen();
const port = server.httpServer.address().port;
const device = await androidDevice();
if (!device) throw new Error('no device');
const url = `http://localhost:${port}/?entry=${entry}&backend=${setup ? 'raster' : 'pathtracing'}&res=256${extra}&mxProbe=${Date.now()}`;
const tab = await openAndroidTab(device, url, port);
let result = 'timeout';
try {
  if (setup) {
    // Settings first (depth, resolution...), then path tracing; the script is not awaited.
    for (const end = Date.now() + 120_000; Date.now() < end; await new Promise(r => setTimeout(r, 1000))) {
      if (await tab.evaluate(`typeof globalThis.__mxRunScript === 'function'`).catch(() => false)) break;
    }
    await tab.evaluate(`void globalThis.__mxRunScript(${JSON.stringify(`${setup}\nrender.backend = "pathtracing";`)}).then(r => { if (!r.ok) console.error('setup: ' + r.message); })`);
  }
  for (const end = Date.now() + Number(seconds) * 1000; Date.now() < end; await new Promise(r => setTimeout(r, 1000))) {
    const state = await tab.evaluate(`({
      spp: document.getElementById('pathtracing-spp')?.hidden === false ? document.getElementById('pathtracing-spp').textContent : '',
      status: document.getElementById('status')?.hidden === false ? document.getElementById('status').textContent : '',
      shader: (document.getElementById('shader-messages')?.textContent ?? '').slice(0, 300),
    })`).catch(error => ({ spp: '', status: `evaluate: ${error.message}`, shader: '' }));
    const lost = tab.errors.find(error => /device lost|DEVICE_LOST/i.test(error));
    if (lost) { result = `DEVICE_LOST (${state.spp || 'no samples'})`; break; }
    if (state.status || state.shader) { result = `ERROR ${state.status} ${state.shader}`.replace(/\s+/g, ' '); break; }
    if (Number(/^(\d+)/.exec(state.spp)?.[1] ?? 0) >= 16) { result = `OK ${state.spp}`; break; }
  }
} finally {
  await tab.close();
  await server.close();
}
console.log(`RESULT ${entry} :: ${result}`);
process.exit(0);
