import { execFile, spawn } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { readdirSync, mkdirSync, writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const exec = promisify(execFile);
const log = (message) => console.log(`[mtlx-audit] ${message}`);

function findMaterials(directory) {
  const excluded = new Set(['node_modules', '.git', 'dist', '.azure', '__blobstorage__']);
  return readdirSync(directory, { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name)).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return excluded.has(entry.name) ? [] : findMaterials(path);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.mtlx') ? [path] : [];
  });
}

async function waitFor(action, label, timeout = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const result = await action();
    if (result) return result;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}

export async function ensureAuditPage({ find, launch, timeout = 30000 }) {
  const page = await find();
  if (page) return page;
  await launch();
  return waitFor(find, 'audit browser tab after reopening Chrome (keep the phone unlocked)', timeout);
}

export function resumeAuditReport(previous, { target, files, scope }) {
  if (previous.schemaVersion !== 1 || !Array.isArray(previous.files)) throw new Error('Invalid audit report for --resume');
  if (previous.target !== target || previous.scope?.root !== scope.root || previous.scope?.filter !== scope.filter) {
    throw new Error('--resume requires the same target, root and filter as the saved report');
  }
  const selected = new Set(files);
  const seen = new Set();
  for (const result of previous.files) {
    if (!selected.has(result.file) || seen.has(result.file)) throw new Error('--resume file selection does not match the saved report');
    seen.add(result.file);
  }
  const { error, finishedAt, ...saved } = previous;
  return {
    ...saved,
    complete: false,
    scope,
    totalFiles: files.length,
    files: previous.files.filter((result) => !(result.status === 'failed' && /CDP|device lost|context destroyed|Target closed|No result from browser/i.test(result.reason ?? ''))),
    resumedAt: new Date().toISOString(),
  };
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
  const send = (method, params = {}, timeout = 120000) => new Promise((resolveRequest, reject) => {
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection closed')); return; }
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeout);
    pending.set(id, { resolve: resolveRequest, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression, timeout) => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeout);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result?.value;
  };
  return { socket, send, evaluate };
}

function save(report, out) {
  const summary = { compiled: 0, incomplete: 0, failed: 0, skipped: 0 };
  for (const file of report.files) summary[file.status]++;
  report.summary = summary;
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  const lines = ['# MaterialX WGSL Compilation Audit', '',
    `Target: ${report.target}`, `Complete: ${report.complete}`, `Files: ${report.files.length}/${report.totalFiles}`, '',
    `Compiled: ${summary.compiled}; incomplete: ${summary.incomplete}; failed: ${summary.failed}; skipped: ${summary.skipped}.`, '',
    'Compilation only: textures are not decoded, pixels and physical correctness are not tested.', '',
    '## Files Requiring Attention', ''];
  if (report.error) lines.push(`Run error: ${report.error}`, '');
  for (const file of report.files.filter((result) => result.status !== 'compiled')) {
    lines.push(`### ${file.file}`, '', `Status: ${file.status}${file.reason ? ` (${file.reason})` : ''}`, '');
    const messages = new Set(file.diagnostics.map((diagnostic) => `${diagnostic.level}: ${diagnostic.message}`));
    for (const material of file.materials) {
      for (const diagnostic of material.diagnostics) messages.add(`${diagnostic.level}: ${diagnostic.message}`);
      for (const shader of material.shaders) {
        if (shader.failure) messages.add(`${material.material}/${shader.backend}: ${shader.failure}`);
        for (const error of shader.errors) messages.add(`${material.material}/${shader.backend} (${error.line}:${error.column}): ${error.message.split('\n')[0]}`);
      }
    }
    for (const message of messages) lines.push(`- ${message.replace(/\s+/g, ' ')}`);
    lines.push('');
  }
  writeFileSync(out.replace(/\.json$/i, '') + '.md', lines.join('\n') + '\n');
}

async function main() {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    list: { type: 'boolean' },
    resume: { type: 'boolean' },
    target: { type: 'string', default: 'mobile' },
    root: { type: 'string', default: '.' },
    filter: { type: 'string', default: '' },
    limit: { type: 'string' },
    timeout: { type: 'string', default: '60000' },
    port: { type: 'string', default: '5175' },
    out: { type: 'string', default: 'docs/generated/mtlx-compile-audit.json' },
    device: { type: 'string' },
  } });
  if (values.help) {
    console.log('npm run audit:mtlx -- [--target mobile|local] [--root scenes] [--filter text] [--limit N] [--timeout milliseconds] [--port N] [--out report.json] [--device serial] [--resume] [--list]');
    return;
  }
  if (typeof WebSocket !== 'function') throw new Error('This audit requires Node.js 22 or newer (WebSocket).');
  if (!['mobile', 'local'].includes(values.target)) throw new Error('--target must be mobile or local');
  const limit = values.limit === undefined ? Infinity : Number(values.limit);
  if (!(limit > 0) || (limit !== Infinity && !Number.isInteger(limit))) throw new Error('--limit must be a positive integer');
  const timeout = Number(values.timeout);
  if (!Number.isInteger(timeout) || timeout < 1) throw new Error('--timeout must be a positive integer in milliseconds');
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid --port');
  const root = resolve(ROOT, values.root);
  const rootRelative = relative(ROOT, root);
  if (rootRelative === '..' || rootRelative.startsWith(`..${sep}`) || isAbsolute(rootRelative)) throw new Error('--root must be inside the workspace');
  const discovered = findMaterials(root);
  const files = discovered.map((file) => relative(ROOT, file).split(sep).join('/'))
    .filter((file) => file.toLowerCase().includes(values.filter.replaceAll('\\', '/').toLowerCase())).slice(0, limit);
  if (files.length === 0) throw new Error('No matching .mtlx files');
  if (values.list) {
    console.log(files.join('\n'));
    log(`${files.length} files`);
    return;
  }
  const out = resolve(ROOT, values.out);
  const adbPath = process.env.MX_ADB ?? 'D:\\platform-tools\\adb.exe';
  let serial = values.device ?? process.env.MX_DEVICE ?? process.env.ANDROID_SERIAL;
  const adb = async (...command) => (await exec(adbPath, [...(serial ? ['-s', serial] : []), ...command])).stdout.trim();
  const scope = { root: rootRelative || '.', filter: values.filter, limit: values.limit === undefined ? null : limit, discoveredFiles: discovered.length };
  const report = values.resume ? resumeAuditReport(JSON.parse(readFileSync(out, 'utf8')), { target: values.target, files, scope }) : {
    schemaVersion: 1, startedAt: new Date().toISOString(), target: values.target, complete: false,
    scope,
    totalFiles: files.length, files: [],
  };
  let server, chrome, profile, cdp, reversePort, forwardPort;
  try {
    if (values.target === 'mobile') {
      const devices = (await exec(adbPath, ['devices'])).stdout.split('\n').slice(1).filter((line) => /\tdevice\s*$/.test(line.trim()));
      if (!serial) {
        if (devices.length !== 1) throw new Error(`Expected one authorized mobile; found ${devices.length}. Connect a device or use --device serial / --target local.`);
        serial = devices[0].split('\t')[0];
      }
      if (!devices.some((line) => line.startsWith(`${serial}\t`))) throw new Error(`Mobile not authorized: ${serial}`);
      report.device = serial;
    }
    server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'), server: { host: '127.0.0.1', port, strictPort: false, open: false } });
    await server.listen();
    const actualPort = server.httpServer.address().port;
    const origin = `http://${values.target === 'mobile' ? 'localhost' : '127.0.0.1'}:${actualPort}`;
    const url = `${origin}/mtlx-compile-harness.html?run=${Date.now()}`;
    let debugPort;
    if (values.target === 'mobile') {
      await adb('reverse', `tcp:${actualPort}`, `tcp:${actualPort}`);
      reversePort = actualPort;
      debugPort = Number(await adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote'));
      forwardPort = debugPort;
      const launch = await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, 'com.android.chrome');
      log(`Android: ${launch.replace(/\s+/g, ' ')}`);
    } else {
      profile = mkdtempSync(join(tmpdir(), 'mx-compile-audit-'));
      chrome = spawn(process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
        '--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
      ], { stdio: 'ignore' });
      let launchError;
      chrome.on('error', (error) => { launchError = error; });
      debugPort = await waitFor(() => {
        if (launchError) throw launchError;
        const file = join(profile, 'DevToolsActivePort');
        return existsSync(file) ? Number(readFileSync(file, 'utf8').split('\n')[0]) : null;
      }, 'local Chrome');
    }
    const findExistingPage = async () => {
      const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json()).catch(() => []);
      return pages.find((entry) => values.target === 'mobile' ? entry.url?.split('?')[0] === url.split('?')[0] : entry.type === 'page');
    };
    const findPage = () => ensureAuditPage({
      find: findExistingPage,
      launch: async () => {
        log('audit tab missing; reopening it');
        if (values.target === 'mobile') {
          await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${url}'`, 'com.android.chrome');
        } else {
          const response = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
          if (!response.ok) throw new Error(`Cannot recreate audit tab: HTTP ${response.status}`);
        }
      },
    });
    const page = await findPage();
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    const waitForAdapter = (expectedUrl) => waitFor(async () => {
      let state;
      try {
        state = await cdp.evaluate('({adapter: globalThis.__MX_COMPILE_AUDIT__?.adapter, url: globalThis.__MX_COMPILE_AUDIT__?.url, error: globalThis.__MX_COMPILE_AUDIT_ERROR__, href: location.href})');
      } catch (error) {
        if (/context|navigat/i.test(error.message)) return null;
        throw error;
      }
      if (state?.error && state.href === expectedUrl) throw new Error(state.error);
      return state?.url === expectedUrl ? state.adapter : null;
    }, 'MaterialX/WebGPU initialization');
    const restart = async () => {
      if (values.target === 'mobile' && cdp.socket.readyState !== WebSocket.OPEN) {
        await waitFor(async () => (await adb('get-state').catch(() => '')) === 'device', 'ADB device reconnection', 30000);
        await adb('reverse', `tcp:${actualPort}`, `tcp:${actualPort}`);
        if (forwardPort) await adb('forward', '--remove', `tcp:${forwardPort}`).catch(() => {});
        debugPort = Number(await adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote'));
        forwardPort = debugPort;
      }
      if (cdp.socket.readyState !== WebSocket.OPEN) {
        cdp.socket.close();
        const currentPage = await findPage();
        cdp = await connect(currentPage.webSocketDebuggerUrl);
        await cdp.send('Page.enable');
      }
      const nextUrl = `${url}&batch=${Date.now()}`;
      await cdp.send('Page.navigate', { url: nextUrl });
      return waitForAdapter(nextUrl);
    };
    report.adapter = await restart();
    log(`${values.target}: ${JSON.stringify(report.adapter)}`);
    log(`${files.length} .mtlx files; report: ${out}`);
    const completed = new Set(report.files.map((file) => file.file));
    if (values.resume) log(`resuming: ${completed.size} saved results, ${files.length - completed.size} files remaining`);
    save(report, out);
    for (const [index, file] of files.entries()) {
      if (completed.has(file)) continue;
      if (index > 0 && index % 10 === 0) await restart();
      let result;
      try {
        const asset = '/' + file.split('/').map(encodeURIComponent).join('/');
        result = await cdp.evaluate(`globalThis.__MX_COMPILE_AUDIT__.runFile(${JSON.stringify(asset)})`, timeout);
        if (!result) throw new Error('No result from browser');
        result.file = file;
      } catch (error) {
        result = { file, status: 'failed', reason: String(error), diagnostics: [], materials: [] };
      }
      report.files.push(result);
      completed.add(file);
      if ((index + 1) % 10 === 0 || result.status === 'failed') save(report, out);
      log(`${index + 1}/${files.length} ${result.status}: ${file}`);
      if (result.reason && /CDP timeout|device lost|CDP connection closed/i.test(result.reason) && index + 1 < files.length) {
        log('restarting browser context after compilation failure');
        await restart();
      }
    }
    report.complete = true;
    report.finishedAt = new Date().toISOString();
    save(report, out);
    log(`summary: ${JSON.stringify(report.summary)}`);
    process.exitCode = report.summary.failed || report.summary.incomplete ? 1 : 0;
  } catch (error) {
    report.error = String(error);
    save(report, out);
    throw error;
  } finally {
    if (cdp) {
      await cdp.evaluate('globalThis.__MX_COMPILE_AUDIT__?.close()', 5000).catch(() => {});
      if (values.target === 'mobile') await cdp.send('Page.close', {}, 5000).catch(() => {});
      cdp.socket.close();
    }
    if (reversePort) await adb('reverse', '--remove', `tcp:${reversePort}`).catch(() => {});
    if (forwardPort) await adb('forward', '--remove', `tcp:${forwardPort}`).catch(() => {});
    if (chrome) {
      chrome.kill();
      await new Promise((resolveClose) => { if (chrome.exitCode !== null || chrome.pid === undefined) resolveClose(); else chrome.once('close', resolveClose); });
    }
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await server?.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`[mtlx-audit] ${error.message}`); process.exitCode = 1; });
}