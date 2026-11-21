// Runs a material script (docs/SCRIPTING.md) in the viewer from the command line: starts Vite,
// opens the app in headless Chromium and calls the page's `__mxRunScript`. Files written by
// `save(...)` go to --out (default: the current directory).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
      timeout: { type: 'string', default: '600000' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log('Usage: npm run script -- <script.js> [--out dossier] [--xml material.mtlx] [--timeout ms] [--headed]\n' +
      'Runs a material script in headless Chromium with WebGPU. save("render.png") and\n' +
      'save("material.mtlx", surface) write into --out; --xml also writes the script material.');
    return;
  }
  const timeout = Number(values.timeout);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new Error('--timeout must be a positive integer.');
  const code = await readFile(resolve(positionals[0]), 'utf8');
  const out = resolve(values.out);

  const server = await createServer({
    root, logLevel: 'error', server: { host: '127.0.0.1', port: 0, open: false, hmr: false, watch: null },
  });
  let browser;
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('The Vite server has no TCP address.');
    browser = await chromium.launch({
      headless: !values.headed, args: WEBGPU_ARGS,
      ...(process.env.MX_CHROME ? { executablePath: process.env.MX_CHROME } : { channel: 'chrome' }),
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(timeout);
    let saved = 0;
    page.on('console', message => {
      if (message.text().startsWith('[script]')) console.log(message.text().slice(9));
    });
    page.on('pageerror', error => console.error(`[page] ${error.message}`));
    await page.exposeFunction('__mxSaveFile', async (name, base64) => {
      // Scripts can only write below --out.
      const target = isAbsolute(name) ? join(out, basename(name)) : resolve(out, name);
      if (!target.startsWith(out)) throw new Error(`save("${name}") must stay inside the output directory.`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(base64, 'base64'));
      saved++;
      console.log(`Saved ${target}`);
    });
    await page.goto(`http://127.0.0.1:${address.port}/`);
    if (!await page.evaluate(async () => Boolean(await navigator.gpu?.requestAdapter()))) {
      throw new Error('WebGPU is unavailable in this browser. Set MX_CHROME or use --headed.');
    }
    await page.waitForFunction(() => typeof globalThis.__mxRunScript === 'function');
    const result = await page.evaluate(source => globalThis.__mxRunScript(source), code);
    if (!result.ok) throw new Error(`${result.message}${result.line === undefined ? '' : ` (line ${result.line})`}`);
    if (values.xml) {
      const target = resolve(out, values.xml);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, result.xml);
      console.log(`Saved ${target}`);
    }
    console.log(`Script finished: ${result.nodes} nodes, ${result.viewerCommands} viewer commands, ${saved} files saved.`);
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch(error => { console.error(`[script] ${error.message}`); process.exitCode = 1; });
