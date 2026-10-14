// T059d orchestration: render every bxdf-family case on the connected mobile GPU
// (Adreno 7xx target) in BOTH backends through the shared compiler output, and
// compare against the CPU oracle. Mobile counterpart of scripts/run-local-bxdf.mjs:
//   serve harness -> adb reverse -> launch Chrome -> CDP reload -> poll global
//   -> write tests/render/bxdf-device-report.json -> delegate to the vitest suite
//   (tests/render/bxdf-device.test.ts, mobile per-family tolerances via the Adreno
//   adapter). Skips cleanly (empty report) if no authorized device.
//
// Usage:  npm run test:bxdf-device
// Env:    MX_ADB   path to adb (default D:\platform-tools\adb.exe)
//         MX_PORT  dev server port (default 5173)

import { spawn, execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ADB = process.env.MX_ADB ?? 'D:\\platform-tools\\adb.exe';
const PORT = Number(process.env.MX_PORT ?? 5173);
const HARNESS_PATH = '/bxdf-device-harness.html';
const HARNESS_URL = `http://localhost:${PORT}${HARNESS_PATH}`;
const LOCAL_URL = `http://127.0.0.1:${PORT}${HARNESS_PATH}`;
const CDP = 'http://127.0.0.1:9222';
const REPORT_OUT = new URL('../tests/render/bxdf-device-report.json', import.meta.url);
const EMPTY = { userAgent: '', adapter: {}, geomCount: 0, cases: [] };

const log = (m) => console.log(`[bxdf-device] ${m}`);

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
  if (!raw) throw new Error('device did not produce __MX_BXDF_REPORT__');
  return JSON.parse(raw);
}

function runVitest() {
  return new Promise((resolve) => {
    const child = spawn('npx vitest run tests/render/bxdf-device.test.ts', { stdio: 'inherit', shell: true });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function main() {
  const devices = await adb(['devices']);
  const connected = devices.split('\n').slice(1).filter((l) => l.trim().endsWith('device'));
  if (connected.length === 0) {
    log('no authorized device; writing empty report so the suite skips cleanly.');
    writeFileSync(REPORT_OUT, JSON.stringify(EMPTY, null, 2) + '\n');
    return runVitest();
  }
  log(`device: ${connected[0].split('\t')[0]}`);

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
    await adb(['shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', HARNESS_URL, 'com.android.chrome']);

    let page;
    await waitFor(async () => {
      const list = await cdpList().catch(() => []);
      page = list.find((t) => typeof t.url === 'string' && t.url.endsWith(HARNESS_PATH));
      return Boolean(page);
    }, 60, 'harness tab on device');
    log('rendering bxdf families on device GPU (two backends)...');
    const report = await fetchReportViaCdp(page.webSocketDebuggerUrl);

    writeFileSync(REPORT_OUT, JSON.stringify(report, null, 2) + '\n');
    log(`adapter: ${JSON.stringify(report.adapter)}`);
    log(`userAgent: ${report.userAgent}`);
    log(`${report.cases.length} families, ${report.geomCount} frames each`);

    log('running oracle assertions...');
    return await runVitest();
  } finally {
    await adb(['reverse', '--remove', `tcp:${PORT}`]).catch(() => {});
    await adb(['forward', '--remove', 'tcp:9222']).catch(() => {});
    if (vite) vite.kill();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[bxdf-device] ${err.message}`);
    process.exit(1);
  });
