// Re-run every render test of the standard-shader-ball USD scene on the local GPU
// (headless Chrome) or on the connected mobile (Chrome over ADB): raster and path
// tracing, optionally with OpenPBRMaterial overrides taken from scenes/mtlx-library.
// Each case drives usd-image-harness.html, saves a PNG and is checked for failure
// or an (almost) black image; a JSON report summarizes the run.
//
// Usage: npm run test:shaderball -- [--entry /scenes/.../scene.usda] [--target mobile|local] [--backends raster,pathtracing]
//          [--materials <filter>|all] [--res N] [--spp N] [--timeout ms] [--port N]
//          [--device serial] [--out-dir renders/shaderball] [--list]

import { execFile, spawn } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { readdirSync, mkdirSync, writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_ENTRY = '/scenes/standard-shader-ball/standard-shader-ball.usda';
const LIBRARY = join(ROOT, 'scenes', 'mtlx-library');
const HARNESS = '/usd-image-harness.html';
const exec = promisify(execFile);
const log = (message) => console.log(`[shaderball] ${message}`);

function findMaterials(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findMaterials(path);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.mtlx') ? [path] : [];
  });
}

async function waitFor(action, label, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await action();
    if (result) return result;
    await sleep(250);
  }
  throw new Error(`Timed out: ${label}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const response = JSON.parse(event.data);
    const request = pending.get(response.id);
    if (!request) return;
    pending.delete(response.id);
    clearTimeout(request.timer);
    if (response.error) request.reject(new Error(response.error.message));
    else request.resolve(response.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('CDP connection closed'));
    }
    pending.clear();
  });
  await new Promise((resolveOpen, reject) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => reject(new Error(`Cannot connect to CDP websocket: ${url}`)), { once: true });
  });
  const send = (method, params = {}, timeout = 60000) => new Promise((resolveRequest, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection closed')); return; }
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeout);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  return { socket, send, evaluate };
}

function caseName(override, backend) {
  const material = override ? override.replace(/^\/scenes\/mtlx-library\//, '').replace(/\.mtlx$/i, '').replaceAll('/', '__') : 'scene';
  return `${material}__${backend}`;
}

async function renderCase(cdp, origin, { backend, override }, values) {
  const query = new URLSearchParams({ entry: values.entry, res: values.res, spp: values.spp, backend, _: String(Date.now()) });
  if (override) query.set('openpbr', override);
  const url = `${origin}${HARNESS}?${query}`;
  await cdp.send('Page.navigate', { url });
  const expected = JSON.stringify({ e: values.entry, b: backend, o: override ?? null });
  const started = Date.now();
  let pageLog = '';
  while (Date.now() - started < Number(values.timeout)) {
    await sleep(500);
    let state;
    try {
      state = await cdp.evaluate(`JSON.stringify((() => { const i = globalThis.__MX_IMAGE__;
        return { key: i ? JSON.stringify({ e: i.entry, b: i.backend, o: i.materialOverride ?? null }) : null,
          failed: ('__MX_IMAGE__' in globalThis) && i === null, href: location.href, log: document.body ? document.body.innerText : '' }; })())`);
    } catch (error) {
      if (/context|navigat/i.test(error.message)) continue;
      throw error;
    }
    const status = JSON.parse(state);
    if (status.href !== url) continue;
    pageLog = status.log;
    if (status.failed) return { status: 'failed', reason: lastLines(pageLog) };
    if (/diag device lost/i.test(pageLog)) return { status: 'failed', reason: `GPU device lost: ${lastLines(pageLog, 2)}` };
    if (status.key === expected) {
      const image = await cdp.evaluate('JSON.stringify({ dataUrl: __MX_IMAGE__.dataUrl, renderMs: __MX_IMAGE__.renderMs, stats: __MX_IMAGE__.stats })');
      return { status: 'rendered', ...JSON.parse(image), pageLog };
    }
  }
  return { status: 'failed', reason: `timeout after ${values.timeout} ms; ${lastLines(pageLog)}` };
}

function lastLines(text, count = 4) {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-count).join(' | ');
}

// Failures caused by the browser, tab, GPU device or ADB link rather than the material.
const INFRA_FAILURE = /CDP (connection closed|timeout)|Cannot connect|Target closed|crash|device lost|timeout after|ECONNRESET|fetch failed/i;

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    list: { type: 'boolean' },
    resume: { type: 'boolean' },
    entry: { type: 'string', default: DEFAULT_ENTRY },
    target: { type: 'string', default: 'local' },
    backends: { type: 'string', default: 'raster,pathtracing' },
    materials: { type: 'string', default: 'all' },
    res: { type: 'string', default: '256' },
    spp: { type: 'string', default: '16' },
    timeout: { type: 'string', default: '600000' },
    port: { type: 'string', default: '5176' },
    device: { type: 'string' },
    'out-dir': { type: 'string', default: 'renders/shaderball' },
    'black-threshold': { type: 'string', default: '0.02' },
    'max-recoveries': { type: 'string', default: '20' },
  } });
  if (values.help) {
    console.log('npm run test:shaderball -- [--entry /scenes/.../scene.usda] [--target mobile|local] [--backends raster,pathtracing] [--materials <filter>|all] [--res N] [--spp N] [--timeout ms] [--port N] [--device serial] [--out-dir dir] [--black-threshold fraction] [--max-recoveries N] [--resume] [--list]');
    return;
  }
  if (!['mobile', 'local'].includes(values.target)) throw new Error('--target must be mobile or local');
  values.entry = values.entry.replaceAll('\\', '/');
  if (!values.entry.startsWith('/scenes/') || !/\.usda?$/i.test(values.entry) || values.entry.split('/').includes('..')) {
    throw new Error('--entry must be a workspace USDA URL path under /scenes/');
  }
  const backends = values.backends.split(',').map((backend) => backend.trim()).filter(Boolean);
  if (backends.length === 0 || backends.some((backend) => !['raster', 'pathtracing'].includes(backend))) throw new Error('--backends accepts raster and/or pathtracing');

  const overrides = [];
  if (values.materials) {
    const filter = values.materials === 'all' ? '' : values.materials.replaceAll('\\', '/').toLowerCase();
    const library = findMaterials(LIBRARY).map((file) => '/' + relative(ROOT, file).split(sep).join('/'));
    overrides.push(...library.filter((file) => file.toLowerCase().includes(filter)));
  }
  if (overrides.length === 0) throw new Error(`No .mtlx in scenes/mtlx-library matches '${values.materials}'`);
  const cases = overrides.flatMap((override) => backends.map((backend) => ({ backend, override })));
  if (values.list) {
    for (const item of cases) console.log(caseName(item.override, item.backend));
    log(`${cases.length} render cases for ${values.entry}`);
    return;
  }

  const sceneName = values.entry === DEFAULT_ENTRY ? undefined : values.entry.split('/').at(-1).replace(/\.usda?$/i, '');
  const outDir = resolve(ROOT, values['out-dir'], ...(sceneName ? [sceneName] : []), values.target);
  mkdirSync(outDir, { recursive: true });
  const reportFile = join(outDir, 'report.json');
  const report = { startedAt: new Date().toISOString(), target: values.target, entry: values.entry, res: Number(values.res), spp: Number(values.spp), cases: [] };
  if (values.resume) {
    if (!existsSync(reportFile)) throw new Error(`--resume: no report at ${relative(ROOT, reportFile)}`);
    const previous = JSON.parse(readFileSync(reportFile, 'utf8'));
    if (previous.entry !== report.entry) {
      throw new Error(`--resume requires the same --entry as the saved report (${previous.entry})`);
    }
    if (previous.res !== report.res || previous.spp !== report.spp) {
      throw new Error(`--resume requires the same --res/--spp as the saved report (${previous.res}/${previous.spp})`);
    }
    // Failed cases are dropped so they are rendered again.
    const wanted = new Set(cases.map((item) => caseName(item.override, item.backend)));
    report.startedAt = previous.startedAt;
    report.resumedAt = new Date().toISOString();
    report.cases = previous.cases.filter((entry) => wanted.has(entry.name) && entry.status !== 'failed');
  }
  const done = new Set(report.cases.map((entry) => entry.name));
  const saveReport = () => {
    report.summary = { ok: 0, black: 0, failed: 0 };
    for (const entry of report.cases) report.summary[entry.status]++;
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
  };
  const adbPath = process.env.MX_ADB ?? 'D:\\platform-tools\\adb.exe';
  const serial = values.device ?? process.env.MX_DEVICE;
  const adb = async (...command) => (await exec(adbPath, [...(serial ? ['-s', serial] : []), ...command])).stdout.trim();

  let server, chrome, profile, cdp, forwardPort, reversePort;
  try {
    server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { host: '127.0.0.1', port: Number(values.port), strictPort: false, open: false, hmr: false } });
    await server.listen();
    const port = server.httpServer.address().port;
    const origin = `http://${values.target === 'mobile' ? 'localhost' : '127.0.0.1'}:${port}`;
    const startUrl = `${origin}${HARNESS}?entry=${encodeURIComponent(values.entry)}&res=16&spp=1&backend=raster`;
    let debugPort;
    const chromePath = process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    const launchBrowser = async () => {
      if (values.target === 'mobile') {
        await waitFor(async () => (await adb('get-state').catch(() => '')) === 'device', 'mobile reconnection (ADB)', 120000);
        await adb('reverse', `tcp:${port}`, `tcp:${port}`);
        reversePort = port;
        if (forwardPort) await adb('forward', '--remove', `tcp:${forwardPort}`).catch(() => {});
        debugPort = Number(await adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote'));
        forwardPort = debugPort;
        await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${startUrl}'`, 'com.android.chrome');
        return;
      }
      if (chrome && chrome.exitCode === null) {
        chrome.kill();
        await new Promise((resolveClose) => chrome.once('close', resolveClose));
      }
      if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      profile = mkdtempSync(join(tmpdir(), 'mx-shaderball-'));
      chrome = spawn(chromePath, [
        '--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, startUrl,
      ], { stdio: 'ignore' });
      debugPort = await waitFor(() => {
        const file = join(profile, 'DevToolsActivePort');
        return existsSync(file) ? Number(readFileSync(file, 'utf8').split('\n')[0]) : null;
      }, 'local Chrome');
    };
    const listPages = () => fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json()).catch(() => []);
    const attach = async () => {
      let page = (await listPages()).find((entry) => entry.type === 'page' && entry.url?.includes(HARNESS));
      if (!page) {
        log('harness tab missing; reopening it');
        if (values.target === 'mobile') await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${startUrl}'`, 'com.android.chrome');
        else await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(startUrl)}`, { method: 'PUT' });
        page = await waitFor(async () => (await listPages()).find((entry) => entry.type === 'page' && entry.url?.includes(HARNESS)),
          'harness tab (keep the phone unlocked)', 60000);
      }
      cdp?.socket.close();
      cdp = await connect(page.webSocketDebuggerUrl);
      await cdp.send('Page.enable');
      await cdp.send('Runtime.enable');
    };
    let recoveries = 0;
    const recover = async (reason) => {
      if (++recoveries > Number(values['max-recoveries'])) throw new Error(`Too many recoveries (${recoveries - 1}); last cause: ${reason}`);
      log(`recovering (${recoveries}) after: ${reason}`);
      cdp?.socket.close();
      cdp = undefined;
      const browserGone = values.target === 'mobile'
        ? (await adb('get-state').catch(() => '')) !== 'device' || (await listPages()).length === 0
        : chrome.exitCode !== null || (await listPages()).length === 0;
      if (browserGone) await launchBrowser();
      await attach();
    };
    if (values.target === 'mobile') {
      const devices = (await exec(adbPath, ['devices'])).stdout.split('\n').slice(1).filter((line) => /\tdevice\s*$/.test(line.trim()));
      if (devices.length === 0) throw new Error('No authorized mobile connected (use --target local).');
      if (!serial && devices.length > 1) throw new Error('Several mobiles connected: use --device serial.');
      report.device = serial ?? devices[0].split('\t')[0];
    }
    await launchBrowser();
    await waitFor(async () => (await listPages()).some((entry) => entry.type === 'page' && entry.url?.includes(HARNESS)),
      'harness tab (keep the phone unlocked)', 60000);
    await attach();
    log(`${values.target}${report.device ? ` (${report.device})` : ''}: ${cases.length} render cases -> ${relative(ROOT, outDir)}`);
    if (values.resume) log(`resuming: ${done.size} saved results kept, ${cases.length - done.size} cases to render`);

    for (const [index, item] of cases.entries()) {
      const name = caseName(item.override, item.backend);
      if (done.has(name)) continue;
      let result;
      for (let attempt = 1; ; attempt++) {
        try {
          result = await renderCase(cdp, origin, item, values);
        } catch (error) {
          result = { status: 'failed', reason: String(error) };
        }
        if (result.status !== 'failed' || !INFRA_FAILURE.test(result.reason ?? '')) break;
        await recover(`${name}: ${result.reason}`);
        if (attempt >= 2) {
          result.reason = `${result.reason} (after retry)`;
          break;
        }
      }
      const entry = { name, backend: item.backend, override: item.override ?? null, status: result.status };
      if (result.status === 'rendered') {
        const file = join(outDir, `${name}.png`);
        writeFileSync(file, Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64'));
        entry.file = relative(ROOT, file).split(sep).join('/');
        entry.renderMs = Math.round(result.renderMs);
        entry.stats = result.stats;
        entry.status = result.stats.litFraction < Number(values['black-threshold']) ? 'black' : 'ok';
        if (entry.status === 'black') entry.reason = lastLines(result.pageLog, 6);
      } else {
        entry.reason = result.reason;
      }
      report.cases.push(entry);
      saveReport();
      const detail = entry.status === 'ok' || entry.status === 'black'
        ? `${entry.renderMs} ms, lit ${(entry.stats.litFraction * 100).toFixed(1)}%`
        : entry.reason;
      log(`${index + 1}/${cases.length} ${entry.status}: ${name} (${detail})`);
    }
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    saveReport();
    log(`summary: ${JSON.stringify(report.summary)}; report ${relative(ROOT, reportFile)}`);
    process.exitCode = report.error || report.summary.black || report.summary.failed ? 1 : 0;
    cdp?.socket.close();
    if (reversePort) await adb('reverse', '--remove', `tcp:${reversePort}`).catch(() => {});
    if (forwardPort) await adb('forward', '--remove', `tcp:${forwardPort}`).catch(() => {});
    if (chrome) {
      chrome.kill();
      await new Promise((done) => { if (chrome.exitCode !== null) done(); else chrome.once('close', done); });
    }
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await server?.close();
  }
}

main().catch((error) => {
  console.error(`[shaderball] ${error.message}`);
  process.exitCode = 1;
});
