// Local-GPU render matrix: renders the four /scenes USD stages with BOTH the
// raster backend and the path tracer in a single headless Chrome session, saves
// one PNG per (scene, backend) under renders/, and prints a timing table so the
// raster vs path-trace cost is visible side by side on the desktop GPU.
//
// Usage:  node scripts/run-usd-matrix-local.mjs [res] [spp]
// Env:    MX_CHROME  path to chrome.exe (default: standard Windows install)
//         MX_PORT    dev server port (default 5173)

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const RES = Number(process.argv[2] ?? 256);
const SPP = Number(process.argv[3] ?? 160);
const HARNESS_PATH = '/usd-image-harness.html';
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = 'http://127.0.0.1:9222';
const OUT_DIR = new URL('../renders/', import.meta.url);

const ALL_SCENES = [
  'test_material_disney_gold',
  'test_material_velvet',
  'test_material_metal_brushed',
  'test_material_brick_procedural',
];
// MX_SCENES=brick,velvet renders only the matching subset (substring match).
const SCENE_FILTER = (process.env.MX_SCENES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SCENES = SCENE_FILTER.length > 0 ? ALL_SCENES.filter((s) => SCENE_FILTER.some((f) => s.includes(f))) : ALL_SCENES;
const BACKENDS = (process.env.MX_BACKENDS ?? 'raster,pathtracing').split(',').map((s) => s.trim()).filter(Boolean);

const log = (m) => console.log(`[usd-matrix-local] ${m}`);

async function httpOk(url) {
  try {
    return (await fetch(url)).ok;
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

function openCdp(wsUrl) {
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
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('CDP socket error')), { once: true });
  });
  return { ws, send, ready };
}

async function renderOne(send, entry, backend) {
  const query = `?entry=${encodeURIComponent(entry)}&res=${RES}&spp=${SPP}&backend=${backend}&_=${Date.now()}`;
  const url = `http://127.0.0.1:${PORT}${HARNESS_PATH}${query}`;
  await send('Page.navigate', { url });
  const evalExpr = async (expression) => {
    const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    return res?.result?.result?.value;
  };
  const DEADLINE_MS = 10 * 60 * 1000;
  const started = Date.now();
  let status = null;
  let lastLog = '';
  let printedLines = 0;
  while (Date.now() - started < DEADLINE_MS) {
    const raw = await evalExpr(
      "JSON.stringify((() => { const i = globalThis.__MX_IMAGE__; return { e: i ? i.entry : null, b: i ? i.backend : null, ms: i ? i.renderMs : null, failed: ('__MX_IMAGE__' in globalThis) && i === null }; })())",
    );
    try {
      status = raw ? JSON.parse(raw) : null;
    } catch {
      status = null;
    }
    lastLog = (await evalExpr("(document.body && document.body.innerText) || ''")) || lastLog;
    if (process.env.MX_VERBOSE) {
      const lines = lastLog.split('\n');
      for (let i = printedLines; i < lines.length; i++) {
        if (lines[i].trim()) console.log(`    [live] ${lines[i].trim()}`);
      }
      printedLines = lines.length;
    }
    if (status && status.e === entry && status.b === backend) break;
    if (status && status.failed) break;
    await sleep(500);
  }
  let dataUrl = null;
  if (status && status.e === entry && status.b === backend) {
    const d = await evalExpr('(globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.dataUrl) ?? null');
    if (typeof d === 'string' && d.startsWith('data:image/png')) dataUrl = d;
  }
  return { dataUrl, renderMs: status?.ms ?? null, pageLog: lastLog };
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

  const profile = mkdtempSync(join(tmpdir(), 'mx-usd-matrix-'));
  const chrome = spawn(
    CHROME,
    [
      '--remote-debugging-port=9222',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-webgpu',
      '--headless=new',
      LOCAL_URL,
    ],
    { stdio: 'ignore' },
  );
  const results = [];
  try {
    await waitFor(() => httpOk(`${CDP}/json/version`), 80, 'chrome devtools');
    let page;
    await waitFor(async () => {
      const list = await cdpList().catch(() => []);
      page = list.find((t) => typeof t.url === 'string' && t.url.includes(HARNESS_PATH));
      return Boolean(page);
    }, 60, 'harness tab');

    const { ws, send, ready } = openCdp(page.webSocketDebuggerUrl);
    await ready;
    await send('Runtime.enable');
    await send('Page.enable');

    mkdirSync(OUT_DIR, { recursive: true });
    for (const name of SCENES) {
      const entry = `/scenes/${name}/${name}.usda`;
      for (const backend of BACKENDS) {
        log(`rendering ${name} [${backend}] @ ${RES}x${RES}${backend === 'pathtracing' ? `, ${SPP} spp` : ''}...`);
        const { dataUrl, renderMs, pageLog } = await renderOne(send, entry, backend);
        if (process.env.MX_VERBOSE && pageLog) {
          for (const l of pageLog.split('\n')) if (l.trim()) console.log(`    ${l.trim()}`);
        }
        if (!dataUrl) {
          log(`  FAILED (no image)`);
          if (pageLog) for (const l of pageLog.split('\n')) if (l.trim()) console.log(`    ${l.trim()}`);
          results.push({ name, backend, renderMs: null, file: null });
          continue;
        }
        const file = new URL(`../renders/local-${name}-${backend}.png`, import.meta.url);
        writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
        log(`  saved renders/local-${name}-${backend}.png (${renderMs != null ? renderMs.toFixed(0) : '?'} ms)`);
        results.push({ name, backend, renderMs, file: `renders/local-${name}-${backend}.png` });
      }
    }
    ws.close();
  } finally {
    chrome.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Chrome may still hold the temp profile on Windows; cleanup is best-effort.
    }
    if (vite) vite.kill();
  }

  // Timing table: scene rows, raster vs path-trace columns (milliseconds).
  console.log('\n=== Temps de rendu (ms) ===');
  const col = (v) => (v == null ? '   n/a' : v.toFixed(0).padStart(6));
  console.log(`${'scene'.padEnd(30)} ${'raster'.padStart(8)} ${'pathtrace'.padStart(10)}`);
  for (const name of SCENES) {
    const r = results.find((x) => x.name === name && x.backend === 'raster');
    const p = results.find((x) => x.name === name && x.backend === 'pathtracing');
    console.log(`${name.padEnd(30)} ${col(r?.renderMs)}   ${col(p?.renderMs)}`);
  }
  console.log(`\n(${RES}x${RES}, path tracer ${SPP} spp)`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[usd-matrix-local] ${err.message}`);
    process.exit(1);
  });
