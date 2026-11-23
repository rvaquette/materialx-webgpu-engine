// Runs material scripts (docs/SCRIPTING.md) in the viewer from the command line: starts Vite,
// opens the app in Chrome with WebGPU (desktop headless Chromium, or Chrome on an Android device
// through adb with --android) and calls the page's `__mxRunScript`. Files written by `save(...)`
// go to --out (default: the current directory).
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { androidDevice, openAndroidTab } from '../tests/playwright/android.ts';
import { root } from './export-browser-session.mjs';

const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];
const GPU_ARGS = { 'high-performance': ['--force_high_performance_gpu'], 'low-power': ['--force_low_power_gpu'], default: [] };

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: '.' }, xml: { type: 'string' }, headed: { type: 'boolean' },
      timeout: { type: 'string', default: '600000' }, gpu: { type: 'string', default: 'high-performance' },
      android: { type: 'boolean' }, device: { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length === 0) {
    console.log('Usage: npm run script -- <script.js|folder> [script2.js ...] [--out dossier] [--xml material.mtlx] [--timeout ms]\n' +
      '         [--gpu high-performance|low-power|default] [--headed] [--android [--device serial]]\n' +
      'Runs material scripts with WebGPU, each in a freshly loaded page. save("render.png") and\n' +
      'save("material.mtlx", surface) write into --out (into --out/<script name> with several scripts);\n' +
      '--xml (one script only) also writes the script material. --timeout applies to each script.\n' +
      '--gpu selects the desktop adapter (discrete GPU by default, like bench:engine). --android runs the scripts\n' +
      'in Chrome on the connected Android device (adb: MX_ADB or D:\\platform-tools\\adb.exe; keep it unlocked).');
    return;
  }
  const gpuArgs = GPU_ARGS[values.gpu];
  if (!gpuArgs) throw new Error('--gpu must be high-performance, low-power or default.');
  const timeout = Number(values.timeout);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('--timeout must be a positive integer.');
  // A folder stands for its .js scripts, in name order.
  const scripts = (await Promise.all(positionals.map(async (file) => {
    const path = resolve(file);
    if (!(await stat(path)).isDirectory()) return [path];
    return (await readdir(path)).filter(name => name.endsWith('.js')).sort().map(name => join(path, name));
  }))).flat();
  if (values.xml && scripts.length > 1) throw new Error('--xml needs a single script.');
  const codes = await Promise.all(scripts.map(file => readFile(file, 'utf8')));

  const server = await createServer({
    root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null, forwardConsole: false },
  });
  let target;
  const failures = [];
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('The Vite server has no TCP address.');
    target = values.android ? await openAndroid(address.port, values.device) : await openDesktop(address.port, values.headed, gpuArgs);
    console.log(`Target: ${target.label}`);
    for (const [index, file] of scripts.entries()) {
      const name = basename(file).replace(/\.[^.]*$/, '');
      const out = scripts.length > 1 ? join(resolve(values.out), name) : resolve(values.out);
      if (scripts.length > 1) console.log(`\n=== ${name}`);
      const started = performance.now();
      try {
        await (target.run ? target.run(codes[index], out, timeout, values.xml) : runOne(target, codes[index], out, timeout, values.xml));
        console.log(`${name}: OK in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      } catch (error) {
        failures.push(name);
        console.error(`[script] ${name}: ${error.message}`);
      }
    }
  } finally {
    await target?.close();
    await server.close();
  }
  if (failures.length) throw new Error(`${failures.length} script(s) failed: ${failures.join(', ')}`);
}

/** Headless (or headed) desktop Chrome; one new page per script. */
async function openDesktop(port, headed, gpuArgs) {
  const browser = await chromium.launch({
    headless: !headed, args: [...WEBGPU_ARGS, ...gpuArgs],
    ...(process.env.MX_CHROME ? { executablePath: process.env.MX_CHROME } : { channel: 'chrome' }),
  });
  return {
    label: `desktop Chrome ${browser.version()}`,
    url: `http://127.0.0.1:${port}/`,
    page: () => browser.newPage(),
    release: async (page) => {
      // The viewer tears its UI down on pagehide; that is not a script error.
      page.removeAllListeners('pageerror');
      await page.close();
    },
    close: () => browser.close(),
  };
}

/**
 * Chrome on an Android device through adb: the Vite port is reversed to the device and the
 * scripts run in one tab driven over its DevTools socket (tests/playwright/android.ts), without
 * attaching to the browser's other tabs. Each script reloads that tab.
 */
async function openAndroid(port, serial) {
  if (serial) process.env.MX_ANDROID_SERIAL = serial;
  const device = await androidDevice();
  if (!device) throw new Error('Expected exactly one authorized Android device (adb devices); use --device.');
  const url = `http://localhost:${port}/`;
  const tab = await openAndroidTab(device, `${url}?mxRunner=${Date.now()}`, port);
  const state = { out: '.', saved: 0, writes: [] };
  tab.onConsole((type, text) => {
    if (text.startsWith('[script]')) console.log(text.slice(9));
    else if (type === 'error') console.error(`[console] ${text.slice(0, 2000)}`);
  });
  await tab.bind('__mxSaveFileBinding', (payload) => {
    const { name, data } = JSON.parse(payload);
    state.writes.push(saveFile(state.out, name, data).then(() => { state.saved++; }));
  });
  await tab.addInitScript('globalThis.__mxSaveFile = async (name, data) => { globalThis.__mxSaveFileBinding(JSON.stringify({ name, data })); };');
  return {
    label: device.label,
    async run(code, out, timeout, xml) {
      Object.assign(state, { out, saved: 0, writes: [] });
      const started = performance.now();
      const step = (message) => console.log(`  [${((performance.now() - started) / 1000).toFixed(1)} s] ${message}`);
      await tab.navigate(url);
      for (const end = Date.now() + 120_000; ; await new Promise(resolve => setTimeout(resolve, 500))) {
        if (await tab.evaluate("typeof globalThis.__mxRunScript === 'function'").catch(() => false)) break;
        if (Date.now() > end) throw new Error('The viewer did not start on the device.');
      }
      step('viewer ready');
      const result = await tab.evaluate(`globalThis.__mxRunScript(${JSON.stringify(code)})`, timeout);
      await Promise.all(state.writes);
      if (!result.ok) throw new Error(`${result.message}${result.line === undefined ? '' : ` (line ${result.line})`}`);
      if (xml) await saveFile(out, xml, Buffer.from(result.xml).toString('base64'));
      console.log(`Script finished: ${result.nodes} nodes, ${result.viewerCommands} viewer commands, ${state.saved} files saved.`);
    },
    close: () => tab.close(),
  };
}

/** Scripts can only write below the output directory. */
async function saveFile(out, name, base64) {
  const file = isAbsolute(name) ? join(out, basename(name)) : resolve(out, name);
  if (!file.startsWith(out)) throw new Error(`save("${name}") must stay inside the output directory.`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, Buffer.from(base64, 'base64'));
  console.log(`Saved ${file}`);
}

async function runOne(target, code, out, timeout, xml) {
  const page = await target.page();
  const started = performance.now();
  const step = (message) => console.log(`  [${((performance.now() - started) / 1000).toFixed(1)} s] ${message}`);
  try {
    page.setDefaultTimeout(timeout);
    let saved = 0;
    page.on('console', message => {
      if (message.text().startsWith('[script]')) console.log(message.text().slice(9));
      else if (message.type() === 'error') console.error(`[console] ${message.text().slice(0, 2000)}`);
    });
    page.on('pageerror', error => console.error(`[page] ${error.message}`));
    // A reused tab keeps its binding: the destination is read from the page's run.
    globalThis.__mxOut = out;
    globalThis.__mxSaved = () => saved++;
    if (!page.__mxExposed) {
      page.__mxExposed = true;
      await page.exposeFunction('__mxSaveFile', async (name, base64) => {
        await saveFile(globalThis.__mxOut, name, base64);
        globalThis.__mxSaved();
      });
    }
    await page.goto(target.url);
    step('page loaded');
    // A second adapter request can stall on some drivers while the viewer holds its device.
    const webgpu = await page.evaluate(() => Promise.race([
      navigator.gpu?.requestAdapter().then(Boolean) ?? Promise.resolve(false),
      new Promise(resolve => setTimeout(() => resolve('timeout'), 20_000)),
    ]));
    if (!webgpu) throw new Error('WebGPU is unavailable in this browser. Set MX_CHROME or use --headed.');
    await page.waitForFunction(() => typeof globalThis.__mxRunScript === 'function');
    step(`viewer ready (adapter check: ${webgpu})`);
    const result = await page.evaluate(source => globalThis.__mxRunScript(source), code);
    if (!result.ok) throw new Error(`${result.message}${result.line === undefined ? '' : ` (line ${result.line})`}`);
    if (xml) {
      const file = resolve(out, xml);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, result.xml);
      console.log(`Saved ${file}`);
    }
    console.log(`Script finished: ${result.nodes} nodes, ${result.viewerCommands} viewer commands, ${saved} files saved.`);
  } finally {
    await target.release(page);
  }
}

main().catch(error => { console.error(`[script] ${error.message}`); process.exitCode = 1; });
