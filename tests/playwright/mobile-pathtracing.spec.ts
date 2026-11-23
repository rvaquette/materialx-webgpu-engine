import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { androidDevice, openAndroidTab } from './android.ts';

// Path tracing in Chrome on the connected Android device, without material scripts: the viewer
// (index.html) opens each scene with ?backend=pathtracing and must accumulate samples with no error.
// npm run test:playwright:android (adb: MX_ADB, default D:\platform-tools\adb.exe; keep the device unlocked)

const SCENES = [
  './scenes/pathtracer/test_veach.usda',
  './scenes/standard-shader-ball/standard-shader-ball.usda',
  './scenes/bench/animated.usda',
];
const SAMPLES = 16;

// `adb reverse` reaches the host on 127.0.0.1, where `npm run dev` (localhost, often ::1) may not listen.
let server: ViteDevServer;
test.beforeAll(async () => {
  server = await createServer({
    root: fileURLToPath(new URL('../..', import.meta.url)), logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null },
  });
  await server.listen();
});
test.afterAll(async () => { await server?.close(); });

for (const entry of SCENES) {
  test(`path tracing mobile : ${entry.split('/').at(-1)}`, async ({}, info) => {
    test.setTimeout(600_000);
    const device = await androidDevice();
    test.skip(!device, 'Aucun appareil Android autorisé (adb devices).');
    const address = server.httpServer!.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const url = `http://localhost:${port}/?entry=${entry}&backend=pathtracing&res=256&mxTest=${Date.now()}`;
    const tab = await openAndroidTab(device!, url, port);
    try {
      info.annotations.push({ type: 'device', description: device!.label });
      const state = (): Promise<{ spp: string; status: string; shader: string; adapter: string }> => tab.evaluate(`({
        spp: document.getElementById('pathtracing-spp')?.hidden === false ? document.getElementById('pathtracing-spp').textContent : '',
        status: document.getElementById('status')?.hidden === false ? document.getElementById('status').textContent : '',
        shader: document.getElementById('shader-messages')?.textContent ?? '',
        adapter: String(globalThis.__mxGpu?.adapter?.info?.architecture ?? ''),
      })`);
      let last = { spp: '', status: '', shader: '', adapter: '' };
      for (const end = Date.now() + 540_000; ; await new Promise(resolve => setTimeout(resolve, 1000))) {
        last = await state();
        if (last.status || last.shader) throw new Error(`${last.status}\n${last.shader}`.trim().slice(0, 2000));
        if (Number(/^(\d+)/.exec(last.spp)?.[1] ?? 0) >= SAMPLES) break;
        if (Date.now() > end) throw new Error(`Pas ${SAMPLES} échantillons en 9 min (${last.spp || 'aucun échantillon'}).`);
      }
      info.annotations.push({ type: 'gpu', description: last.adapter }, { type: 'samples', description: last.spp });
    } finally {
      await info.attach('rendu', { body: await tab.screenshot().catch(() => new Uint8Array()) as never, contentType: 'image/png' });
      if (tab.errors.length) await info.attach('erreurs console', { body: tab.errors.join('\n'), contentType: 'text/plain' });
      await tab.close();
    }
  });
}
