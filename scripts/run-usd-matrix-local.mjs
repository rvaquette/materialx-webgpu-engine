// Local-GPU render matrix: renders the four /scenes USD stages with BOTH the
// raster backend and the path tracer in a single headless Chrome session, saves
// one PNG per (scene, backend) under renders/, and prints a timing table so the
// raster vs path-trace cost is visible side by side on the desktop GPU.
//
// Usage:  node scripts/run-usd-matrix-local.mjs [res] [spp]
// Env:    MX_CHROME  path to chrome.exe (default: standard Windows install)
//         MX_PORT    dev server port (default 5173)
//         MX_CDP_PORT desktop Chrome debugging port (default 9222)
//         MX_ENTRIES comma-separated scene URLs (overrides the built-in matrix)
//         MX_MAX_DEPTH optional 1..64 depth override; saves HDR benchmark JSON
//         MX_TILE_SPP samples per dispatch (default 1)
//         MX_OUTPUT_TAG optional filename tag for comparison runs

import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const RES = Number(process.argv[2] ?? 256);
const SPP = Number(process.argv[3] ?? 160);
const TILE_SPP = Number(process.env.MX_TILE_SPP ?? 1);
if (!Number.isInteger(TILE_SPP) || TILE_SPP < 1) throw new Error('MX_TILE_SPP must be a positive integer');
const MAX_DEPTH = process.env.MX_MAX_DEPTH !== undefined ? Number(process.env.MX_MAX_DEPTH) : undefined;
if (MAX_DEPTH !== undefined && (!Number.isInteger(MAX_DEPTH) || MAX_DEPTH < 1 || MAX_DEPTH > 64)) {
  throw new Error('MX_MAX_DEPTH must be an integer from 1 to 64');
}
const CDP_PORT = Number(process.env.MX_CDP_PORT ?? 9222);
const OUTPUT_TAG = process.env.MX_OUTPUT_TAG ?? '';
if (OUTPUT_TAG && !/^[a-zA-Z0-9_-]+$/.test(OUTPUT_TAG)) throw new Error('MX_OUTPUT_TAG must be a filename-safe identifier');
const HARNESS_PATH = '/usd-image-harness.html';
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
const OUT_DIR = new URL('../renders/', import.meta.url);

const ALL_SCENES = [
  'test_material_disney_gold',
  'test_material_velvet',
  'test_material_metal_brushed',
  'test_material_brick_procedural',
  'test_material_brick_metal_mix',
];
// MX_SCENES=brick,velvet renders only the matching subset (substring match).
const SCENE_FILTER = (process.env.MX_SCENES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const CUSTOM_ENTRIES = (process.env.MX_ENTRIES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SCENES = CUSTOM_ENTRIES.length > 0
  ? CUSTOM_ENTRIES.map((entry) => ({ name: entry.split('/').pop().replace(/\.[^.]+$/, ''), entry }))
  : (SCENE_FILTER.length > 0 ? ALL_SCENES.filter((s) => SCENE_FILTER.some((f) => s.includes(f))) : ALL_SCENES)
    .map((name) => ({ name, entry: `/scenes/${name}/${name}.usda` }));
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
  const query = `?entry=${encodeURIComponent(entry)}&res=${RES}&spp=${SPP}&tileSpp=${TILE_SPP}&backend=${backend}&_=${Date.now()}`
    + (MAX_DEPTH !== undefined ? `&maxDepth=${MAX_DEPTH}&benchmark=1` : '');
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
  const matches = (value) => value?.e === entry && value.b === backend && value.url === url
    && value.width === RES && value.height === RES && value.samples === (backend === 'raster' ? 1 : SPP)
    && (MAX_DEPTH === undefined || value.depth === MAX_DEPTH);
  while (Date.now() - started < DEADLINE_MS) {
    const raw = await evalExpr(
      "JSON.stringify((() => { const i = globalThis.__MX_IMAGE__; return { e: i ? i.entry : null, b: i ? i.backend : null, ms: i ? i.renderMs : null, url: location.href, width: i?.width, height: i?.height, samples: i?.samples, depth: i?.benchmark?.sceneMetadata?.maxDepth, failed: ('__MX_IMAGE__' in globalThis) && i === null }; })())",
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
    if (matches(status)) break;
    if (status && status.failed) break;
    await sleep(500);
  }
  let dataUrl = null;
  if (matches(status)) {
    const d = await evalExpr('(globalThis.__MX_IMAGE__ && globalThis.__MX_IMAGE__.dataUrl) ?? null');
    if (typeof d === 'string' && d.startsWith('data:image/png')) dataUrl = d;
  }
  const benchmark = dataUrl && MAX_DEPTH !== undefined
    ? await evalExpr('globalThis.__MX_IMAGE__?.benchmark ?? null') : null;
  return { dataUrl, renderMs: status?.ms ?? null, pageLog: lastLog, benchmark };
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
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-webgpu',
      '--headless=new',
      `${LOCAL_URL}?session=1`,
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
    for (const { name, entry } of SCENES) {
      for (const backend of BACKENDS) {
        log(`rendering ${name} [${backend}] @ ${RES}x${RES}${backend === 'pathtracing' ? `, ${SPP} spp` : ''}...`);
        const { dataUrl, renderMs, pageLog, benchmark } = await renderOne(send, entry, backend);
        if (process.env.MX_VERBOSE && pageLog) {
          for (const l of pageLog.split('\n')) if (l.trim()) console.log(`    ${l.trim()}`);
        }
        if (!dataUrl) {
          log(`  FAILED (no image)`);
          if (pageLog) for (const l of pageLog.split('\n')) if (l.trim()) console.log(`    ${l.trim()}`);
          results.push({ name, backend, renderMs: null, file: null });
          continue;
        }
        const suffix = MAX_DEPTH !== undefined ? `-depth${MAX_DEPTH}` : '';
        const stem = `local-${name}-${backend}${suffix}${OUTPUT_TAG ? `-${OUTPUT_TAG}` : ''}`;
        const file = new URL(`../renders/${stem}.png`, import.meta.url);
        writeFileSync(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'));
        if (MAX_DEPTH !== undefined) {
          if (benchmark?.sceneMetadata?.maxDepth !== MAX_DEPTH) throw new Error('Missing or mismatched depth benchmark');
          writeFileSync(new URL(`../renders/${stem}.json`, import.meta.url),
            JSON.stringify({ entry, backend, res: RES, spp: SPP, maxDepth: MAX_DEPTH, renderMs, benchmark }, null, 2));
        }
        log(`  saved renders/${stem}.png (${renderMs != null ? renderMs.toFixed(0) : '?'} ms)`);
        results.push({ name, backend, renderMs, file: `renders/${stem}.png` });
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
  for (const { name } of SCENES) {
    const r = results.find((x) => x.name === name && x.backend === 'raster');
    const p = results.find((x) => x.name === name && x.backend === 'pathtracing');
    console.log(`${name.padEnd(30)} ${col(r?.renderMs)}   ${col(p?.renderMs)}`);
  }
  console.log(`\n(${RES}x${RES}, path tracer ${SPP} spp)`);
  if (results.some(result => !result.file)) throw new Error('One or more local renders failed');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(`[usd-matrix-local] ${err.message}`);
    process.exit(1);
  });
