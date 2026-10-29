// Re-run every render test of the standard-shader-ball USD scene on the local GPU
// (headless Chrome) or on the connected mobile (Chrome over ADB): raster and path
// tracing, preserving authored materials unless --materials explicitly selects
// OpenPBRMaterial overrides taken from scenes/mtlx-library.
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
import { createShaderballStaticServer } from './shaderball-static-server.mjs';
import { formatTimingTable } from './shaderball-timing-table.mjs';
import { sampleCpuMemory } from './shaderball-cpu-memory.mjs';
import { displayShaderball, displayUrls } from './shaderball-display.mjs';

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
  const url = `${origin}${HARNESS}?session=1`;
  const expected = JSON.stringify({ e: values.entry, b: backend, o: override ?? null });
  const started = performance.now();
  if (!await cdp.evaluate("typeof globalThis.__MX_RENDER__ === 'function'")) {
    await cdp.send('Page.navigate', { url });
    await waitFor(async () => {
      try { return await cdp.evaluate("typeof globalThis.__MX_RENDER__ === 'function'"); }
      catch (error) {
        if (/context|navigat/i.test(error.message)) return false;
        throw error;
      }
    }, 'persistent render session', Number(values.timeout));
  }
  await cdp.evaluate(`void globalThis.__MX_RENDER__(${JSON.stringify(query.toString())})`);
  let pageLog = '';
  while (performance.now() - started < Number(values.timeout)) {
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
      const transferStarted = performance.now();
      const image = await cdp.evaluate('JSON.stringify({ dataUrl: __MX_IMAGE__.dataUrl, renderMs: __MX_IMAGE__.renderMs, stats: __MX_IMAGE__.stats, timings: __MX_IMAGE__.timings, memory: __MX_IMAGE__.memory, sessionCache: __MX_IMAGE__.sessionCache })');
      return { status: 'rendered', ...JSON.parse(image), pageLog,
        transferMs: performance.now() - transferStarted, caseMs: performance.now() - started };
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
  const commandStarted = performance.now();
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    list: { type: 'boolean' },
    resume: { type: 'boolean' },
    headed: { type: 'boolean' },
    integrated: { type: 'boolean' },
    entry: { type: 'string', default: DEFAULT_ENTRY },
    target: { type: 'string', default: 'local' },
    server: { type: 'string', default: 'vite' },
    backends: { type: 'string', default: 'raster,pathtracing' },
    materials: { type: 'string' },
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
    console.log('--headed: visible Chrome, no captures/report. --integrated: print URLs for VS Code, no Chrome/CDP or captures/report. Both keep the server alive until Ctrl+C.');
    console.log('--server vite|static (default vite). Static mode requires npm run build:shaderball.');
    console.log('npm run test:shaderball -- [--entry /scenes/.../scene.usda] [--target mobile|local] [--backends raster,pathtracing] [--materials <filter>|all] [--res N] [--spp N] [--timeout ms] [--port N] [--device serial] [--out-dir dir] [--black-threshold fraction] [--max-recoveries N] [--resume] [--list]');
    console.log('Without --materials, render only the scene with its authored materials and bindings (no override).');
    return;
  }
  if (!['mobile', 'local'].includes(values.target)) throw new Error('--target must be mobile or local');
  if (!['vite', 'static'].includes(values.server)) throw new Error('--server must be vite or static');
  const displayMode = values.headed || values.integrated;
  if (displayMode && ![256, 512, 1024].includes(Number(values.res))) throw new Error('Interactive --res must be 256, 512 or 1024');
  if (values.headed && values.integrated) throw new Error('--headed and --integrated are mutually exclusive');
  if (displayMode && values.target !== 'local') throw new Error('--headed/--integrated require --target local');
  if (displayMode && values.resume) throw new Error('--resume is unavailable without captures/reports');
  values.entry = values.entry.replaceAll('\\', '/');
  if (!values.entry.startsWith('/scenes/') || !/\.usda?$/i.test(values.entry) || values.entry.split('/').includes('..')) {
    throw new Error('--entry must be a workspace USDA URL path under /scenes/');
  }
  const backends = values.backends.split(',').map((backend) => backend.trim()).filter(Boolean);
  if (backends.length === 0 || backends.some((backend) => !['raster', 'pathtracing'].includes(backend))) throw new Error('--backends accepts raster and/or pathtracing');

  const overrides = [];
  if (values.materials !== undefined) {
    if (!values.materials.trim()) throw new Error('--materials requires a non-empty filter or all');
    const filter = values.materials === 'all' ? '' : values.materials.replaceAll('\\', '/').toLowerCase();
    const library = findMaterials(LIBRARY).map((file) => '/' + relative(ROOT, file).split(sep).join('/'));
    overrides.push(...library.filter((file) => file.toLowerCase().includes(filter)));
    if (overrides.length === 0) throw new Error(`No .mtlx in scenes/mtlx-library matches '${values.materials}'`);
  } else {
    overrides.push(undefined);
  }
  const cases = overrides.flatMap((override) => backends.map((backend) => ({ backend, override })));
  if (values.list) {
    for (const item of cases) console.log(caseName(item.override, item.backend));
    log(`${cases.length} render cases for ${values.entry}`);
    return;
  }

  const sceneName = values.entry === DEFAULT_ENTRY ? undefined : values.entry.split('/').at(-1).replace(/\.usda?$/i, '');
  const outDir = resolve(ROOT, values['out-dir'], ...(sceneName ? [sceneName] : []), values.target);
  if (!displayMode) mkdirSync(outDir, { recursive: true });
  const reportFile = join(outDir, 'report.json');
  const report = { startedAt: new Date().toISOString(), target: values.target, entry: values.entry, res: Number(values.res), spp: Number(values.spp), cases: [] };
  report.timings = {};
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

  const currentCases = [];
  let server, chrome, profile, cdp, forwardPort, reversePort;
  try {
    let phaseStarted = performance.now();
    if (values.server === 'static') {
      server = await createShaderballStaticServer({
        root: ROOT, port: Number(values.port),
        coreRoot: process.env.MX_CORE_DIR ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\javascript\\build\\installed\\JavaScript\\MaterialX',
        libraryRoot: process.env.MX_LIB_ROOT ?? 'D:\\WebGL2\\MaterialX\\MaterialX-rva\\libraries',
        playgroundRoot: process.env.MX_PLAYGROUND_ROOT ?? 'D:\\WebGL2\\MaterialX\\OpenPBRShaderPlayground\\ShdrPlygrnd',
      });
    } else {
      const { createServer } = await import('vite');
      server = await createServer({
        root: ROOT, configFile: join(ROOT, 'vite.config.ts'),
        plugins: [{
          name: 'shaderball-idle-page',
          configureServer(vite) {
            vite.middlewares.use((request, response, next) => {
              if (request.url !== '/__shaderball_idle__') return next();
              response.setHeader('Content-Type', 'text/html');
              response.end('<!doctype html><title>Shaderball ready</title>');
            });
          },
        }],
        server: { host: '127.0.0.1', port: Number(values.port), strictPort: false, open: false, hmr: false },
      });
      await server.listen();
    }
    report.server = values.server;
    report.timings.serverStartup = performance.now() - phaseStarted;
    const port = server.httpServer.address().port;
    const origin = `http://${values.target === 'mobile' ? 'localhost' : '127.0.0.1'}:${port}`;
    if (displayMode) {
      await displayShaderball(displayUrls(origin, cases, values), {
        integrated: values.integrated,
        chromePath: process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      });
      return;
    }
    // Start with no scene, WASM, GPU device or raster warmup.
    const startUrl = `${origin}/__shaderball_idle__`;
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
      const isHarnessPage = (entry) => entry.type === 'page'
        && (entry.url === startUrl || entry.url?.startsWith(`${origin}${HARNESS}`));
      let page = (await listPages()).find(isHarnessPage);
      if (!page) {
        log('harness tab missing; reopening it');
        if (values.target === 'mobile') await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${startUrl}'`, 'com.android.chrome');
        else await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(startUrl)}`, { method: 'PUT' });
        page = await waitFor(async () => (await listPages()).find(isHarnessPage),
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
      await cdp.send('Page.navigate', { url: startUrl });
      await waitFor(async () => {
        try { return await cdp.evaluate(`location.href === ${JSON.stringify(startUrl)} && typeof globalThis.__MX_RENDER__ === 'undefined'`); }
        catch (error) {
          if (/context|navigat/i.test(error.message)) return false;
          throw error;
        }
      }, 'reset render session', 60000);
    };
    if (values.target === 'mobile') {
      const devices = (await exec(adbPath, ['devices'])).stdout.split('\n').slice(1).filter((line) => /\tdevice\s*$/.test(line.trim()));
      if (devices.length === 0) throw new Error('No authorized mobile connected (use --target local).');
      if (!serial && devices.length > 1) throw new Error('Several mobiles connected: use --device serial.');
      report.device = serial ?? devices[0].split('\t')[0];
    }
    phaseStarted = performance.now();
    await launchBrowser();
    await waitFor(async () => (await listPages()).some((entry) => entry.type === 'page' && entry.url === startUrl),
      'harness tab (keep the phone unlocked)', 60000);
    await attach();
    report.timings.browserStartup = performance.now() - phaseStarted;
    log(`timing startup: ${values.server} ${report.timings.serverStartup.toFixed(0)} ms, browser/CDP ${report.timings.browserStartup.toFixed(0)} ms`);
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
      entry.sessionCache = result.sessionCache;
      if (result.status === 'rendered') {
        const file = join(outDir, `${name}.png`);
        const writeStarted = performance.now();
        writeFileSync(file, Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(',') + 1), 'base64'));
        entry.timings = { ...result.timings, imageTransfer: result.transferMs,
          pngWrite: performance.now() - writeStarted, caseWall: result.caseMs + performance.now() - writeStarted };
        entry.file = relative(ROOT, file).split(sep).join('/');
        entry.renderMs = Math.round(result.renderMs);
        entry.stats = result.stats;
        entry.pageLog = result.pageLog;
        entry.status = result.stats.litFraction < Number(values['black-threshold']) ? 'black' : 'ok';
        if (entry.status === 'black') entry.reason = lastLines(result.pageLog, 6);
      } else {
        entry.reason = result.reason;
      }
      entry.memory = { ...result.memory, cpu: await sampleCpuMemory(values.target === 'local' ? chrome?.pid : undefined) };
      report.cases.push(entry);
      currentCases.push(entry);
      saveReport();
      const detail = entry.status === 'ok' || entry.status === 'black'
        ? `${entry.renderMs} ms, lit ${(entry.stats.litFraction * 100).toFixed(1)}%`
        : entry.reason;
      log(`${index + 1}/${cases.length} ${entry.status}: ${name} (${detail})`);
      if (entry.timings) log(`timing ${name}: ${Object.entries(entry.timings).map(([key, ms]) => `${key}=${ms.toFixed(1)} ms`).join(', ')}`);
      if (entry.sessionCache) log(`GPU session cache: ${entry.sessionCache.hits} hits, ${entry.sessionCache.misses} misses`);
    }
  } catch (error) {
    report.error = String(error);
    throw error;
  } finally {
    if (displayMode) {
      await server?.close();
    } else {
      report.memory = { cpu: await sampleCpuMemory(values.target === 'local' ? chrome?.pid : undefined) };
      const cleanupStarted = performance.now();
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
      report.timings.cleanup = performance.now() - cleanupStarted;
      report.timings.commandTotal = performance.now() - commandStarted;
      report.finishedAt = new Date().toISOString();
      saveReport();
      log(`timing command: ${report.timings.commandTotal.toFixed(0)} ms; cleanup ${report.timings.cleanup.toFixed(0)} ms (excludes npm/Node bootstrap)`);
      console.log('\n' + formatTimingTable(report, currentCases));
    }
  }
}

main().catch((error) => {
  console.error(`[shaderball] ${error.message}`);
  process.exitCode = 1;
});
