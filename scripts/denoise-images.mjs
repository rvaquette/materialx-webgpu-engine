// Denoises display-ready PNGs with the viewer's neural denoiser (public/denoiser:
// OIDN rt_ldr_small run by TensorFlow.js on WebGPU), using the same settings as
// src/render/pathtracing/js-denoiser.ts. Runs in headless Chrome through the
// Vite dev server; outputs go to <dir>/denoised/<name>.png.
//
// Usage:  node scripts/denoise-images.mjs [dir]   (default renders/lama-sss-presets)
// Env:    MX_CHROME, MX_PORT (default 5173), MX_CDP_PORT (default 9334)

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const CDP_PORT = Number(process.env.MX_CDP_PORT ?? 9334);
const PAGE_URL = `http://127.0.0.1:${PORT}/usd-image-harness.html?session=1`;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const DIR = resolve(process.argv[2] ?? 'renders/lama-sss-presets');
const OUT = join(DIR, 'denoised');
const log = (m) => console.log(`[denoise] ${m}`);

const files = readdirSync(DIR).filter((name) => name.toLowerCase().endsWith('.png')).sort();
if (files.length === 0) throw new Error(`no PNG in ${DIR}`);

async function httpOk(url) {
  try { return (await fetch(url)).ok; } catch { return false; }
}

async function waitFor(fn, attempts, label) {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function openCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) => new Promise((done) => {
    const msgId = ++id;
    pending.set(msgId, done);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP socket error')), { once: true });
  });
  return { ws, send, ready };
}

// Runs in the page: one WebGPU device and one model for every image.
const SETUP = `(async () => {
  const { Denoiser } = await import('/denoiser/denoiser.js');
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice({ requiredLimits: {
    maxBufferSize: adapter.limits.maxBufferSize,
    maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
  } });
  const model = new Denoiser('webgpu', device);
  Object.assign(model, { weightsUrl: new URL('/denoiser', location.href).href, quality: 'fast', hdr: false,
    srgb: true, useTiling: true, tileSize: 256, batchSize: 1, outputMode: 'imgData', flipOutputY: false });
  await new Promise((done, fail) => {
    const timeout = setTimeout(() => fail(new Error('denoiser initialization timed out')), 20000);
    const detach = model.onBackendReady(() => { clearTimeout(timeout); detach?.(); done(); });
  });
  globalThis.__MX_DENOISE__ = async (dataUrl) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0);
    const input = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    model.width = input.width;
    model.height = input.height;
    const output = await model.execute(input);
    if (!(output instanceof ImageData) || output.width !== input.width || output.height !== input.height) {
      throw new Error('denoiser returned an invalid image');
    }
    for (let i = 3; i < output.data.length; i += 4) output.data[i] = 255;
    ctx.putImageData(output, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  return 'ok';
})()`;

let vite = null;
if (!(await httpOk(PAGE_URL))) {
  log(`starting vite on :${PORT}`);
  vite = spawn(`npx vite --host 127.0.0.1 --port ${PORT} --strictPort`, { stdio: 'ignore', shell: true });
  await waitFor(() => httpOk(PAGE_URL), 80, 'vite dev server');
}
const profile = mkdtempSync(join(tmpdir(), 'mx-denoise-'));
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, '--no-first-run',
  '--no-default-browser-check', '--enable-unsafe-webgpu', '--headless=new', PAGE_URL,
], { stdio: 'ignore' });

let failed = 0;
try {
  await waitFor(() => httpOk(`${CDP}/json/version`), 80, 'chrome devtools');
  let page;
  await waitFor(async () => {
    const list = await fetch(`${CDP}/json/list`).then((r) => r.json()).catch(() => []);
    page = list.find((t) => typeof t.url === 'string' && t.url.includes('usd-image-harness.html'));
    return Boolean(page);
  }, 60, 'page tab');
  const { ws, send, ready } = openCdp(page.webSocketDebuggerUrl);
  await ready;
  const evaluate = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    const error = res?.result?.exceptionDetails;
    if (error) throw new Error(error.exception?.description ?? error.text);
    return res?.result?.result?.value;
  };
  await waitFor(async () => (await evaluate('document.readyState')) === 'complete', 80, 'page load');
  await evaluate(SETUP);
  mkdirSync(OUT, { recursive: true });
  for (const name of files) {
    const started = Date.now();
    try {
      const input = `data:image/png;base64,${readFileSync(join(DIR, name)).toString('base64')}`;
      const output = await evaluate(`globalThis.__MX_DENOISE__(${JSON.stringify(input)})`);
      writeFileSync(join(OUT, name), Buffer.from(output, 'base64'));
      log(`${name} -> denoised/${name} (${Date.now() - started} ms)`);
    } catch (error) {
      failed++;
      log(`${name} FAILED: ${error.message}`);
    }
  }
  ws.close();
} finally {
  chrome.kill();
  if (vite) vite.kill();
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold the profile */ }
}
process.exit(failed ? 1 : 0);
