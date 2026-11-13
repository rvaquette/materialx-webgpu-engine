// Headless Chrome + Vite session running scripts/export-scene-browser.ts, shared by
// export-scene.mjs (single scene) and compile-scenes.mjs (batch compilation).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { createServer } from 'vite';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PAYLOAD_FILES = ['buffers.bin.zst', 'shaders.wgsl.zst', 'metadata.json.zst'];
const harnessPath = '/__export_scene.html';
const browserModule = '/scripts/export-scene-browser.ts';

function connect(url, onEvent = () => {}) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  let closed = false;
  const rejectAll = error => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  };
  socket.addEventListener('close', () => { closed = true; rejectAll(new Error('Export browser disconnected.')); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.method) onEvent(message);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    get closed() { return closed; },
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Cannot connect to export browser.')), { once: true });
    }),
    send(method, params = {}, timeout = 10 * 60 * 1000) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Export browser timed out: ${method}`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { rejectAll(new Error('Export connection closed.')); socket.close(); },
  };
}

function chromeExecutable() {
  const chromePath = process.env.MX_CHROME ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync);
  if (!chromePath || !existsSync(chromePath)) throw new Error('Chrome/Edge not found. Set MX_CHROME to its executable.');
  return chromePath;
}

async function launchBrowser(origin, label, quiet) {
  const chromePath = chromeExecutable();
  const profile = await mkdtemp(join(tmpdir(), 'mx-scene-export-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', `${origin}${harnessPath}`,
  ], { stdio: 'ignore' });
  let launchError;
  chrome.on('error', error => { launchError = error; });
  const chromeExited = new Promise(resolve => {
    chrome.once('exit', resolve);
    chrome.once('error', resolve);
  });
  let connection;
  const close = async () => {
    connection?.close();
    if (chrome.exitCode === null && chrome.pid) {
      chrome.kill();
      await chromeExited;
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    const started = Date.now();
    const portFile = join(profile, 'DevToolsActivePort');
    let page;
    while (!page && Date.now() - started < 30000) {
      if (launchError) throw launchError;
      if (chrome.exitCode !== null) throw new Error(`Export browser exited with code ${chrome.exitCode}.`);
      if (existsSync(portFile)) {
        const port = Number((await readFile(portFile, 'utf8')).split('\n')[0]);
        const response = await fetch(`http://127.0.0.1:${port}/json/list`);
        if (!response.ok) throw new Error(`Browser discovery failed: HTTP ${response.status}`);
        const pages = await response.json();
        page = pages.find(page => page.type === 'page' && page.url === `${origin}${harnessPath}`);
      }
      if (!page) await sleep(100);
    }
    if (!page) throw new Error('Timed out starting the export browser.');
    connection = connect(page.webSocketDebuggerUrl, message => {
      if (message.method === 'Runtime.consoleAPICalled') {
        if (quiet && !['warning', 'error', 'assert'].includes(message.params.type)) return;
        const text = message.params.args.map(arg => arg.value ?? arg.description ?? '').join(' ');
        console.log(`[${label}:${message.params.type}] ${text}`);
      } else if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails;
        console.error(`[${label}] ${details.exception?.description ?? details.text}`);
      } else if (message.method === 'Inspector.targetCrashed') {
        console.error(`[${label}] Browser tab crashed.`);
      }
    });
    await connection.ready;
    await connection.send('Runtime.enable');
    await connection.send('Inspector.enable');
    return { connection, close };
  } catch (error) {
    await close();
    throw error;
  }
}

/**
 * Starts Vite and a headless browser. `call(name, args)` invokes an export of
 * scripts/export-scene-browser.ts; `restart()` replaces the browser (fresh WASM heap).
 */
export async function openExportSession({ label = 'export-browser', quiet = false } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('Scene export requires Node.js >=22 (built-in WebSocket).');
  const server = await createServer({
    root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, entries: [] },
    plugins: [{
      name: 'compiled-scene-export',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url !== harnessPath) { next(); return; }
          res.setHeader('Content-Type', 'text/html');
          res.end('<!doctype html><meta charset="utf-8"><title>Scene export</title>');
        });
      },
    }],
  });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Export server has no TCP address.');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await launchBrowser(origin, label, quiet);
    const evaluate = async (expression, timeout) => {
      const result = await browser.connection.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const call = (name, args = [], timeout) => evaluate(
      `import(${JSON.stringify(browserModule)}).then(module => module[${JSON.stringify(name)}](...${JSON.stringify(args)}))`, timeout);
    return {
      origin,
      /** App URL of a project-relative path (forward slashes). */
      url: path => `${origin}/${path.split('/').map(encodeURIComponent).join('/')}`,
      call,
      get alive() { return !browser.connection.closed; },
      async restart() {
        await browser.close();
        browser = await launchBrowser(origin, label, quiet);
      },
      /** Streams the payloads of the last compiled package into `out`, then writes its manifest. */
      async writePackage(result, out, manifestName, generatedFrom) {
        await mkdir(out, { recursive: true });
        for (const { path, byteLength } of result.files) {
          if (!PAYLOAD_FILES.includes(path)) throw new Error(`Invalid exported payload path: ${path}`);
          const file = await open(join(out, path), 'wx');
          try {
            for (let offset = 0; offset < byteLength; offset += 1024 * 1024) {
              const length = Math.min(1024 * 1024, byteLength - offset);
              const bytes = Buffer.from(await call('readChunk', [path, offset, length]), 'base64');
              if (bytes.length !== length) throw new Error(`Truncated export payload: ${path}`);
              await file.writeFile(bytes);
            }
          } finally { await file.close(); }
        }
        const manifest = { ...result.manifest, generatedFrom };
        await writeFile(join(out, manifestName), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
      },
      async close() {
        await browser?.close();
        await server.close();
      },
    };
  } catch (error) {
    await browser?.close();
    await server.close();
    throw error;
  }
}
