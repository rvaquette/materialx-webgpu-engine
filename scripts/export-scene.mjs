import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harnessPath = '/__export_scene.html';
const browserModule = '/scripts/export-scene-browser.ts';

function connect(url) {
  const socket = new WebSocket(url);
  const pending = new Map();
  let nextId = 0;
  const rejectAll = error => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(error); }
    pending.clear();
  };
  socket.addEventListener('close', () => rejectAll(new Error('Export browser disconnected.')));
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  return {
    ready: new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', () => reject(new Error('Cannot connect to export browser.')), { once: true });
    }),
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Export browser timed out: ${method}`));
        }, 10 * 60 * 1000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { rejectAll(new Error('Export connection closed.')); socket.close(); },
  };
}

async function main() {
  const { values } = parseArgs({ options: {
    entry: { type: 'string' }, out: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: npm run export:scene -- --entry scenes\\pathtracer\\volume_cube.usda --out scenes\\compiled\\volume_cube\n' +
      'Requires Node.js >=22 and Chrome/Edge (MX_CHROME overrides its executable).\n' +
      'Loads and compiles USD/USDA/USDC using the shared browser loaders, without opening the viewer UI.\n' +
      'The output directory must be empty or absent. No source files are modified.');
    return;
  }
  if (!values.entry || !values.out) throw new Error('Both --entry and --out are required. Use --help.');
  if (typeof WebSocket === 'undefined') throw new Error('export:scene requires Node.js >=22 (built-in WebSocket).');
  const entry = resolve(values.entry);
  const entryRelative = relative(root, entry);
  if (entryRelative === '..' || entryRelative.startsWith(`..${sep}`) || isAbsolute(entryRelative) ||
      !/\.(usd|usda|usdc)$/i.test(entry) || !(await stat(entry)).isFile()) {
    throw new Error('The entry must be an existing USD/USDA/USDC file inside the project.');
  }
  const out = resolve(values.out);
  if (existsSync(out) && (await readdir(out)).length) throw new Error('Output directory is not empty. Choose a new directory.');
  const chromePath = process.env.MX_CHROME ?? [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(existsSync);
  if (!chromePath || !existsSync(chromePath)) throw new Error('Chrome/Edge not found. Set MX_CHROME to its executable.');

  const server = await createServer({
    root, server: { host: '127.0.0.1', port: 0, open: false },
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
  let profile;
  let chrome;
  let chromeExited;
  let connection;
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Export server has no TCP address.');
    const origin = `http://127.0.0.1:${address.port}`;
    profile = await mkdtemp(join(tmpdir(), 'mx-scene-export-'));
    chrome = spawn(chromePath, [
      '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', `${origin}${harnessPath}`,
    ], { stdio: 'ignore' });
    let launchError;
    chrome.on('error', error => { launchError = error; });
    chromeExited = new Promise(resolve => {
      chrome.once('exit', resolve);
      chrome.once('error', resolve);
    });
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
    connection = connect(page.webSocketDebuggerUrl);
    await connection.ready;
    const evaluate = async expression => {
      const result = await connection.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
      return result.result.value;
    };
    const entryUrl = `${origin}/${entryRelative.split(sep).map(encodeURIComponent).join('/')}`;
    console.log(`[export-scene] Compiling ${entryRelative} (Zstandard level 22)...`);
    const result = await evaluate(`import(${JSON.stringify(browserModule)}).then(module => module.compileScene(${JSON.stringify(entryUrl)}))`);
    await mkdir(out, { recursive: true });
    for (const { path, byteLength } of result.files) {
      if (!/^(buffers|textures|shaders|metadata)\/[a-f0-9]{64}\.(bin|wgsl|json)\.zst$/.test(path)) {
        throw new Error(`Invalid exported payload path: ${path}`);
      }
      const target = join(out, ...path.split('/'));
      await mkdir(dirname(target), { recursive: true });
      const file = await open(target, 'wx');
      try {
        for (let offset = 0; offset < byteLength; offset += 1024 * 1024) {
          const length = Math.min(1024 * 1024, byteLength - offset);
          const base64 = await evaluate(`import(${JSON.stringify(browserModule)}).then(module => module.readChunk(${JSON.stringify(path)},${offset},${length}))`);
          const bytes = Buffer.from(base64, 'base64');
          if (bytes.length !== length) throw new Error(`Truncated export payload: ${path}`);
          await file.writeFile(bytes);
        }
      } finally { await file.close(); }
    }
    result.manifest.generatedFrom = entryRelative.split(sep).join('/');
    await writeFile(join(out, 'scene.json'), `${JSON.stringify(result.manifest, null, 2)}\n`, { flag: 'wx' });
    console.log(`[export-scene] Exported ${result.files.length} payloads to ${join(out, 'scene.json')}`);
  } finally {
    connection?.close();
    if (chrome && chrome.exitCode === null && chrome.pid) {
      chrome.kill();
      await chromeExited;
    }
    await server.close();
    if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch(error => { console.error(`[export-scene] ${error.message}`); process.exitCode = 1; });
