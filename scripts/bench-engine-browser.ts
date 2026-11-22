// Browser side of `npm run bench:engine`: measures a scene through the public
// engine API only (createHeadless + loadUsd + capture). The Node side computes
// errors against reference images and compares runs.
import { MaterialXEngine, type EngineCapture } from '../src/engine.ts';

export interface BenchOptions {
  scene: string;
  width: number;
  height: number;
  samples: number;
  repeats: number;
  /** Also capture this many samples per pixel as a reference image. */
  referenceSamples?: number;
  /** Record a timeline of GPU submissions, waits and shader modules (diagnosis). */
  timeline?: boolean;
}

export interface BenchImage { width: number; height: number; rgba: string }

export interface BenchResult {
  loadMs: number;
  firstRasterMs: number;
  /** First path-traced capture: CPU scene preparation, BVH, pipeline compilation and the samples. */
  firstPathTraceMs: number;
  /** Median of `repeats` warm captures of `samples` samples per pixel. */
  captureMs: number[];
  /** Reload of the same scene in the same engine up to its first path-traced image. */
  reloadToPathTraceMs: number;
  reloadPhases: Record<string, number>;
  objects: number;
  gpu: string;
  jsHeapBytes?: number;
  image: BenchImage;
  reference?: BenchImage;
  diagnostics: string[];
  /** Total duration of the engine's `performance.measure` entries by name, during load and the first path-traced capture. */
  phases: Record<string, number>;
  /** Every pipeline created during the run, with its WGSL size. */
  shaders: ShaderStat[];
  timeline?: string[];
}

function encode({ width, height, rgba }: EngineCapture): BenchImage {
  let binary = '';
  for (let i = 0; i < rgba.length; i += 0x8000) binary += String.fromCharCode(...rgba.subarray(i, i + 0x8000));
  return { width, height, rgba: btoa(binary) };
}

export interface ShaderStat { label: string; kind: 'compute' | 'render'; codeBytes: number; codeHash: string; ms: number }

function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Record WGSL size and pipeline creation time; Dawn compiles WGSL when the pipeline is created. */
function profilePipelines(stats: ShaderStat[]): () => void {
  const proto = GPUDevice.prototype;
  const { createShaderModule, createComputePipelineAsync, createRenderPipelineAsync, createComputePipeline, createRenderPipeline } = proto;
  const sizes = new WeakMap<GPUShaderModule, { bytes: number; hash: string }>();
  proto.createShaderModule = function (descriptor) {
    const module = createShaderModule.call(this, descriptor);
    sizes.set(module, { bytes: descriptor.code.length, hash: hash(descriptor.code) });
    if ((globalThis as { __benchKeepWgsl?: boolean }).__benchKeepWgsl) {
      ((globalThis as { __benchWgsl?: string[] }).__benchWgsl ??= []).push(descriptor.code);
    }
    return module;
  };
  const wrap = <D extends GPUComputePipelineDescriptor | GPURenderPipelineDescriptor, P>(
    kind: ShaderStat['kind'], create: (this: GPUDevice, descriptor: D) => Promise<P>, module: (descriptor: D) => GPUShaderModule,
  ) => async function (this: GPUDevice, descriptor: D): Promise<P> {
    const start = performance.now();
    try { return await create.call(this, descriptor); }
    finally {
      const shader = module(descriptor);
      const size = sizes.get(shader);
      stats.push({ label: shader.label || descriptor.label || kind, kind, codeBytes: size?.bytes ?? 0, codeHash: size?.hash ?? '', ms: performance.now() - start });
    }
  };
  proto.createComputePipelineAsync = wrap('compute', createComputePipelineAsync, descriptor => descriptor.compute.module);
  proto.createRenderPipelineAsync = wrap('render', createRenderPipelineAsync, descriptor => descriptor.vertex.module);
  const wrapSync = <D extends GPUComputePipelineDescriptor | GPURenderPipelineDescriptor, P>(
    kind: ShaderStat['kind'], create: (this: GPUDevice, descriptor: D) => P, module: (descriptor: D) => GPUShaderModule,
  ) => function (this: GPUDevice, descriptor: D): P {
    const start = performance.now();
    try { return create.call(this, descriptor); }
    finally {
      const shader = module(descriptor);
      const size = sizes.get(shader);
      stats.push({ label: `sync ${shader.label || descriptor.label || kind}`, kind, codeBytes: size?.bytes ?? 0, codeHash: size?.hash ?? '', ms: performance.now() - start });
    }
  };
  proto.createComputePipeline = wrapSync('compute', createComputePipeline, descriptor => descriptor.compute.module);
  proto.createRenderPipeline = wrapSync('render', createRenderPipeline, descriptor => descriptor.vertex.module);
  const queue = GPUQueue.prototype;
  const { submit, onSubmittedWorkDone } = queue;
  const log = (globalThis as { __benchTimeline?: string[] }).__benchTimeline;
  if (log) {
    queue.submit = function (buffers) { log.push(`${performance.now().toFixed(0)} submit ${[...buffers].length}`); return submit.call(this, buffers); };
    queue.onSubmittedWorkDone = async function () {
      const t = performance.now();
      await onSubmittedWorkDone.call(this);
      log.push(`${t.toFixed(0)} workDone waited ${(performance.now() - t).toFixed(0)}`);
    };
    const original = proto.createShaderModule;
    proto.createShaderModule = function (descriptor) {
      log.push(`${performance.now().toFixed(0)} module ${descriptor.label ?? ''} ${descriptor.code.length}`);
      return original.call(this, descriptor);
    };
  }
  return () => {
    Object.assign(proto, { createShaderModule, createComputePipelineAsync, createRenderPipelineAsync, createComputePipeline, createRenderPipeline });
    Object.assign(queue, { submit, onSubmittedWorkDone });
  };
}

export async function benchScene(options: BenchOptions): Promise<BenchResult> {
  const diagnostics: string[] = [];
  const shaders: ShaderStat[] = [];
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  const info = adapter?.info;
  const gpu = info ? `${info.vendor} ${info.architecture} ${info.device} ${info.description}`.trim() : 'unknown';
  if (options.timeline) (globalThis as { __benchTimeline?: string[] }).__benchTimeline = [];
  const restore = profilePipelines(shaders);
  const engine = await MaterialXEngine.createHeadless({
    width: options.width, height: options.height,
    onDiagnostic: diagnostic => { if (diagnostic.level !== 'info') diagnostics.push(`${diagnostic.level}: ${diagnostic.message}`); },
  });
  try {
    performance.clearMeasures();
    let start = performance.now();
    await engine.loadUsd(new URL(options.scene, document.baseURI));
    const loadMs = performance.now() - start;
    start = performance.now();
    await engine.capture();
    const firstRasterMs = performance.now() - start;
    const pathTrace = { backend: 'pathtracing', samples: options.samples } as const;
    start = performance.now();
    let image = await engine.capture(pathTrace);
    const firstPathTraceMs = performance.now() - start;
    start = performance.now();
    await engine.capture();
    const rasterAfterPathTraceMs = performance.now() - start;
    const phases: Record<string, number> = {};
    for (const entry of performance.getEntriesByType('measure')) phases[entry.name] = (phases[entry.name] ?? 0) + entry.duration;
    const captureMs: number[] = [];
    for (let i = 0; i < options.repeats; i++) {
      start = performance.now();
      image = await engine.capture(pathTrace);
      captureMs.push(performance.now() - start);
    }
    const reference = options.referenceSamples
      ? encode(await engine.capture({ backend: 'pathtracing', samples: options.referenceSamples })) : undefined;
    // Reload in the same engine (same GPU device), as the viewer does when the scene changes.
    performance.clearMeasures();
    const timeline = (globalThis as { __benchTimeline?: string[] }).__benchTimeline;
    timeline?.push(`${performance.now().toFixed(0)} reload start`);
    start = performance.now();
    await engine.loadUsd(new URL(options.scene, document.baseURI));
    const reloadLoadMs = performance.now() - start;
    timeline?.push(`${performance.now().toFixed(0)} reload loaded`);
    let step = performance.now();
    await engine.capture();
    timeline?.push(`${performance.now().toFixed(0)} raster captured`);
    const reloadRasterMs = performance.now() - step;
    step = performance.now();
    await engine.capture(pathTrace);
    const reloadPathTraceMs = performance.now() - step;
    const reloadToPathTraceMs = performance.now() - start;
    const reloadPhases: Record<string, number> = { load: reloadLoadMs, raster: reloadRasterMs, pathTrace: reloadPathTraceMs, rasterAfterFirstPathTrace: rasterAfterPathTraceMs };
    for (const entry of performance.getEntriesByType('measure')) reloadPhases[entry.name] = (reloadPhases[entry.name] ?? 0) + entry.duration;
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return {
      loadMs, firstRasterMs, firstPathTraceMs, captureMs, reloadToPathTraceMs, reloadPhases, objects: engine.objects.length, gpu,
      ...(memory ? { jsHeapBytes: memory.usedJSHeapSize } : {}),
      image: encode(image), ...(reference ? { reference } : {}), diagnostics: [...new Set(diagnostics)].slice(0, 20), phases, shaders,
      ...(options.timeline ? { timeline: (globalThis as { __benchTimeline?: string[] }).__benchTimeline } : {}),
    };
  } finally {
    restore();
    engine.dispose();
  }
}
