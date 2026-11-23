// Temporary: capture the path-tracing WGSL built on the phone for a script setup, then compile
// WGSL variants on the device. node scripts/tmp-wgsl-dump.mjs dump <out.wgsl> | compile <file.wgsl>...
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { androidDevice, openAndroidTab } from '../tests/playwright/android.ts';

const [mode, ...files] = process.argv.slice(2);
const root = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');
const server = await createServer({
  root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null, forwardConsole: false },
});
await server.listen();
const port = server.httpServer.address().port;
const device = await androidDevice();
const tab = await openAndroidTab(device, `http://localhost:${port}/?entry=./scenes/standard-shader-ball/standard-shader-ball.usda&backend=raster&res=256&mxDump=${Date.now()}`, port);
const wait = async (expression, label, seconds = 180) => {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await new Promise(r => setTimeout(r, 1000))) {
    const value = await tab.evaluate(expression).catch(() => undefined);
    if (value) return value;
  }
  throw new Error(`timeout: ${label}`);
};
try {
  await wait(`typeof globalThis.__mxRunScript === 'function' && !!globalThis.__mxGpu`, 'viewer');
  if (mode === 'dump') {
    await tab.evaluate(`(() => {
      globalThis.__mxShaders = [];
      const original = GPUDevice.prototype.createShaderModule;
      GPUDevice.prototype.createShaderModule = function (descriptor) { globalThis.__mxShaders.push(descriptor.code); return original.call(this, descriptor); };
      void globalThis.__mxRunScript('s = new StandardSurface(); s.base_color = [1, 1, 1]; s.metalness = 1; s.specular_roughness = 0.2; await assign("/World/Geometry/OpenPBRShaderBall", s); render.backend = "pathtracing";');
      return true;
    })()`);
    const code = await wait(`(() => { const s = (globalThis.__mxShaders ?? []).filter(c => c.includes('mx_path_trace')); return s.length ? s.sort((a, b) => b.length - a.length)[0] : ''; })()`, 'path-trace shader');
    await writeFile(files[0], code);
    console.log(`dumped ${code.length} chars to ${files[0]}`);
  } else {
    for (const file of files) {
      const code = await readFile(file, 'utf8');
      const result = await tab.evaluate(`(async () => {
        const device = globalThis.__mxGpu.device;
        const module = device.createShaderModule({ code: ${JSON.stringify(code)} });
        const info = await module.getCompilationInfo();
        const errors = info.messages.filter(m => m.type === 'error').map(m => m.lineNum + ': ' + m.message).slice(0, 3);
        if (errors.length) return 'WGSL ' + errors.join(' | ');
        const started = performance.now();
        try {
          await device.createComputePipelineAsync({ layout: 'auto', compute: { module, entryPoint: 'mx_path_trace' } });
          return 'OK ' + Math.round(performance.now() - started) + ' ms';
        } catch (error) { return 'FAIL ' + String(error.message).split('\\n')[0]; }
      })()`);
      console.log(`${file} :: ${result}`);
    }
  }
} finally {
  await tab.close();
  await server.close();
}
process.exit(0);
