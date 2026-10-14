// T059c local-GPU bxdf-family run: the local-workstation counterpart of
// scripts/run-scene-device.mjs, specialised to the BxDF coverage harness. It
// serves bxdf-device-harness.html, launches the dev-workstation Chrome with remote
// debugging + WebGPU, collects __MX_BXDF_REPORT__ over CDP (every T059a family
// shaded in BOTH backends through the shared compiler output), writes
// tests/render/bxdf-device-report.json and delegates the oracle assertions to the
// vitest suite (tests/render/bxdf-device.test.ts). This validates the full BxDF
// coverage on a real desktop GPU against the analytic oracle before the mobile run
// (T059d). Commit the produced report so CI replays the device evidence.
//
// Usage:  npm run test:local-bxdf
// Env:    MX_CHROME  path to chrome.exe (default: standard Windows install)
//         MX_PORT    dev server port (default 5173)

import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME =
  process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const HARNESS_PATH = '/bxdf-device-harness.html';
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = 'http://127.0.0.1:9222';
const REPORT_OUT = new URL('../tests/render/bxdf-device-report.json', import.meta.url);

const log = (m) => console.log(`[local-bxdf] ${m}`);

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

async function fetchReportViaCdp(wsUrl) {
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
  let raw = null;
  for (let i = 0; i < 2000 && !raw; i++) {
    const v = await evalExpr('JSON.stringify(globalThis.__MX_BXDF_REPORT__ ?? null)');
    if (typeof v === 'string' && v !== 'null') raw = v;
    else await sleep(50);
  }
  ws.close();
  if (!raw) throw new Error('browser did not produce __MX_BXDF_REPORT__');
  return JSON.parse(raw);
}

function runVitest() {
  return new Promise((resolve) => {
    const child = spawn('npx vitest run tests/render/bxdf-device.test.ts', {
      stdio: 'inherit',
      shell: true,
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  // 1. Serve the harness (reuse an existing dev server if one is already up).
  let vite = null;
  if (await httpOk(LOCAL_URL)) {
    log(`reusing dev server on :${PORT}`);
  } else {
    log(`starting vite on :${PORT}`);
    vite = spawn(`npx vite --host 127.0.0.1 --port ${PORT} --strictPort`, {
      stdio: 'ignore',
      shell: true,
    });
    await waitFor(() => httpOk(LOCAL_URL), 80, 'vite dev server');
  }

  // 2. Launch the dev-workstation Chrome with remote debugging on the harness URL.
  const profile = mkdtempSync(join(tmpdir(), 'mx-local-bxdf-'));
  const chrome = spawn(
    CHROME,
    [
      '--remote-debugging-port=9222',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--enable-unsafe-webgpu',
      '--new-window',
      LOCAL_URL,
    ],
    { stdio: 'ignore' },
  );

  try {
    // 3. Find the harness tab, reload it and collect the report.
    let page;
    await waitFor(async () => {
      const list = await cdpList().catch(() => []);
      page = list.find((t) => typeof t.url === 'string' && t.url.endsWith(HARNESS_PATH));
      return Boolean(page);
    }, 80, 'harness tab in local Chrome');
    log('rendering bxdf families on the local GPU (two backends)...');
    const report = await fetchReportViaCdp(page.webSocketDebuggerUrl);

    // 4. Persist + summary.
    writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2) + '\n');
    log(`adapter: ${JSON.stringify(report.adapter)}`);
    log(`userAgent: ${report.userAgent}`);
    log(`${report.cases.length} families, ${report.geomCount} frames each`);

    // 5. Oracle assertions (shared with CI) via the vitest suite.
    log('running oracle assertions...');
    return await runVitest();
  } finally {
    chrome.kill();
    if (vite) vite.kill();
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* ignore profile cleanup races */
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[local-bxdf] ${err.message}`);
    process.exit(1);
  });
