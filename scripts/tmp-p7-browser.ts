import { MaterialXEngine } from '../src/engine.ts';
import type { EngineStatus } from '../src/engine.ts';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function canvas(size = 256): HTMLCanvasElement {
  const element = document.createElement('canvas');
  element.width = size; element.height = size;
  document.body.appendChild(element);
  return element;
}

export async function profileLoad(url: string) {
  performance.clearMeasures();
  const engine = await MaterialXEngine.createHeadless({ width: 256, height: 256 });
  try {
    const t0 = performance.now();
    await engine.loadUsd(url);
    const loaded = performance.now();
    await engine.capture();
    const measures: Record<string, number> = {};
    for (const m of performance.getEntriesByType('measure')) measures[m.name] = (measures[m.name] ?? 0) + m.duration;
    return { load: loaded - t0, firstRaster: performance.now() - t0, measures };
  } finally { engine.dispose(); }
}

/** Default WebGPU limits: the path tracer exceeds maxStorageBuffersPerShaderStage on lit scenes. */
export async function fallback(url: string) {
  const adapter = (await navigator.gpu.requestAdapter())!;
  const device = await adapter.requestDevice();
  let status: EngineStatus | undefined;
  const engine = await MaterialXEngine.create(canvas(), { device, onStatus: s => { status = s; } });
  try {
    await engine.loadUsd(url);
    await engine.render({ backend: 'pathtracing' });
    for (let i = 0; i < 200 && !status?.fallback; i++) await sleep(100);
    await sleep(500);
    return {
      limits: { storage: device.limits.maxStorageBuffersPerShaderStage },
      pathtracingSupported: engine.capabilities.backends.pathtracing,
      fallback: status?.fallback, drawCount: status?.drawCount, pathTracer: status?.pathTracer,
      codes: engine.diagnostics.map(d => d.code).filter(Boolean),
    };
  } finally { engine.dispose(); device.destroy(); }
}

export async function budget(url: string, megabytes: number) {
  const engine = await MaterialXEngine.createHeadless({ width: 128, height: 128, memoryBudget: megabytes * 2 ** 20, telemetry: true });
  try {
    await engine.loadUsd(url);
    const before = engine.gpuMemory;
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if (engine.diagnostics.some(d => d.code === 'memory-budget-exceeded') || engine.gpuMemory.total <= megabytes * 2 ** 20) break;
    }
    await sleep(1000);
    const image = await engine.capture();
    let sum = 0; for (let i = 0; i < image.rgba.length; i += 4) sum += image.rgba[i]!;
    return {
      before, after: engine.gpuMemory,
      diagnostics: engine.diagnostics.filter(d => d.code).map(d => `${d.code}: ${d.message}`).slice(0, 12),
      meanRed: sum / (image.rgba.length / 4),
    };
  } finally { engine.dispose(); }
}

export async function telemetry(url: string) {
  const engine = await MaterialXEngine.createHeadless({ width: 128, height: 128, telemetry: true });
  try {
    await engine.loadUsd(url);
    await engine.capture();
    await engine.capture({ backend: 'pathtracing', samples: 8 });
    await sleep(500);
    const snapshot = engine.telemetry()!;
    return { gpuTimings: engine.capabilities.gpuTimings, adapter: engine.capabilities.adapter,
      phases: Object.keys(snapshot.phases), gpu: snapshot.gpu, uploads: snapshot.uploads, memory: snapshot.memory,
      exportBytes: engine.exportDiagnostics().length };
  } finally { engine.dispose(); }
}

export async function streaming(url: string, enabled: string, runs = 1) {
  const results = [];
  for (let run = 0; run < runs; run++) {
    performance.clearMeasures();
    const stages: string[] = [];
    const engine = await MaterialXEngine.create(canvas(512), {
      streaming: enabled === 'true',
      onStatus: s => { const stage = s.loading ? `${s.loading.stage}:${s.loading.pendingGeometry}:${s.loading.pendingTextures}` : 'final'; if (stages.at(-1) !== stage) stages.push(stage); },
    });
    const t0 = performance.now();
    await engine.loadUsd(url);
    const load = performance.now() - t0;
    await sleep(1500);
    const measure = (name: string) => performance.getEntriesByType('measure').find(m => m.name === name)?.duration;
    const builds = performance.getEntriesByType('measure').filter(m => m.name === 'viewer:preview-build').map(m => ({ at: Math.round(m.startTime - t0), ms: Math.round(m.duration), ...(m as PerformanceMeasure).detail }));
    const phases = Object.fromEntries(performance.getEntriesByType('measure').filter(m => m.name.startsWith('usd:')).map(m => [m.name, Math.round(m.startTime - t0) + '+' + Math.round(m.duration)]));
    results.push({ builds, phases, load, firstPreview: measure('viewer:first-preview'), firstFrame: measure('viewer:first-frame'), stages: stages.slice(0, 12), stageCount: stages.length });
    engine.dispose();
  }
  return results;
}
