// Mobile USD raster capture: import a real text USDA stage, rasterize its actual
// geometry on the connected device GPU, and save the result as a PNG under
// renders/. Mirrors run-scene-image.mjs but points at the USD harness, which
// fetches the .usda + .mtlx layers, builds SceneResources and the raster
// scene-frame, and drives the executable WebGPU raster backend end-to-end.
//
// Usage:  node scripts/run-usd-image.mjs [entryUrlPath] [res]
//   entryUrlPath defaults to the Disney gold scene served by Vite.
// Env:    MX_ADB   path to adb (default D:\platform-tools\adb.exe)
//         MX_PORT  dev server port (default 5173)

import { spawn, execFile } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ADB = process.env.MX_ADB ?? 'D:\\platform-tools\\adb.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const ENTRY = process.argv[2] ?? '/scenes/test_material_disney_gold/test_material_disney_gold.usda';
const RES = Number(process.argv[3] ?? 256);
const SPP = Number(process.argv[4] ?? 192);
const NAME = (ENTRY.split('/').pop() ?? 'usd-scene').replace(/\.usda?$/, '');
const HARNESS_PATH = '/usd-image-harness.html';
const QUERY = `?entry=${encodeURIComponent(ENTRY)}&res=${RES}&spp=${SPP}&_=${Date.now()}`;
const HARNESS_URL = `http://localhost:${PORT}${HARNESS_PATH}${QUERY}`;
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = new URL('../renders/', import.meta.url);
const OUT_FILE = new URL(`../renders/mobile-render-${NAME}-usda.png`, import.meta.url);

const log = (m) => console.log(`[usd-image] ${m}`);

function adb(args) {
  return new Promise((resolve, reject) => {
    execFile(ADB, args, (err, stdout, stderr) => {
      if (err) reject(new Error(`${args.join(' ')}: ${stderr || err.message}`));
      else resolve(stdout.trim());
    });
  });
}

async function httpOk(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

async function waitFor(fn, attempts, label) {
  for (let i = 0; i < attempts; i++) {
    if (await fn()) return true;
    await sleep(250);
  }
  throw new Error(`timed out waiting for ${label}`);
}

function cdpList() {
  return fetch(`${CDP}/json/list`).then((r) => r.json());
}

async function fetchImageViaCdp(wsUrl, expectedEntry) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const msgId = ++id;
      pending.set(msgId, resolve);
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP socket error')), { once: true });
  });
  await send('Runtime.enable');
  await send('Page.enable');
  // Force a real load of the requested URL; am start may reuse the tab without
  // navigating when only the query string changed.
  await send('Page.navigate', { url: HARNESS_URL });

  const evalExpr = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res?.result?.result?.value;
  };
  let dataUrl = null;
  let lastError = null;
  // Time-based wait: a heavy textured render can take minutes on the device, so
  // poll on a wall-clock deadline with a fixed pause rather than a fixed count
  // of CDP round-trips (which a busy-loop would exhaust in seconds). The poll
  // returns only a light flag (entry + failed), never the full data URL, so a
  // large PNG never has to survive JSON serialization on every iteration.
  const DEADLINE_MS = 10 * 60 * 1000;
  const POLL_MS = 500;
  const started = Date.now();
  let poll = 0;
  let ready = false;
  while (!ready && Date.now() - started < DEADLINE_MS) {
    // Only accept an image whose rendered entry matches the request, so a stale
    // __MX_IMAGE__ from the previous scene is never captured. `failed` flags an
    // explicit null written by the harness on error, so we bail out immediately
    // instead of waiting the whole deadline.
    const raw = await evalExpr(
      "JSON.stringify({ e: (globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.entry) ?? null, failed: ('__MX_IMAGE__' in globalThis) && globalThis.__MX_IMAGE__ === null })",
    );
    let status = null;
    try { status = raw ? JSON.parse(raw) : null; } catch { status = null; }
    if (status && status.e === expectedEntry) {
      ready = true;
      break;
    }
    if (status && status.failed) {
      lastError = await evalExpr("(document.body && document.body.innerText) || ''");
      break;
    }
    if (poll % 20 === 19) {
      lastError = await evalExpr("(document.body && document.body.innerText) || ''");
    }
    poll += 1;
    await sleep(POLL_MS);
  }
  if (ready) {
    // Fetch the actual PNG only once, after readiness, in a single eval.
    const d = await evalExpr('(globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.dataUrl) ?? null');
    if (typeof d === 'string' && d.startsWith('data:image/png')) dataUrl = d;
  }
  ws.close();
  if (!dataUrl) throw new Error(`device did not produce __MX_IMAGE__${lastError ? `: ${lastError.slice(0, 400)}` : ''}`);
  return dataUrl;
}

async function main() {
  const devices = await adb(['devices']);
  const connected = devices.split('\n').slice(1).filter((l) => l.trim().endsWith('device'));
  if (connected.length === 0) {
    throw new Error('no authorized device connected');
  }
  log(`device: ${connected[0].split('\t')[0]}`);
  log(`entry: ${ENTRY} @ ${RES}x${RES}`);

  let vite = null;
  if (await httpOk(LOCAL_URL)) {
    log(`reusing dev server on :${PORT}`);
  } else {
    log(`starting vite on :${PORT}`);
    vite = spawn(`npx vite --host 127.0.0.1 --port ${PORT} --strictPort`, { stdio: 'ignore', shell: true });
    await waitFor(() => httpOk(LOCAL_URL), 80, 'vite dev server');
  }

  try {
    await adb(['reverse', `tcp:${PORT}`, `tcp:${PORT}`]);
    await adb(['forward', 'tcp:9222', 'localabstract:chrome_devtools_remote']);
    await adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${HARNESS_URL}'`, 'com.android.chrome']);

    let page;
    await waitFor(async () => {
      const list = await cdpList().catch(() => []);
      page = list.find((t) => typeof t.url === 'string' && t.url.includes(HARNESS_PATH));
      return Boolean(page);
    }, 60, 'harness tab on device');
    log('rendering USD scene on device GPU...');
    const dataUrl = await fetchImageViaCdp(page.webSocketDebuggerUrl, ENTRY);

    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, Buffer.from(base64, 'base64'));
    log(`saved ${OUT_FILE.pathname}`);
  } finally {
    await adb(['reverse', '--remove', `tcp:${PORT}`]).catch(() => {});
    await adb(['forward', '--remove', 'tcp:9222']).catch(() => {});
    if (vite) vite.kill();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[usd-image] ${err.message}`);
    process.exit(1);
  });
