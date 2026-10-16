// Local-GPU USD image capture: the desktop counterpart of run-usd-image.mjs.
// Serves the USD image harness, launches the workstation Chrome with remote
// debugging, drives the real WebGPU path tracer on the desktop GPU, saves the
// PNG under renders/ and prints the on-page diagnostic log so black-render
// causes (black bake / matLayer / UVs / exposure) are visible without a device.
//
// Usage:  node scripts/run-usd-image-local.mjs [--entry <urlPath>] [--res <n>] [--spp <n>] [--openpbr <mtlx>] [--exposure <EV>] [--firefly <maxLum> (default: 10)] [--sky-power <float>] [--sky-color <r,g,b>] [--cam-back <factor>]
// Env:    MX_CHROME        path to chrome.exe (default: standard Windows install)
//         MX_PORT          dev server port (default 5173)
//         MX_OPENPBR_MTLX  .mtlx to bind to OpenPBRMaterial at runtime (same as --openpbr)
//
// The OpenPBRMaterial override accepts either an absolute served path
// (e.g. /scenes/mtlx-library/surfaces/open_pbr_surface/brushed_metal_anisotropy/
// brushed_metal_anisotropy.mtlx) or a path relative to /scenes/mtlx-library
// (e.g. surfaces/open_pbr_surface/brushed_metal_anisotropy/brushed_metal_anisotropy.mtlx).

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

function parseOptions(argv) {
  const BOOL_FLAGS = new Set();
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument '${token}' (use --option <value>)`);
    const eq = token.indexOf('=');
    if (eq !== -1) {
      opts[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (BOOL_FLAGS.has(key) && (next === undefined || next.startsWith('--'))) {
        opts[key] = true;
        continue;
      }
      if (next === undefined || next.startsWith('--')) throw new Error(`missing value for ${token}`);
      opts[key] = next;
      i++;
    }
  }
  return opts;
}

const OPTIONS = parseOptions(process.argv.slice(2));

const CHROME = process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const ENTRY = OPTIONS.entry ?? '/scenes/standard-shader-ball/standard-shader-ball.usda';
const RES = Number(OPTIONS.res ?? 256);
const SPP = Number(OPTIONS.spp ?? 16);
const FIREFLY = OPTIONS.firefly ?? 10;
const SKY_POWER = OPTIONS['sky-power'] ?? 1;
const SKY_COLOR = OPTIONS['sky-color'] ?? '1,1,1';
const CAM_BACK = OPTIONS['cam-back'] ?? 1.6;
const MTLX_LIBRARY_ROOT = '/scenes/mtlx-library';
const OPENPBR_RAW = (OPTIONS.openpbr ?? process.env.MX_OPENPBR_MTLX)?.replace(/\\/g, '/');
const OPENPBR_MTLX = OPENPBR_RAW
  ? OPENPBR_RAW.startsWith('/')
    ? OPENPBR_RAW
    : `${MTLX_LIBRARY_ROOT}/${OPENPBR_RAW.replace(/^\.?\//, '')}`
  : undefined;
const NAME = (ENTRY.split('/').pop() ?? 'usd-scene').replace(/\.usda?$/, '');
const HARNESS_PATH = '/usd-image-harness.html';
const QUERY =
  `?entry=${encodeURIComponent(ENTRY)}&res=${RES}&spp=${SPP}` +
  (OPENPBR_MTLX ? `&openpbr=${encodeURIComponent(OPENPBR_MTLX)}` : '') +
  (OPTIONS.exposure !== undefined ? `&exposure=${encodeURIComponent(OPTIONS.exposure)}` : '') +
  `&firefly=${encodeURIComponent(FIREFLY)}` +
  (SKY_POWER !== undefined ? `&skyPower=${encodeURIComponent(SKY_POWER)}` : '') +
  (SKY_COLOR !== undefined ? `&skyColor=${encodeURIComponent(SKY_COLOR)}` : '') +
  (CAM_BACK !== undefined ? `&camBack=${encodeURIComponent(CAM_BACK)}` : '') +
  `&_=${Date.now()}`;
const HARNESS_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}${QUERY}`;
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = new URL('../renders/', import.meta.url);
// With an --openpbr override the output is named <category>__<material>.png
// (e.g. gltf_pbr__carpaint.png); otherwise it tracks the USD entry name.
function outputFileName() {
  if (OPENPBR_MTLX) {
    const parts = OPENPBR_MTLX.split('/').filter(Boolean);
    const material = (parts.at(-1) ?? 'material').replace(/\.mtlx$/i, '');
    const category = parts.at(-3) ?? parts.at(-2) ?? 'mtlx';
    return `${category}__${material}.png`;
  }
  return `local-render-${NAME}-usda.png`;
}
const OUT_FILE = new URL(`../renders/${outputFileName()}`, import.meta.url);

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
      return;
    }
    // Surface page console output and runtime errors so a silent crash is visible.
    if (msg.method === 'Runtime.consoleAPICalled') {
      const { type, args } = msg.params ?? {};
      const text = (args ?? [])
        .map((a) => (a.value !== undefined ? a.value : (a.description ?? a.unserializableValue ?? '')))
        .join(' ');
      log(`page console.${type}: ${text}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params?.exceptionDetails;
      const text = d?.exception?.description ?? d?.text ?? 'unknown exception';
      log(`page exception: ${text}`);
    } else if (msg.method === 'Inspector.targetCrashed') {
      log('page target crashed (renderer process gone)');
    }
  });
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP socket error')), { once: true });
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Inspector.enable');
  await send('Page.navigate', { url: HARNESS_URL });
  log('navigated harness tab, waiting for __MX_IMAGE__...');

  const evalExpr = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (res?.result?.exceptionDetails) {
      const d = res.result.exceptionDetails;
      log(`evaluate error: ${d?.exception?.description ?? d?.text ?? 'unknown'}`);
    }
    return res?.result?.result?.value;
  };

  const DEADLINE_MS = 10 * 60 * 1000;
  const started = Date.now();
  let ready = false;
  let failed = false;
  let lastLog = '';
  let polls = 0;
  while (!ready && Date.now() - started < DEADLINE_MS) {
    const raw = await evalExpr(
      "JSON.stringify({ e: (globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.entry) ?? null, failed: ('__MX_IMAGE__' in globalThis) && globalThis.__MX_IMAGE__ === null })",
    );
    let status = null;
    try { status = raw ? JSON.parse(raw) : null; } catch { status = null; }
    const body = (await evalExpr("(document.body && document.body.innerText) || ''")) || '';
    if (body && body !== lastLog) {
      const added = body.startsWith(lastLog) ? body.slice(lastLog.length) : body;
      for (const l of added.split('\n')) if (l.trim()) log(`page: ${l.trim()}`);
      lastLog = body;
    }
    polls += 1;
    if (polls % 10 === 0) {
      const secs = Math.round((Date.now() - started) / 1000);
      log(`still rendering... ${secs}s elapsed, status=${raw ?? 'n/a'}`);
    }
    if (status && status.e === expectedEntry) { ready = true; break; }
    if (status && status.failed) { failed = true; break; }
    await sleep(500);
  }
  const secs = Math.round((Date.now() - started) / 1000);
  if (ready) log(`__MX_IMAGE__ ready after ${secs}s`);
  else if (failed) log(`harness reported failure (__MX_IMAGE__ === null) after ${secs}s`);
  else log(`deadline reached after ${secs}s without a result`);
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
    if (OPENPBR_MTLX) log(`OpenPBRMaterial override: ${OPENPBR_MTLX}`);
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
    // Chrome may still hold the headless profile on Windows (EPERM); never let
    // cleanup throw and mask the real result or fail an otherwise good render.
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch (err) {
      log(`profile cleanup skipped: ${err.code ?? err.message}`);
    }
    if (vite) vite.kill();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[usd-image-local] ${err.message}`);
    process.exit(1);
  });
