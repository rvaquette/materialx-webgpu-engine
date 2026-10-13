// Mobile raster image capture: render one control scene's raster frame on the
// connected device GPU and save it as a PNG under renders/. Reuses the T035d
// orchestration flow (run-scene-device.mjs): serve harness -> adb reverse ->
// launch Chrome -> CDP reload -> poll the __MX_IMAGE__ data URL -> decode to PNG.
//
// Usage:  node scripts/run-scene-image.mjs [sceneId] [res]
// Env:    MX_ADB   path to adb (default D:\platform-tools\adb.exe)
//         MX_PORT  dev server port (default 5173)

import { spawn, execFile } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ADB = process.env.MX_ADB ?? 'D:\\platform-tools\\adb.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const SCENE = process.argv[2] ?? 'standard_surface_carpaint';
const RES = Number(process.argv[3] ?? 256);
const HARNESS_PATH = '/scene-image-harness.html';
const QUERY = `?scene=${encodeURIComponent(SCENE)}&res=${RES}`;
const HARNESS_URL = `http://localhost:${PORT}${HARNESS_PATH}${QUERY}`;
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = new URL('../renders/', import.meta.url);
const OUT_FILE = new URL(`../renders/mobile-raster-${SCENE}.png`, import.meta.url);

const log = (m) => console.log(`[scene-image] ${m}`);

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

async function fetchImageViaCdp(wsUrl) {
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
  await send('Page.reload', { ignoreCache: true });

  const evalExpr = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res?.result?.result?.value;
  };
  let dataUrl = null;
  for (let i = 0; i < 2000 && !dataUrl; i++) {
    const v = await evalExpr('(globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.dataUrl) ?? null');
    if (typeof v === 'string' && v.startsWith('data:image/png')) dataUrl = v;
  }
  ws.close();
  if (!dataUrl) throw new Error('device did not produce __MX_IMAGE__');
  return dataUrl;
}

async function main() {
  const devices = await adb(['devices']);
  const connected = devices.split('\n').slice(1).filter((l) => l.trim().endsWith('device'));
  if (connected.length === 0) {
    throw new Error('no authorized device connected');
  }
  log(`device: ${connected[0].split('\t')[0]}`);
  log(`scene: ${SCENE} @ ${RES}x${RES}`);

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
    log('rendering image on device GPU...');
    const dataUrl = await fetchImageViaCdp(page.webSocketDebuggerUrl);

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
    console.error(`[scene-image] ${err.message}`);
    process.exit(1);
  });
