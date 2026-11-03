import { execFile, spawn } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { mkdirSync, writeFileSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { platform, release, version } from 'node:os';
import { sceneBufferCachePlugin } from './pathtracer-cache-server.mjs';

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const HARNESS = '/usd-image-harness.html?session=1';
const VARIANTS = ['8x8', '4x4', '16x4', '16x8'];

export function experimentVariants(bvhTest, cacheTest, round, bvhCandidate = 'triangleEdges') {
  const all = bvhTest ? ['reference', bvhCandidate] : cacheTest ? ['8x8'] : VARIANTS;
  const rotation = (round + 1) % all.length;
  return round < 0 ? [...all] : [...all.slice(rotation), ...all.slice(0, rotation)];
}

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

export function averageHdr(a, b, samples) {
  compareHdr(a, b, samples);
  const mean = new Float32Array(a.length);
  for (let i = 0; i < mean.length; i++) mean[i] = i % 4 === 3 ? 2 * samples : (a[i] + b[i]) / 2;
  compareHdr(mean, mean, 2 * samples);
  return mean;
}

export function hdrError(reference, candidate, referenceSamples, samples) {
  compareHdr(reference, reference, referenceSamples);
  compareHdr(candidate, candidate, samples);
  if (reference.length !== candidate.length) throw new Error('HDR dimensions differ');
  let squaredError = 0, squaredReference = 0;
  for (let i = 0; i < reference.length; i++) {
    if (i % 4 === 3) continue;
    squaredError += (candidate[i] - reference[i]) ** 2;
    squaredReference += reference[i] ** 2;
  }
  if (squaredReference === 0) throw new Error('Quality reference is black');
  const mse = squaredError / (reference.length / 4 * 3);
  return { mse, rmse: Math.sqrt(mse), relativeRmse: Math.sqrt(squaredError / squaredReference) };
}

export function compareSamplingSummaries(summary) {
  return summary.filter(row => row.variant === 'pcg').map(reference => {
    const candidate = summary.find(row => row.scene === reference.scene && row.variant === 'halton');
    const gpuBudgetDifferencePercent = candidate?.gpuMedianMs != null && reference.gpuMedianMs != null
      ? (candidate.gpuMedianMs / reference.gpuMedianMs - 1) * 100 : null;
    const rmseGainPercent = candidate && reference.rmseMedian > 0
      ? (1 - candidate.rmseMedian / reference.rmseMedian) * 100 : null;
    const comparableGpuBudget = gpuBudgetDifferencePercent !== null && Math.abs(gpuBudgetDifferencePercent) <= 3;
    return { scene: reference.scene, gpuBudgetDifferencePercent, comparableGpuBudget, rmseGainPercent,
      eligibleForConfirmation: comparableGpuBudget && rmseGainPercent >= 5 };
  });
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
      ...(group.every(row => row.quality) ? {
        rmseMedian: median(group.map(row => row.quality.rmse)),
        relativeRmseMedian: median(group.map(row => row.quality.relativeRmse)),
        rmseMin: Math.min(...group.map(row => row.quality.rmse)),
        rmseMax: Math.max(...group.map(row => row.quality.rmse)),
      } : { identical: group.every(row => row.parity?.identical === true) }),
    };
  });
}

export function compareBvhSummaries(summary, candidateVariant = 'triangleEdges') {
  return summary.filter(row => row.variant === 'reference').map(reference => {
    const candidate = summary.find(row => row.scene === reference.scene && row.variant === candidateVariant);
    const gain = (a, b) => a !== null && b !== null ? (a - b) / a * 100 : null;
    return {
      scene: reference.scene, candidateVariant,
      referenceGpuMedianMs: reference.gpuMedianMs, candidateGpuMedianMs: candidate?.gpuMedianMs ?? null,
      gpuGainPercent: gain(reference.gpuMedianMs, candidate?.gpuMedianMs ?? null),
      wallGainPercent: candidate ? gain(reference.wallMedianMs, candidate.wallMedianMs) : null,
      identical: reference.identical && candidate?.identical === true,
    };
  });
}

export function summarizeTraversalProfiles(results) {
  return summarizeReplayProfiles(results, 'traversalProfile', 'rayInputsIdentical');
}

export function summarizeArchitectureInventory(results) {
  const scenes = [...new Set(results.filter(row => !row.warmup).map(row => row.scene))];
  return scenes.map(scene => {
    const rows = results.filter(row => row.scene === scene);
    const inventory = rows[0].sceneMetadata?.instancing;
    if (!inventory || rows.some(row => row.variant !== 'reference' ||
      row.bsdfEvaluation !== 'reference' || row.bvhTraversal !== 'reference' ||
      row.workgroupSize?.join('x') !== '8x8' || !row.parity?.identical ||
      row.traversalProfile || row.shadingProfile ||
      JSON.stringify(row.sceneMetadata?.instancing) !== JSON.stringify(inventory) ||
      row.sceneMetadata?.triangleCount !== inventory.expandedTriangles)) {
      throw new Error(`Missing or inconsistent reference architecture inventory: ${scene}`);
    }
    return { scene, ...inventory,
      interpretation: 'Prototype-identity inventory, not measured BLAS/TLAS savings. Potential triangle reuse excludes transforms, material/displacement compatibility, TLAS and traversal costs. No wavefront speedup measured.' };
  });
}

export function summarizeShadingProfiles(results) {
  return summarizeReplayProfiles(results, 'shadingProfile', 'inputsIdentical').map(row => ({
    ...row, interpretation: 'Sensitivity to replaying integrator-facing BSDF eval/specular-eval/sample calls only; not additive shading time. Material graphs, textures, opacity, frames, traversal and other transport remain active.',
  }));
}

function summarizeReplayProfiles(results, field, inputFlag) {
  const measured = results.filter(row => !row.warmup);
  const scenes = [...new Set(measured.filter(row => row.variant === 'profile').map(row => row.scene))];
  return scenes.map(scene => {
    const rows = measured.filter(row => row.scene === scene && row.variant === 'profile');
    const references = measured.filter(row => row.scene === scene && row.variant === 'reference');
    const gpuMedian = values => values.length && values.every(value => Number.isFinite(value) && value > 0) ? median(values) : null;
    for (const row of rows) {
      const profile = row[field];
      if (!profile?.[inputFlag] || !profile.eventCountsIdentical || !profile.replayMismatchDetected ||
        !profile.stages || profile.stages.length !== 4 ||
        profile.stages.some((stage, index) => stage.mode !==
          [1, 3, ...(profile.replayFirst ? [2, 0] : [0, 2])][index] || !stage.identical)) {
        throw new Error(`Missing exact ${field} checks: ${scene}`);
      }
      if (JSON.stringify(profile.workload) !== JSON.stringify(rows[0][field].workload)) {
        throw new Error(`Profile workload changed between repetitions: ${scene}`);
      }
    }
    const referenceGpuMedianMs = gpuMedian(references.map(row => row.gpuMs));
    const controlGpuMedianMs = gpuMedian(rows.map(row => row.gpuMs));
    const replayTimes = rows.map(row => row[field].stages.find(stage => stage.mode === 2).gpuMs);
    const controlTimes = rows.map(row => row.gpuMs);
    const replayGpuMedianMs = gpuMedian(replayTimes);
    const pairedReductions = rows.map((row, index) => {
      const control = row.gpuMs, replay = replayTimes[index];
      return Number.isFinite(control) && control > 0 && Number.isFinite(replay) && replay > 0
        ? (1 - replay / control) * 100 : null;
    });
    const validPairs = pairedReductions.every(value => value !== null);
    const orderReduction = replayFirst => {
      const values = rows.map((row, index) => row[field].replayFirst === replayFirst ? pairedReductions[index] : null)
        .filter(value => value !== null);
      return values.length ? median(values) : null;
    };
    return {
      scene, repetitions: rows.length, referenceGpuMedianMs, controlGpuMedianMs, replayGpuMedianMs,
      controlGpuMinMs: controlGpuMedianMs !== null ? Math.min(...controlTimes) : null,
      controlGpuMaxMs: controlGpuMedianMs !== null ? Math.max(...controlTimes) : null,
      replayGpuMinMs: replayGpuMedianMs !== null ? Math.min(...replayTimes) : null,
      replayGpuMaxMs: replayGpuMedianMs !== null ? Math.max(...replayTimes) : null,
      captureGpuMedianMs: gpuMedian(rows.map(row => row[field].stages[0].gpuMs)),
      verifyGpuMedianMs: gpuMedian(rows.map(row => row[field].stages[1].gpuMs)),
      controlOverheadPercent: referenceGpuMedianMs !== null && controlGpuMedianMs !== null
        ? (controlGpuMedianMs / referenceGpuMedianMs - 1) * 100 : null,
      replayReductionPercent: controlGpuMedianMs !== null && replayGpuMedianMs !== null
        ? (1 - replayGpuMedianMs / controlGpuMedianMs) * 100 : null,
      pairedReductionMedianPercent: validPairs ? median(pairedReductions) : null,
      pairedReductionMinPercent: validPairs ? Math.min(...pairedReductions) : null,
      pairedReductionMaxPercent: validPairs ? Math.max(...pairedReductions) : null,
      replayFirstReductionMedianPercent: orderReduction(true),
      controlFirstReductionMedianPercent: orderReduction(false),
      workload: rows[0][field].workload,
      interpretation: 'Sensitivity experiment, not additive BVH/shading time or hardware bandwidth/occupancy counters.',
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

export async function debuggerPages(origin) {
  try {
    const response = await fetch(`${origin}/json/list`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`CDP page list HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (!['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes(error.cause?.code)) throw error;
    console.warn(`CDP not ready (${error.cause.code}); retrying within startup timeout`);
    return [];
  }
}

async function connect(url) {
  const socket = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const diagnostics = [];
  socket.addEventListener('message', event => {
    const response = JSON.parse(event.data);
    if (response.method === 'Runtime.exceptionThrown' || response.method === 'Log.entryAdded') diagnostics.push(response);
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
    if (socket.readyState !== WebSocket.OPEN) { reject(new Error('CDP connection closed')); return; }
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
  return { socket, send, evaluate, diagnostics };
}

function decodeHdr(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length % 4) throw new Error('Invalid HDR byte length');
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

async function main() {
  const { values } = parseArgs({ options: {
    target: { type: 'string', default: 'local' },
    res: { type: 'string' },
    spp: { type: 'string' },
    repeats: { type: 'string', default: '5' },
    scenes: { type: 'string', default: 'test_material_disney_gold,renderman_teapot_cloth,renderman_teapot_tiles' },
    'out-dir': { type: 'string' },
    device: { type: 'string' },
    'cache-test': { type: 'boolean', default: false },
    'bvh-test': { type: 'boolean', default: false },
    'bvh-candidate': { type: 'string' },
    'sampling-test': { type: 'boolean', default: false },
    'profile-test': { type: 'boolean', default: false },
    'shading-profile': { type: 'boolean', default: false },
    'bsdf-test': { type: 'boolean', default: false },
    'architecture-test': { type: 'boolean', default: false },
    'reference-spp': { type: 'string', default: '256' },
  } });
  if (!['local', 'mobile'].includes(values.target)) throw new Error('--target must be local or mobile');
  const shadingTest = values['shading-profile'];
  const bsdfTest = values['bsdf-test'];
  const architectureTest = values['architecture-test'];
  const profileTest = values['profile-test'] || shadingTest;
  const bvhCandidate = values['bvh-candidate'] ?? 'triangleEdges';
  if (!['cachedEntry', 'leafOrder', 'triangleEdges', 'bvh4'].includes(bvhCandidate) ||
      values['bvh-candidate'] !== undefined && !values['bvh-test']) {
    throw new Error('--bvh-candidate requires --bvh-test and a supported non-reference traversal');
  }
  const res = Number(values.res ?? (shadingTest || architectureTest ? 32 : profileTest ? 64 : 128)),
    spp = Number(values.spp ?? (shadingTest || architectureTest ? 1 : profileTest ? 2 : 8)), repeats = Number(values.repeats);
  const samplingTest = values['sampling-test'];
  const referenceSpp = Number(values['reference-spp']);
  if ([values['bvh-test'], values['cache-test'], samplingTest, values['profile-test'], shadingTest, bsdfTest, architectureTest].filter(Boolean).length > 1) {
    throw new Error('Choose only one experiment: --bvh-test, --cache-test, --sampling-test, --profile-test, --shading-profile, --bsdf-test or --architecture-test');
  }
  if (profileTest && repeats < 5) throw new Error('--profile-test requires at least five repeats');
  if (samplingTest && (repeats < 5 || repeats > 1000)) throw new Error('--sampling-test requires 5 to 1000 independent seeds');
  if (samplingTest && (!Number.isInteger(referenceSpp) || referenceSpp < 32 * spp || referenceSpp > 256)) {
    throw new Error('--reference-spp must be an integer >= 32 times --spp and <= 256');
  }
  if (values['bvh-test'] && repeats < 5) throw new Error('--bvh-test requires at least five repeats');
  if (bsdfTest && repeats < 5) throw new Error('--bsdf-test requires at least five repeats');
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
    settings: { res, spp, repeats, variants: architectureTest ? ['reference'] : bsdfTest ? ['reference', 'unrolled'] : profileTest ? ['reference', 'profile'] : samplingTest ? ['pcg', 'halton'] : values['bvh-test'] ? ['reference', bvhCandidate] : values['cache-test'] ? ['8x8'] : VARIANTS,
      ...(architectureTest ? { architectureTest: true, workgroup: '8x8',
        interpretation: 'Reference-only geometry inventory and reproducibility check; not BLAS/TLAS or wavefront performance qualification.' } : {}),
      ...(bsdfTest ? { bsdfTest: true, workgroup: '8x8', acceptance: { minGpuGainPercent: 5, maxRegressionPercent: 3, confirmationRequired: true } } : {}),
      cacheTest: values['cache-test'], bvhTest: values['bvh-test'], ...(values['bvh-test'] ? { workgroup: '8x8' } : {}),
      ...(samplingTest ? { samplingTest: true, referenceSppPerSeed: referenceSpp, referenceSeeds: [1048576, 2097152],
        referenceSpp: 2 * referenceSpp, seedCount: repeats, workgroup: '8x8',
        acceptance: { maxGpuBudgetDifferencePercent: 3, minRmseGainPercent: 5, confirmationRequired: true } } : {}),
      ...(profileTest ? { profileTest: true, profileKind: shadingTest ? 'bsdf' : 'traversal', workgroup: '8x8', stages: ['control', 'capture', 'verify', 'replay'],
        interpretation: 'Diagnostic only, no renderer acceleration or hardware-counter attribution.' } : {}),
      warmups: 1, fireflyClamp: 0, denoise: false, tileSpp: 1 },
    environment: { host: { platform: platform(), release: release(), version: version() } }, results: [], summary: [] };
  const save = () => {
    report.summary = summarize(report.results);
    if (values['bvh-test']) report.comparison = compareBvhSummaries(report.summary, bvhCandidate);
    if (bsdfTest) report.comparison = compareBvhSummaries(report.summary, 'unrolled');
    if (samplingTest) report.comparison = compareSamplingSummaries(report.summary);
    if (profileTest && !shadingTest) report.traversalProfiles = summarizeTraversalProfiles(report.results);
    if (shadingTest) report.shadingProfiles = summarizeShadingProfiles(report.results);
    if (architectureTest) report.architectureInventory = summarizeArchitectureInventory(report.results);
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
    const startServer = async (port = 0) => {
      const instance = await createServer({ root: ROOT, configFile: join(ROOT, 'vite.config.ts'),
        plugins: [sceneBufferCachePlugin(ROOT)],
        server: { host: '127.0.0.1', port, strictPort: true, open: false, hmr: false } });
      await instance.listen();
      return instance;
    };
    server = await startServer();
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
      mkdirSync(join(ROOT, '.cache'), { recursive: true });
      profile = mkdtempSync(join(ROOT, '.cache', 'mx-pathtracer-benchmark-'));
      chrome = spawn(process.env.MX_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        ['--headless=new', '--enable-unsafe-webgpu', '--remote-debugging-port=0', `--user-data-dir=${profile}`, pageUrl],
        { stdio: 'ignore' });
      chrome.on('error', error => console.error(`Chrome: ${error.message}`));
      const debugPort = await waitFor(() => {
        const path = join(profile, 'DevToolsActivePort');
        if (!existsSync(path)) return false;
        try {
          return Number(readFileSync(path, 'utf8').split('\n')[0]);
        } catch (error) {
          if (error.code !== 'EBUSY') throw error;
          console.warn('Chrome is still writing DevToolsActivePort (EBUSY); retrying startup.');
          return false;
        }
      }, 'desktop Chrome');
      debugOrigin = `http://127.0.0.1:${debugPort}`;
    }
    const page = await waitFor(async () => {
      return (await debuggerPages(debugOrigin)).find(item => item.type === 'page' && item.url === pageUrl);
    }, 'benchmark tab (keep mobile unlocked)');
    pageId = page.id;
    cdp = await connect(page.webSocketDebuggerUrl);
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Page.enable');
    await cdp.send('Page.bringToFront');
    await waitFor(() => cdp.evaluate("typeof globalThis.__MX_RENDER__ === 'function'"), 'render harness');
    for (const scene of scenes) {
      if (samplingTest || profileTest || bsdfTest || architectureTest) {
        const sceneUrl = `${pageUrl}&qualityScene=${scene}`;
        await cdp.send('Page.navigate', { url: sceneUrl });
        await waitFor(async () => {
          try {
            return await cdp.evaluate(`location.href === ${JSON.stringify(sceneUrl)} && document.readyState === 'complete' && typeof globalThis.__MX_RENDER__ === 'function'`);
          } catch (error) {
            if (/context.*destroyed|Cannot find context/i.test(error.message)) return false;
            throw error;
          }
        }, 'fresh sampling scene harness');
      }
      let expected;
      let firstReference, qualityReference;
      const warmupHdr = new Map();
      for (let round = samplingTest ? -3 : -1; round < (values['cache-test'] ? 3 : repeats); round++) {
        const isQualityReference = samplingTest && round < -1;
        const renderSpp = isQualityReference ? referenceSpp : spp;
        const sampleSeed = samplingTest ? (isQualityReference ? [1048576, 2097152][round + 3] : Math.max(1, round + 1)) : 0;
        const variants = architectureTest ? ['reference'] : profileTest ? round % 2 === 0 ? ['profile', 'reference'] : ['reference', 'profile'] :
          samplingTest ? isQualityReference ? ['pcg'] :
          round % 2 === 0 ? ['halton', 'pcg'] : ['pcg', 'halton'] :
          experimentVariants(values['bvh-test'] || bsdfTest, values['cache-test'], round, bsdfTest ? 'unrolled' : bvhCandidate);
        const roundThermal = values.target === 'mobile' ? await thermal() : undefined;
        for (const variant of variants) {
          const cacheMode = values['cache-test'] ? ['refresh', 'use', 'verify', 'bypass'][round + 1] : 'use';
          if (values['cache-test'] && round === 0) {
            await server.close();
            server = await startServer(port);
            const response = await fetch(`http://127.0.0.1:${port}${HARNESS}`);
            if (!response.ok) throw new Error('Cache server restart failed readiness');
            report.environment.cacheServerRestarted = true;
          }
          if (values['cache-test'] && round >= 0) {
            const reloadUrl = `${pageUrl}&cacheReload=${scene}-${round}`;
            (report.diagnostics ??= []).push(...cdp.diagnostics);
            cdp.socket.close();
            await fetch(`${debugOrigin}/json/close/${pageId}`, { signal: AbortSignal.timeout(10000) });
            pageId = undefined;
            if (values.target === 'mobile') {
              await adb('shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${reloadUrl}'`, 'com.android.chrome');
            } else {
              const response = await fetch(`${debugOrigin}/json/new?${encodeURIComponent(reloadUrl)}`, { method: 'PUT', signal: AbortSignal.timeout(10000) });
              if (!response.ok) throw new Error('Could not create reload tab');
            }
            const reloadPage = await waitFor(async () => {
              return (await debuggerPages(debugOrigin)).find(item => item.type === 'page' && item.url === reloadUrl);
            }, 'reload tab');
            pageId = reloadPage.id;
            cdp = await connect(reloadPage.webSocketDebuggerUrl);
            await cdp.send('Runtime.enable');
            await cdp.send('Log.enable');
            await cdp.send('Page.enable');
            await cdp.send('Page.bringToFront');
            await waitFor(async () => {
              try {
                return await cdp.evaluate(`location.href === ${JSON.stringify(reloadUrl)} && document.readyState === 'complete' && typeof globalThis.__MX_RENDER__ === 'function'`);
              } catch (error) {
                if (/Not attached to an active page|context.*destroyed|Cannot find context/i.test(error.message)) return false;
                throw error;
              }
            }, 'reloaded render harness');
          }
          if (!await cdp.evaluate("document.visibilityState === 'visible'")) throw new Error('Benchmark tab hidden; keep the mobile unlocked and Chrome foregrounded');
          const entry = `/scenes/pathtracer/${scene}.usda`;
          const query = new URLSearchParams({ entry, res: String(res),
            spp: String(renderSpp), tileSpp: '1', backend: 'pathtracing', benchmark: '1',
            workgroup: values['bvh-test'] || samplingTest || profileTest || bsdfTest || architectureTest ? '8x8' : variant,
            bvh: values['bvh-test'] ? variant : 'reference', firefly: '0', cache: cacheMode });
          if (bsdfTest) query.set('bsdf', variant);
          if (samplingTest) {
            query.set('sampler', variant);
            query.set('seed', String(sampleSeed));
          }
          if (profileTest && variant === 'profile') {
            query.set(shadingTest ? 'profileShading' : 'profileTraversal', '1');
            if (round % 2 === 0) query.set('profileReplayFirst', '1');
          }
          if (values['bvh-test']) query.set('bvhCheck', '1');
          console.log(`[pathtracer-benchmark] ${values.target} ${scene} ${variant} ${isQualityReference ? `reference ${renderSpp} spp seed ${sampleSeed}` : values['cache-test'] ? `cache ${cacheMode}` : round < 0 ? 'warmup' : `round ${round + 1}/${repeats}`}`);
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
          const fileCache = image.benchmark.sceneBufferCache;
          if (values['cache-test']) {
            const expectedStatus = { refresh: 'refresh', use: 'hit', verify: 'hit', bypass: 'bypass' }[cacheMode];
            if (fileCache?.status !== expectedStatus) throw new Error(`Expected cache ${expectedStatus}: ${JSON.stringify(fileCache)}`);
            if (cacheMode === 'verify' && fileCache.geometryIdentical !== true) throw new Error('Missing byte-for-byte geometry verification');
          }
          if (image.entry !== entry || image.width !== res || image.samples !== renderSpp) throw new Error('Unexpected image identity');
          if (image.stats.litFraction <= 0.01) throw new Error('Unexpected black image');
          const hdr = decodeHdr(image.benchmark.hdrBase64);
          if (hdr.length !== res * res * 4) throw new Error('Unexpected HDR dimensions');
          if ((samplingTest || profileTest || bsdfTest || architectureTest) && (image.benchmark.counters?.samplesPerPixel !== renderSpp ||
            image.benchmark.counters?.totalSamples !== res * res * renderSpp)) throw new Error('Unexpected sample counters');
          compareHdr(hdr, hdr, renderSpp);
          if (bsdfTest && (image.benchmark.bsdfEvaluation !== variant ||
            image.benchmark.bvhTraversal !== 'reference' || image.benchmark.workgroupSize.join('x') !== '8x8' ||
            image.benchmark.traversalProfile || image.benchmark.shadingProfile)) {
            throw new Error('Unexpected BSDF candidate, traversal, workgroup or profiling instrumentation');
          }
          if (profileTest && (image.benchmark.bvhTraversal !== 'reference' ||
            image.benchmark.workgroupSize.join('x') !== '8x8')) throw new Error('Unexpected profiling traversal/workgroup');
          if (profileTest && variant === 'profile' && !image.benchmark[shadingTest ? 'shadingProfile' : 'traversalProfile']) {
            throw new Error('Missing requested replay profile');
          }
          let parity, quality;
          if (samplingTest) {
            if (image.benchmark.cameraSampler !== variant || image.benchmark.sampleSeed !== sampleSeed ||
              image.benchmark.bvhTraversal !== 'reference' || image.benchmark.workgroupSize.join('x') !== '8x8') {
              throw new Error('Unexpected sampling/BVH/workgroup variant');
            }
            if (isQualityReference) {
              if (!firstReference) firstReference = hdr;
              else {
                qualityReference = averageHdr(firstReference, hdr, referenceSpp);
                const noise = hdrError(firstReference, hdr, referenceSpp, referenceSpp).rmse / 2;
                (report.qualityReferences ??= []).push({ scene, samples: 2 * referenceSpp,
                  estimatedNoiseRmse: noise, note: 'Two-seed noise estimate, not a ground-truth error bound' });
                writeFileSync(join(outDir, `${scene}-reference-mean.f32`), Buffer.from(qualityReference.buffer));
              }
              writeFileSync(join(outDir, `${scene}-reference-${sampleSeed}.f32`), Buffer.from(hdr.buffer));
            } else {
              if (!qualityReference) throw new Error('Missing high-spp quality reference');
              quality = hdrError(qualityReference, hdr, 2 * referenceSpp, spp);
              if (round === -1) warmupHdr.set(variant, hdr);
              if (round === 0) {
                parity = compareHdr(warmupHdr.get(variant), hdr, spp);
                if (!parity.identical) throw new Error('Sampling seed is not reproducible after warmup');
              }
            }
          } else {
            expected ??= hdr;
            parity = compareHdr(expected, hdr, spp);
          }
          report.environment.adapter = image.adapter;
          report.environment.userAgent = image.userAgent;
          const { hdrBase64, ...measurement } = image.benchmark;
          report.results.push({ scene, variant, round, cacheMode, warmup: round < 0, renderMs: image.renderMs,
            ...measurement, ...(parity ? { parity } : {}), ...(quality ? { quality } : {}),
            ...(isQualityReference ? { role: 'quality-reference' } : {}),
            timings: image.timings, memory: image.memory, stats: image.stats,
            ...(roundThermal ? { thermal: roundThermal } : {}) });
          save();
          if (parity && !parity.identical) throw new Error(`HDR differs for ${scene}/${variant}: ${parity.maxAbsoluteError}`);
          if (values['bvh-test'] && (image.benchmark.bvhTraversal !== variant ||
            image.benchmark.workgroupSize.join('x') !== '8x8')) throw new Error('Unexpected BVH/workgroup variant');
          if (values['bvh-test'] && bvhCandidate === 'bvh4' &&
              image.benchmark.sceneMetadata?.bvhLayout !== (variant === 'bvh4' ? 'bvh4' : 'reference')) {
            throw new Error('Unexpected BVH node representation');
          }
          if (values['bvh-test'] && (image.benchmark.counters?.samplesPerPixel !== spp ||
            image.benchmark.counters?.totalSamples !== res * res * spp)) throw new Error('Unexpected sample counters');
          if (values['bvh-test'] && (!image.benchmark.traversalChecks?.identical ||
            !image.benchmark.traversalChecks?.semanticTriangleIds ||
            !image.benchmark.traversalChecks?.displacementEdgeUpdate ||
            bvhCandidate === 'bvh4' && !image.benchmark.traversalChecks?.bvh4)) {
            throw new Error('Missing exact BVH/displacement GPU corpus parity');
          }
          if (round === 0 || samplingTest && round > 0) {
            const stem = join(outDir, `${scene}-${variant}${samplingTest ? `-seed${sampleSeed}` : ''}`);
            writeFileSync(`${stem}.png`, Buffer.from(image.dataUrl.split(',')[1], 'base64'));
            writeFileSync(`${stem}.f32`, Buffer.from(hdrBase64, 'base64'));
          }
          save();
        }
      }
    }
    if (values.target === 'mobile') report.environment.after = await thermal();
    (report.diagnostics ??= []).push(...cdp.diagnostics);
    report.status = 'passed';
    report.finishedAt = new Date().toISOString();
    save();
    console.table(report.summary);
    console.log(`Report: ${join(outDir, 'report.json')}`);
  } catch (error) {
    report.status = 'failed';
    report.error = error.stack ?? String(error);
    if (cdp) {
      (report.diagnostics ??= []).push(...cdp.diagnostics);
      try { report.page = await cdp.evaluate('({ url: location.href, text: document.body.innerText })'); }
      catch (pageError) { report.pageError = pageError.message; }
    }
    save();
    throw error;
  } finally {
    const cleanup = async (label, action) => {
      try { await action(); }
      catch (error) {
        console.error(`${label}: ${error.message}`);
        (report.cleanupErrors ??= []).push(`${label}: ${error.message}`);
        process.exitCode = 1;
      }
    };
    if (chrome && cdp) await cleanup('Browser close', async () => {
      try { await cdp.send('Browser.close'); }
      catch (error) {
        if (error.message !== 'CDP connection closed') throw error;
        await waitFor(() => chrome.exitCode !== null || chrome.signalCode !== null, 'Chrome exit after CDP disconnect', 10000);
      }
    });
    cdp?.socket.close();
    if (values.target === 'mobile' && pageId) await cleanup('Tab close',
      () => fetch(`${debugOrigin}/json/close/${pageId}`, { signal: AbortSignal.timeout(10000) }));
    if (forwardPort) await cleanup('ADB forward removal', () => adb('forward', '--remove', `tcp:${forwardPort}`));
    if (reversePort) await cleanup('ADB reverse removal', () => adb('reverse', '--remove', `tcp:${reversePort}`));
    if (chrome?.exitCode === null && chrome.signalCode === null) await cleanup('Chrome exit', async () => {
      await sleep(500);
      if (chrome.exitCode !== null || chrome.signalCode !== null) return;
      const closed = new Promise(resolveClose => chrome.once('close', resolveClose));
      chrome.kill();
      await closed;
    });
    if (profile) await cleanup('Temporary profile removal',
      () => rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));
    await cleanup('Server close', async () => server?.close());
    if (report.cleanupErrors) { report.status = 'failed'; save(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
