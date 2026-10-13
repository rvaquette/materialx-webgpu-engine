// Local-GPU USD image capture: the desktop counterpart of run-usd-image.mjs.
// Serves the USD image harness, launches the workstation Chrome with remote
// debugging, drives the real WebGPU path tracer on the desktop GPU, saves the
// PNG under renders/ and prints the on-page diagnostic log so black-render
// causes (black bake / matLayer / UVs / exposure) are visible without a device.
//
// Usage:  node scripts/run-usd-image-local.mjs [entryUrlPath] [res] [spp]
// Env:    MX_CHROME  path to chrome.exe (default: standard Windows install)
//         MX_PORT    dev server port (default 5173)

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const ENTRY = process.argv[2] ?? '/scenes/test_material_disney_gold/test_material_disney_gold.usda';
const RES = Number(process.argv[3] ?? 256);
const SPP = Number(process.argv[4] ?? 192);
const NAME = (ENTRY.split('/').pop() ?? 'usd-scene').replace(/\.usda?$/, '');
const HARNESS_PATH = '/usd-image-harness.html';
const QUERY = `?entry=${encodeURIComponent(ENTRY)}&res=${RES}&spp=${SPP}&_=${Date.now()}`;
const HARNESS_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}${QUERY}`;
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = new URL('../renders/', import.meta.url);
const OUT_FILE = new URL(`../renders/local-render-${NAME}-usda.png`, import.meta.url);

const log = (m) => console.log(`[usd-image-local] ${m}`);

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

async function captureViaCdp(wsUrl, expectedEntry) {
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
  await send('Page.navigate', { url: HARNESS_URL });

  const evalExpr = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res?.result?.result?.value;
  };

  const DEADLINE_MS = 10 * 60 * 1000;
  const started = Date.now();
  let ready = false;
  let lastLog = '';
  while (!ready && Date.now() - started < DEADLINE_MS) {
    const raw = await evalExpr(
      "JSON.stringify({ e: (globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.entry) ?? null, failed: ('__MX_IMAGE__' in globalThis) && globalThis.__MX_IMAGE__ === null })",
    );
    let status = null;
    try { status = raw ? JSON.parse(raw) : null; } catch { status = null; }
    lastLog = (await evalExpr("(document.body && document.body.innerText) || ''")) || lastLog;
    if (status && status.e === expectedEntry) { ready = true; break; }
    if (status && status.failed) break;
    await sleep(500);
  }
  let dataUrl = null;
  if (ready) {
    const d = await evalExpr('(globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.dataUrl) ?? null');
    if (typeof d === 'string' && d.startsWith('data:image/png')) dataUrl = d;
  }
  ws.close();
  return { dataUrl, pageLog: lastLog };
}

async function main() {
  let vite = null;
  if (await httpOk(LOCAL_URL)) {
    log(`reusing dev server on :${PORT}`);
  } else {
    log(`starting vite on :${PORT}`);
    vite = spawn(`npx vite --host 127.0.0.1 --port ${PORT} --strictPort`, { stdio: 'ignore', shell: true });
    await waitFor(() => httpOk(LOCAL_URL), 80, 'vite dev server');
  }

  const profile = mkdtempSync(join(tmpdir(), 'mx-usd-local-'));
  const chrome = spawn(
    CHROME,
    [
      '--remote-debugging-port=9222',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-webgpu',
      '--headless=new',
      HARNESS_URL,
    ],
    { stdio: 'ignore' },
  );
  try {
    await waitFor(() => httpOk(`${CDP}/json/version`), 80, 'chrome devtools');
    let page;
    await waitFor(async () => {
      const list = await cdpList().catch(() => []);
      page = list.find((t) => typeof t.url === 'string' && t.url.includes(HARNESS_PATH));
      return Boolean(page);
    }, 60, 'harness tab');
    log(`entry: ${ENTRY} @ ${RES}x${RES}, ${SPP} spp`);
    log('rendering USD scene on local GPU...');
    const { dataUrl, pageLog } = await captureViaCdp(page.webSocketDebuggerUrl, ENTRY);
    if (pageLog) {
      log('page log:');
      for (const l of pageLog.split('\n')) if (l.trim()) console.log(`    ${l.trim()}`);
    }
    if (!dataUrl) throw new Error('device did not produce __MX_IMAGE__');
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, Buffer.from(base64, 'base64'));
    log(`saved ${OUT_FILE.pathname}`);
  } finally {
    chrome.kill();
    rmSync(profile, { recursive: true, force: true });
    if (vite) vite.kill();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[usd-image-local] ${err.message}`);
    process.exit(1);
  });
