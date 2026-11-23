// Runs a material script (docs/SCRIPTING.md) in the viewer from the command line: starts Vite,
// opens the app in headless Chromium and calls the page's `__mxRunScript`. Files written by
// `save(...)` go to --out (default: the current directory).
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { root } from './export-browser-session.mjs';

const WEBGPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--ignore-gpu-blocklist'];

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string', default: '.' }, xml: { type: 'string' }, headed: { type: 'boolean' },
      timeout: { type: 'string', default: '600000' }, gpu: { type: 'string', default: 'high-performance' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length === 0 || (values.xml && positionals.length > 1)) {
    console.log('Usage: npm run script -- <script.js|folder> [script2.js ...] [--out dossier] [--xml material.mtlx] [--timeout ms] [--gpu high-performance|low-power|default] [--headed]\n' +
      'Runs material scripts in headless Chromium with WebGPU, each in a fresh page. save("render.png") and\n' +
      'save("material.mtlx", surface) write into --out (into --out/<script name> with several scripts);\n' +
      '--xml (one script only) also writes the script material. --timeout applies to each script. --gpu selects the adapter (discrete GPU by default, like bench:engine).');
    return;
  }
  const gpuArgs = { 'high-performance': ['--force_high_performance_gpu'], 'low-power': ['--force_low_power_gpu'], default: [] }[values.gpu];
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
  let browser;
  const failures = [];
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('The Vite server has no TCP address.');
    browser = await chromium.launch({
      headless: !values.headed, args: [...WEBGPU_ARGS, ...gpuArgs],
      ...(process.env.MX_CHROME ? { executablePath: process.env.MX_CHROME } : { channel: 'chrome' }),
    });
    for (const [index, file] of scripts.entries()) {
      const name = basename(file).replace(/\.[^.]*$/, '');
      const out = scripts.length > 1 ? join(resolve(values.out), name) : resolve(values.out);
      if (scripts.length > 1) console.log(`\n=== ${name}`);
      const started = performance.now();
      try {
        await runOne(browser, address.port, codes[index], out, timeout, values.xml);
        console.log(`${name}: OK in ${((performance.now() - started) / 1000).toFixed(1)} s`);
      } catch (error) {
        failures.push(name);
        console.error(`[script] ${name}: ${error.message}`);
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
  if (failures.length) throw new Error(`${failures.length} script(s) failed: ${failures.join(', ')}`);
}

async function runOne(browser, port, code, out, timeout, xml) {
  const page = await browser.newPage();
  try {
    page.setDefaultTimeout(timeout);
    let saved = 0;
    page.on('console', message => {
      if (message.text().startsWith('[script]')) console.log(message.text().slice(9));
    });
    page.on('pageerror', error => console.error(`[page] ${error.message}`));
    await page.exposeFunction('__mxSaveFile', async (name, base64) => {
      // Scripts can only write below the output directory.
      const target = isAbsolute(name) ? join(out, basename(name)) : resolve(out, name);
      if (!target.startsWith(out)) throw new Error(`save("${name}") must stay inside the output directory.`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(base64, 'base64'));
      saved++;
      console.log(`Saved ${target}`);
    });
    await page.goto(`http://127.0.0.1:${port}/`);
    if (!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()))) {
      throw new Error('WebGPU is unavailable in this browser. Set MX_CHROME or use --headed.');
    }
    await page.waitForFunction(() => typeof globalThis.__mxRunScript === 'function');
    const result = await page.evaluate(source => globalThis.__mxRunScript(source), code);
    if (!result.ok) throw new Error(`${result.message}${result.line === undefined ? '' : ` (line ${result.line})`}`);
    if (xml) {
      const target = resolve(out, xml);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, result.xml);
      console.log(`Saved ${target}`);
    }
    console.log(`Script finished: ${result.nodes} nodes, ${result.viewerCommands} viewer commands, ${saved} files saved.`);
  } finally {
    // The viewer tears its UI down on pagehide; that is not a script error.
    page.removeAllListeners('pageerror');
    await page.close();
  }
}

main().catch(error => { console.error(`[script] ${error.message}`); process.exitCode = 1; });
