import { execFile, spawn } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HARNESS = '/usd-image-harness.html?session=1';
const VARIANTS = ['8x8', '4x4', '16x4', '16x8'];

export function median(values) {
  if (!values.length || values.some(value => !Number.isFinite(value))) throw new Error('Expected finite measurements');
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function compareHdr(reference, candidate, samples) {
  if (!reference.length || reference.length !== candidate.length || reference.length % 4) throw new Error('HDR dimensions differ or are empty');
  let maxAbsoluteError = 0;
  for (let i = 0; i < reference.length; i++) {
    if (!Number.isFinite(reference[i]) || !Number.isFinite(candidate[i])) throw new Error(`Non-finite HDR at ${i}`);
    if (i % 4 === 3 && (reference[i] !== samples || candidate[i] !== samples)) throw new Error(`Invalid sample count at ${i}`);
    maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(reference[i] - candidate[i]));
  }
  return { identical: maxAbsoluteError === 0, maxAbsoluteError };
}

export function summarize(results) {
  const groups = new Map();
  for (const result of results.filter(result => !result.warmup)) {
    const key = `${result.scene}:${result.variant}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(result);
  }
  return [...groups.values()].map(group => {
    const gpu = group.map(row => row.gpuMs).filter(value => value !== null);
    const wall = group.map(row => row.renderMs);
    return {
      scene: group[0].scene, variant: group[0].variant, repetitions: group.length,
      wallMedianMs: median(wall), wallMinMs: Math.min(...wall), wallMaxMs: Math.max(...wall),
      gpuMedianMs: gpu.length === group.length ? median(gpu) : null,
      gpuMinMs: gpu.length === group.length ? Math.min(...gpu) : null,
      gpuMaxMs: gpu.length === group.length ? Math.max(...gpu) : null,
      identical: group.every(row => row.parity?.identical === true),
    };
  });
}

async function waitFor(action, label, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await action();
    if (value) return value;
    await sleep(200);
  }
  throw new Error(`Timed out: ${label}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
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
    socket.addEventListener('error', () => reject(new Error('CDP connection failed')), { once: true });
  });
  const send = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`CDP timeout: ${method}`)); }, 60000);
    pending.set(key, { resolve: resolveRequest, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return { socket, send, evaluate };
}

function decodeHdr(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length % 4) throw new Error('Invalid HDR byte length');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

async function main() {
  const { values } = parseArgs({ options: {
    target: { type: 'string', default: 'local' },
    res: { type: 'string', default: '128' },
    spp: { type: 'string', default: '8' },
    repeats: { type: 'string', default: '5' },
    scenes: { type: 'string', default: 'test_material_disney_gold,renderman_teapot_cloth,renderman_teapot_tiles' },
    'out-dir': { type: 'string' },
    device: { type: 'string' },
  } });
  if (!['local', 'mobile'].includes(values.target)) throw new Error('--target must be local or mobile');
  const res = Number(values.res), spp = Number(values.spp), repeats = Number(values.repeats);
  if (![res, spp, repeats].every(value => Number.isInteger(value) && value > 0) || res < 4 || spp > 256) {
    throw new Error('Expected res >= 4, 1 <= spp <= 256, repeats >= 1 (integers)');
  }
  const scenes = values.scenes.split(',').map(value => value.trim());
  if (scenes.some(scene => !/^[a-zA-Z0-9_-]+$/.test(scene))) throw new Error('Invalid scene name');
  for (const scene of scenes) {
    if (!existsSync(join(ROOT, 'scenes', 'pathtracer', `${scene}.usda`))) throw new Error(`Missing scene: ${scene}`);
  }
  const outDir = resolve(ROOT, values['out-dir'] ?? join('renders', 'pathtracer-benchmark', values.target));
  if (existsSync(join(outDir, 'report.json'))) throw new Error(`Report exists; use a new --out-dir: ${outDir}`);
  mkdirSync(outDir, { recursive: true });
  const adbPath = process.env.MX_ADB ?? 'D:\\platform-tools\\adb.exe';
  let serial = values.device;
  const adb = async (...args) => (await exec(adbPath, [...(serial ? ['-s', serial] : []), ...args], { timeout: 20000, maxBuffer: 2 ** 20 })).stdout.trim();
  const report = { target: values.target, startedAt: new Date().toISOString(), status: 'running',
    settings: { res, spp, repeats, variants: VARIANTS, warmups: 1, fireflyClamp: 0, denoise: false, tileSpp: 1 },
    environment: {}, results: [], summary: [] };
  const save = () => {
    report.summary = summarize(report.results);
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  };
  const thermal = async () => ({
    battery: (await adb('shell', 'dumpsys', 'battery')).split(/\r?\n/).filter(line => /^\s*(level|temperature|status):/.test(line)),
    thermal: (await adb('shell', 'dumpsys', 'thermalservice')).split(/\r?\n/).filter(line => /Thermal Status:|IsStatusOverride:/.test(line)),
  });
  let server, chrome, profile, cdp, forwardPort, reversePort, pageId, debugOrigin;
  try {
    report.environment.revision = (await exec('git', ['rev-parse', 'HEAD'], { cwd: ROOT })).stdout.trim();
    report.environment.worktree = (await exec('git', ['status', '--short'], { cwd: ROOT })).stdout.trim();
    if (values.target === 'mobile') {
      const devices = (await adb('devices')).split(/\r?\n/).filter(line => /\tdevice$/.test(line));
      if (!serial && devices.length !== 1) throw new Error('Expected exactly one authorized mobile; select --device if needed');
      serial ??= devices[0].split('\t')[0];
      if (await adb('get-state') !== 'device') throw new Error('Selected mobile is not authorized');
      report.environment.model = await adb('shell', 'getprop', 'ro.product.model');
      report.environment.os = await adb('shell', 'getprop', 'ro.build.version.release');
      report.environment.before = await thermal();
    }
    const { createServer } = await import('vite');
    server = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'),
      server: { host: '127.0.0.1', port: 0, strictPort: false, open: false, hmr: false } });
    await server.listen();
    const port = server.httpServer.address().port;
    const origin = `http://${values.target === 'mobile' ? 'localhost' : '127.0.0.1'}:${port}`;
    const pageUrl = `${origin}${HARNESS}`;
    const readiness = await fetch(`http://127.0.0.1:${port}${HARNESS}`);
    if (!readiness.ok) throw new Error('Harness HTTP readiness failed');
    if (values.target === 'mobile') {
      await adb('reverse', `tcp:${port}`, `tcp:${port}`);
      reversePort = port;
      forwardPort = Number(await adb('forward', 'tcp:0', 'localabstract:chrome_devtools_remote'));
      debugOrigin = `http://127.0.0.1:${forwardPort}`;
      await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${pageUrl}'`, 'com.android.chrome');
    } else {
      profile = mkdtempSync(join(tmpdir(), 'mx-pathtracer-benchmark-'));
      chrome = spawn(process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, pageUrl],
        { stdio: 'ignore' });
      chrome.on('error', error => console.error(`Chrome: ${error.message}`));
      const debugPort = await waitFor(() => {
        const path = join(profile, 'DevToolsActivePort');
        return existsSync(path) ? Number(readFileSync(path, 'utf8').split('\n')[0]) : false;
      }, 'desktop Chrome');
      debugOrigin = `http://127.0.0.1:${debugPort}`;
    }
    const page = await waitFor(async () => {
      const response = await fetch(`${debugOrigin}/json/list`, { signal: AbortSignal.timeout(10000) });
      return (await response.json()).find(item => item.type === 'page' && item.url === pageUrl);
    }, 'benchmark tab (keep mobile unlocked)');
    pageId = page.id;
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await waitFor(() => cdp.evaluate("typeof globalThis.__MX_RENDER__ === 'function'"), 'render harness');
    for (const scene of scenes) {
      let expected;
      for (let round = -1; round < repeats; round++) {
        const rotation = (round + 1) % VARIANTS.length;
        const variants = round < 0 ? VARIANTS : [...VARIANTS.slice(rotation), ...VARIANTS.slice(0, rotation)];
        for (const variant of variants) {
          const entry = `/scenes/pathtracer/${scene}.usda`;
          const query = new URLSearchParams({ entry, res: String(res),
            spp: String(spp), tileSpp: '1', backend: 'pathtracing', benchmark: '1', workgroup: variant, firefly: '0' });
          console.log(`[pathtracer-benchmark] ${values.target} ${scene} ${variant} ${round < 0 ? 'warmup' : `round ${round + 1}/${repeats}`}`);
          await cdp.evaluate(`void globalThis.__MX_RENDER__(${JSON.stringify(query.toString())})`);
          const image = await waitFor(async () => {
            const state = await cdp.evaluate(`(() => {
              if (('__MX_IMAGE__' in globalThis) && globalThis.__MX_IMAGE__ === null) throw new Error(document.body.innerText);
              if (/diag (device lost|uncaptured error)/i.test(document.body.innerText)) throw new Error(document.body.innerText);
              return globalThis.__MX_IMAGE__ ?? null;
            })()`);
            return state;
          }, `${scene}/${variant}`, 600000);
          if (!image.benchmark) throw new Error('Missing benchmark payload');
          if (image.entry !== entry || image.width !== res || image.samples !== spp) throw new Error('Unexpected image identity');
          if (image.stats.litFraction <= 0.01) throw new Error('Unexpected black image');
          const hdr = decodeHdr(image.benchmark.hdrBase64);
          if (hdr.length !== res * res * 4) throw new Error('Unexpected HDR dimensions');
          expected ??= hdr;
          const parity = compareHdr(expected, hdr, spp);
          if (!parity.identical) throw new Error(`HDR differs for ${scene}/${variant}: ${parity.maxAbsoluteError}`);
          report.environment.adapter = image.adapter;
          report.environment.userAgent = image.userAgent;
          const { hdrBase64, ...measurement } = image.benchmark;
          report.results.push({ scene, variant, round, warmup: round < 0, renderMs: image.renderMs,
            ...measurement, parity, timings: image.timings, memory: image.memory, stats: image.stats });
          if (round === 0) {
            const stem = join(outDir, `${scene}-${variant}`);
            writeFileSync(`${stem}.png`, Buffer.from(image.dataUrl.split(',')[1], 'base64'));
            writeFileSync(`${stem}.f32`, Buffer.from(hdrBase64, 'base64'));
          }
          save();
        }
      }
    }
    if (values.target === 'mobile') report.environment.after = await thermal();
    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
    save();
    console.table(report.summary);
    console.log(`Report: ${join(outDir, 'report.json')}`);
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack ?? String(error);
    save();
    throw error;
  } finally {
    if (cdp) {
      try { await cdp.evaluate('globalThis.__MX_IMAGE__ = undefined'); } catch (error) { console.error(`Page cleanup: ${error.message}`); }
      cdp.socket.close();
    }
    if (values.target === 'mobile' && pageId) {
      try { await fetch(`${debugOrigin}/json/close/${pageId}`, { signal: AbortSignal.timeout(10000) }); }
      catch (error) { console.error(`Tab cleanup: ${error.message}`); }
    }
    if (forwardPort) await adb('forward', '--remove', `tcp:${forwardPort}`);
    if (reversePort) await adb('reverse', '--remove', `tcp:${reversePort}`);
    if (chrome?.exitCode === null) {
      const closed = new Promise(resolveClose => chrome.once('close', resolveClose));
      chrome.kill();
      await closed;
    }
    if (profile) rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    await server?.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
