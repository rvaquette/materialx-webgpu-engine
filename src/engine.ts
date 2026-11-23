import { sceneDeviceDescriptor } from './gpu/device.ts';
import { captureRgba, rgbaCaptureStride } from './gpu/capture.ts';
import { InteractiveViewer } from './render/viewer.ts';
import type { BackendKind, ViewerStatus } from './render/viewer.ts';
import type { Diagnostic, DiagnosticSink } from './core/diagnostics.ts';
import type { ShaderCompilationError } from './gpu/shader-diagnostics.ts';
import { resolveRuntimeAssets, type EngineRuntimeAssets, type RuntimeAssetUrls } from './assets/runtime.ts';
import { describeGpuCapabilities, type GpuCapabilities } from './gpu/capabilities.ts';
import { TelemetryRecorder, type TelemetrySnapshot } from './diagnostics/telemetry.ts';
import { GpuTimingRecorder } from './gpu/timing.ts';
import { DiagnosticJournal, type DiagnosticRecord } from './diagnostics/journal.ts';

export type { EngineRuntimeAssets } from './assets/runtime.ts';
export type { BackendKind, BackendFallback, SceneLoadingProgress, ViewerStatus as EngineStatus } from './render/viewer.ts';
export type { Diagnostic, DiagnosticLevel, DiagnosticSink } from './core/diagnostics.ts';
export type { ShaderCompilationError } from './gpu/shader-diagnostics.ts';
export type { GpuCapabilities as EngineCapabilities, BackendSupport as EngineBackendSupport } from './gpu/capabilities.ts';
export type { DiagnosticRecord as EngineDiagnosticRecord } from './diagnostics/journal.ts';
export type { TelemetrySnapshot as EngineTelemetry, TelemetryStat as EngineTelemetryStat } from './diagnostics/telemetry.ts';

export interface EngineOptions {
  /** An optional borrowed device; the caller retains ownership. */
  device?: GPUDevice;
  runtimeAssets?: EngineRuntimeAssets;
  orbitControls?: boolean;
  onStatus?: (status: ViewerStatus) => void;
  onDiagnostic?: DiagnosticSink;
  onShaderErrors?: (errors: readonly ShaderCompilationError[]) => void;
  /** GPU memory budget in bytes; see the reduction policy in docs/INTEGRATION.md. */
  memoryBudget?: number;
  /** Canvas engines: show partial scenes while loading (loadUsd still resolves on the complete scene). */
  streaming?: boolean;
  /** Record local telemetry, read with telemetry(); nothing leaves the page. */
  telemetry?: boolean;
  /** Called when the GPU device is lost; an engine-owned device is recreated and the scene restored. */
  onDeviceLost?: (event: EngineDeviceLoss) => void;
}

export interface EngineDeviceLoss {
  readonly reason: string;
  readonly message: string;
  /** Resolves to true once the scene renders again on a new device, false if it could not be restored. */
  readonly recovery: Promise<boolean>;
}


export interface EngineGpuMemory {
  readonly buffers: number;
  readonly textures: number;
  readonly total: number;
  readonly peak: number;
  readonly budget?: number;
  /** Largest material texture side after GPU limits and the memory budget. */
  readonly textureLimit: number;
}

export interface HeadlessEngineOptions extends Omit<EngineOptions, 'orbitControls'> {
  width: number;
  height: number;
}

export interface EngineCapture {
  readonly width: number;
  readonly height: number;
  /** Tightly packed, top-down RGBA8 after the display transform. */
  readonly rgba: Uint8Array;
}

/** Shutter interval in time codes; samples are spread over `steps` jittered sub-frames (default 16). */
export interface EngineShutter {
  open: number;
  close: number;
  steps?: number;
}

export type EngineCaptureOptions =
  | { backend?: 'raster'; samples?: never; shutter?: never }
  | { backend: 'pathtracing'; samples: number; shutter?: EngineShutter };

export type EngineRenderOptions =
  | { backend?: 'raster' | 'disney'; targetNoise?: never; temporalHistory?: never }
  | {
    backend: 'pathtracing'; targetNoise?: number;
    /** After a scene change, keep up to this many samples per pixel instead of restarting (0 restarts). */
    temporalHistory?: number;
  };

/** Time range of an animated stage, in USD time codes. */
export interface EngineTimeline {
  readonly start: number;
  readonly end: number;
  readonly timeCodesPerSecond: number;
}

export interface EngineLight {
  readonly path: string;
  readonly type: string;
}

/** Light values that can change without reloading. */
export interface EngineLightChanges {
  intensity?: number;
  exposure?: number;
  color?: readonly [number, number, number];
  /** Column-major 4x4 world transform. */
  transform?: readonly number[];
}

export interface EngineCamera {
  eye: readonly [number, number, number];
  target: readonly [number, number, number];
  /** Vertical field of view in radians. */
  fovY?: number;
}

export interface EngineVariantSet {
  readonly path: string;
  readonly set: string;
  readonly variants: readonly string[];
  readonly selection?: string;
}

export interface EngineMaterialParameter {
  readonly id: string;
  readonly label: string;
  readonly type: 'float' | 'integer' | 'boolean' | 'color3' | 'vector2' | 'vector3' | 'vector4';
  readonly value: readonly number[];
  readonly min?: readonly number[];
  readonly max?: readonly number[];
}

export interface EngineObject {
  readonly path: string;
  readonly material: string;
  readonly assetPath?: string;
}

export interface EngineMaterial {
  url: string | URL;
  /** Required when replacing a material on a precompiled scene. */
  compiledUrl?: string | URL;
}

async function requestSceneDevice(): Promise<{ device: GPUDevice; info?: GPUAdapterInfo }> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) throw new Error('WebGPU is not available in this browser.');
  // Like the viewer, prefer the discrete GPU: path tracing is compute- and compile-bound.
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) throw new Error('No WebGPU adapter found.');
  const device = await adapter.requestDevice(sceneDeviceDescriptor(adapter));
  return { device, ...(adapter.info ? { info: adapter.info } : {}) };
}

type ViewerConfig =
  | { kind: 'canvas'; canvas: HTMLCanvasElement; context: GPUCanvasContext; outputFormat: GPUTextureFormat }
  | { kind: 'headless'; width: number; height: number };

/** Canvas-based or offscreen rendering without the ImGui application. */
export class MaterialXEngine {
  #disposed = false;
  #busy = false;
  #loaded = false;
  #recovering = false;
  /** GPU timing category of the running operation (frames use the backend). */
  #activity: string | undefined;
  #lost = false;
  #entry: string | undefined;
  #viewer!: InteractiveViewer;
  #device: GPUDevice;
  #ownedDevice: GPUDevice | undefined;
  #capabilities: GpuCapabilities;
  readonly #config: ViewerConfig;
  readonly #options: EngineOptions;
  readonly #runtimeAssets: RuntimeAssetUrls | undefined;
  readonly #journal = new DiagnosticJournal();
  #shaderErrors: readonly ShaderCompilationError[] = [];
  readonly #telemetry: TelemetryRecorder | undefined;
  #timing: GpuTimingRecorder | undefined;

  private constructor(
    config: ViewerConfig, device: GPUDevice, owned: boolean, options: EngineOptions, info: GPUAdapterInfo | undefined,
  ) {
    this.#config = config;
    this.#device = device;
    this.#ownedDevice = owned ? device : undefined;
    this.#options = options;
    this.#runtimeAssets = options.runtimeAssets && resolveRuntimeAssets(options.runtimeAssets);
    this.#capabilities = describeGpuCapabilities(device, info ?? (device as { adapterInfo?: GPUAdapterInfo }).adapterInfo);
    this.#telemetry = options.telemetry ? new TelemetryRecorder() : undefined;
    this.#attach(device);
  }

  static async create(canvas: HTMLCanvasElement, options: EngineOptions = {}): Promise<MaterialXEngine> {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) throw new Error('WebGPU is not available in this browser.');
    if (!(canvas.width > 0 && canvas.height > 0)) throw new RangeError('The canvas must have a positive width and height.');
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('No WebGPU canvas context.');
    if (options.runtimeAssets) resolveRuntimeAssets(options.runtimeAssets);
    const acquired = options.device ? { device: options.device } : await requestSceneDevice();
    const { device } = acquired;
    const ownedDevice = options.device ? undefined : device;
    let configured = false;
    try {
      const outputFormat = gpu.getPreferredCanvasFormat();
      context.configure({ device, format: outputFormat, alphaMode: 'opaque' });
      configured = true;
      return new MaterialXEngine({ kind: 'canvas', canvas, context, outputFormat }, device, !options.device, options, acquired.info);
    } catch (error) {
      try {
        if (configured) context.unconfigure();
      } finally {
        ownedDevice?.destroy();
      }
      throw error;
    }
  }

  static async createHeadless(options: HeadlessEngineOptions): Promise<MaterialXEngine> {
    const { width, height } = options;
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new RangeError('Headless dimensions must be positive integers.');
    }
    if (options.runtimeAssets) resolveRuntimeAssets(options.runtimeAssets);
    const acquired = options.device ? { device: options.device } : await requestSceneDevice();
    const { device } = acquired;
    const ownedDevice = options.device ? undefined : device;
    try {
      const bytesPerRow = rgbaCaptureStride(width);
      if (Math.max(width, height) > device.limits.maxTextureDimension2D ||
          bytesPerRow * height > device.limits.maxBufferSize) {
        throw new RangeError('Headless dimensions exceed GPU texture or readback limits.');
      }
      return new MaterialXEngine({ kind: 'headless', width, height }, device, !options.device, options, acquired.info);
    } catch (error) {
      ownedDevice?.destroy();
      throw error;
    }
  }

  /** What this device can run, and why a backend is unavailable. */
  get capabilities(): GpuCapabilities {
    return this.#capabilities;
  }

  /** Diagnostics recorded since creation (the most recent 1000), oldest first. */
  get diagnostics(): readonly DiagnosticRecord[] {
    return this.#journal.records;
  }

  /** Live GPU buffer and texture bytes allocated by the engine. */
  get gpuMemory(): EngineGpuMemory {
    return this.#viewer.gpuMemory;
  }

  /** The diagnostics journal, capabilities and current state as a JSON document. */
  exportDiagnostics(): string {
    return this.#journal.export({
      scene: this.#entry ?? null, backend: this.#viewer.backend, deviceLost: this.#lost,
      capabilities: this.#capabilities, gpuMemory: this.gpuMemory,
    });
  }

  /** Local telemetry snapshot; undefined unless the engine was created with `telemetry: true`. */
  telemetry(): TelemetrySnapshot | undefined {
    if (!this.#telemetry) return undefined;
    const memory = this.#viewer.gpuMemory;
    this.#telemetry.recordMemory(memory.total, memory.peak, memory.budget);
    return this.#telemetry.snapshot();
  }

  async loadUsd(entry: string | URL): Promise<void> {
    this.#assertAvailable();
    this.#busy = true;
    this.#loaded = false;
    const started = performance.now();
    this.#activity = 'load';
    try {
      this.#entry = String(entry);
      if (this.#runtimeAssets) {
        await this.#viewer.load(String(entry), undefined, undefined, { runtimeAssets: this.#runtimeAssets });
      } else {
        await this.#viewer.load(String(entry));
      }
      if (this.#disposed) throw new Error('MaterialXEngine was disposed during scene loading.');
      this.#loaded = true;
      performance.measure('engine:load', { start: started, end: performance.now(), detail: { entry: String(entry) } });
    } catch (error) {
      if (!this.#disposed) this.#record({ level: 'error', code: 'scene-load-failed', message: `Scene load failed: ${error instanceof Error ? error.message : String(error)}`, detail: { entry: String(entry) } });
      throw error;
    } finally {
      this.#busy = false;
      this.#activity = undefined;
    }
  }

  get objects(): readonly EngineObject[] {
    return this.#loaded && !this.#disposed ? this.#viewer.objects.map(object => ({ ...object })) : [];
  }

  get isCompiledScene(): boolean {
    return this.#loaded && !this.#disposed && this.#viewer.isCompiledScene;
  }

  /** Present when the stage is animated (time-sampled transforms, visibility, lights, cameras or points). */
  get timeline(): EngineTimeline | undefined {
    const timeline = this.#loaded && !this.#disposed ? this.#viewer.timeline : undefined;
    return timeline?.animated ? { start: timeline.start, end: timeline.end, timeCodesPerSecond: timeline.timeCodesPerSecond } : undefined;
  }

  get time(): number {
    return this.#viewer.time;
  }

  /** Resolves the animated stage at a time code without reloading. */
  async setTime(time: number): Promise<void> {
    this.#assertLoaded();
    await this.#viewer.setTime(time);
  }

  /** Overrides an object's world transform (column-major 4x4); omit it to restore the scene's. */
  setTransform(path: string, matrix?: readonly number[]): void {
    this.#assertLoaded();
    this.#viewer.setObjectTransform(path, matrix);
  }

  /** Shows or hides an object; omit the flag to restore the scene's visibility. */
  setVisibility(path: string, visible?: boolean): void {
    this.#assertLoaded();
    this.#viewer.setObjectVisible(path, visible);
  }

  get lights(): readonly EngineLight[] {
    return this.#loaded && !this.#disposed ? this.#viewer.lights.map(light => ({ ...light })) : [];
  }

  /** Changes a light; omit the changes to restore the scene's values. */
  setLight(path: string, changes?: EngineLightChanges): void {
    this.#assertLoaded();
    this.#viewer.setLight(path, changes && {
      ...(changes.intensity !== undefined ? { intensity: changes.intensity } : {}),
      ...(changes.exposure !== undefined ? { exposure: changes.exposure } : {}),
      ...(changes.color !== undefined ? { color: [...changes.color] as [number, number, number] } : {}),
      ...(changes.transform !== undefined ? { transform: [...changes.transform] } : {}),
    });
  }

  setCamera(camera: EngineCamera): void {
    this.#assertLoaded();
    this.#viewer.setCamera(camera);
  }

  get variantSets(): readonly EngineVariantSet[] {
    return this.#loaded && !this.#disposed ? this.#viewer.variantSets.map(set => ({ ...set, variants: [...set.variants] })) : [];
  }

  /** Selects a variant; the stage is recomposed and reloaded with the same camera, time and overrides. */
  async setVariant(path: string, set: string, variant: string): Promise<void> {
    this.#assertLoaded();
    this.#busy = true;
    try {
      await this.#viewer.setVariant(path, set, variant);
      if (this.#disposed) throw new Error('MaterialXEngine was disposed during variant selection.');
    } finally {
      this.#busy = false;
    }
  }

  materialParameters(path: string): readonly EngineMaterialParameter[] {
    this.#assertLoaded();
    return this.#viewer.objectParameters(path).map(parameter => ({
      id: parameter.id, label: parameter.label, type: parameter.type, value: [...parameter.value],
      ...(parameter.min ? { min: [...parameter.min] } : {}), ...(parameter.max ? { max: [...parameter.max] } : {}),
    }));
  }

  /** Sets material parameter values by id; value-only parameters update without recompiling. */
  async setMaterialParameters(path: string, values: Readonly<Record<string, readonly number[]>>): Promise<void> {
    this.#assertLoaded();
    this.#busy = true;
    try {
      await this.#viewer.setObjectParameters(path, new Map(Object.entries(values)));
      if (this.#disposed) throw new Error('MaterialXEngine was disposed during a material update.');
    } finally {
      this.#busy = false;
    }
  }

  /** Omit the material to restore the object's original USD binding. */
  async setMaterial(path: string, material?: EngineMaterial): Promise<void> {
    this.#assertAvailable();
    if (!this.#loaded) throw new Error('Load a USD scene before changing a material.');
    const base = globalThis.document?.baseURI;
    const url = material === undefined ? undefined : new URL(material.url, base).href;
    const compiledUrl = material?.compiledUrl === undefined ? undefined : new URL(material.compiledUrl, base).href;
    this.#busy = true;
    try {
      await this.#viewer.setObjectMaterial(path, url, compiledUrl);
      if (this.#disposed) throw new Error('MaterialXEngine was disposed during material replacement.');
    } finally {
      this.#busy = false;
    }
  }

  /** Applies a rendering configuration; it does not wait for a frame or convergence. */
  async render(options: EngineRenderOptions = {}): Promise<void> {
    this.#assertAvailable();
    if (!this.#loaded) throw new Error('Load a USD scene before rendering.');
    const backend: BackendKind = options.backend ?? 'raster';
    if (this.#config.kind === 'headless' && backend !== 'raster') {
      throw new Error('Use capture() to run headless path tracing. Headless Disney is not supported.');
    }
    this.#busy = true;
    try {
      if (backend === 'pathtracing') {
        if (options.temporalHistory !== undefined) this.#viewer.setPathTracingTemporalHistory(options.temporalHistory);
        const limits = this.#viewer.pathTracingLimits;
        this.#viewer.setPathTracingLimits({
          ...limits,
          stopOnConvergence: options.targetNoise !== undefined,
          targetRelativeError: options.targetNoise ?? limits.targetRelativeError,
        });
      }
      if (this.#disposed) throw new Error('MaterialXEngine was disposed while configuring rendering.');
      this.#viewer.setBackend(backend);
      if (this.#disposed) throw new Error('MaterialXEngine was disposed while configuring rendering.');
      if (backend !== 'raster') this.#viewer.setPathTracingPaused(false);
    } finally {
      this.#busy = false;
    }
  }

  async capture(options: EngineCaptureOptions = {}): Promise<EngineCapture> {
    this.#assertAvailable();
    const config = this.#config;
    if (config.kind !== 'headless') throw new Error('Capture requires a headless engine.');
    if (!this.#loaded) throw new Error('Load a USD scene before capturing.');
    const backend = options.backend ?? 'raster';
    const samples = options.backend === 'pathtracing' ? options.samples : 0;
    if (backend !== 'raster' && backend !== 'pathtracing') throw new Error('Unsupported headless capture backend.');
    if (backend === 'pathtracing' && (!Number.isInteger(samples) || samples < 1 || samples > 2 ** 24)) {
      throw new RangeError('Path-tracing capture samples must be an integer from 1 to 16777216.');
    }
    const { width, height } = config;
    const device = this.#device;
    this.#busy = true;
    this.#activity = `capture:${backend}`;
    try {
      return await captureRgba(device, width, height, backend === 'pathtracing'
        ? { pathTrace: target => (options.shutter ? this.#viewer.renderPathTraceTo(target, samples, options.shutter) : this.#viewer.renderPathTraceTo(target, samples)) }
        : { raster: target => this.#viewer.renderRasterTo(target) }, () => {
        if (this.#disposed) throw new Error('MaterialXEngine was disposed during capture.');
      });
    } finally {
      this.#busy = false;
      this.#activity = undefined;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.#viewer.dispose();
      this.#timing?.dispose();
      this.#telemetry?.dispose();
    } finally {
      try {
        if (this.#config.kind === 'canvas') this.#config.context.unconfigure();
      } finally {
        this.#ownedDevice?.destroy();
      }
    }
  }

  #createViewer(device: GPUDevice): InteractiveViewer {
    const options = this.#options;
    const callbacks = {
      onStatus: (status: ViewerStatus) => {
        if (this.#telemetry && (status.backend === 'pathtracing' || status.backend === 'disney') && status.samples > 0) {
          this.#telemetry.recordConvergence({
            backend: status.backend, samples: status.samples,
            ...(status.pathTracingMetrics?.relativeNoise !== undefined ? { relativeNoise: status.pathTracingMetrics.relativeNoise } : {}),
            ...(status.pathTracingMetrics?.sweepsPerSecond !== undefined ? { sweepsPerSecond: status.pathTracingMetrics.sweepsPerSecond } : {}),
            ...(status.pathTracingProgress ? { elapsedSeconds: status.pathTracingProgress.elapsedSeconds } : {}),
          });
        }
        options.onStatus?.(status);
      },
      onDiagnostic: (diagnostic: Diagnostic) => this.#record(diagnostic),
      onShaderErrors: (errors: readonly ShaderCompilationError[]) => {
        for (const error of errors) {
          if (this.#shaderErrors.some(known => known.shader === error.shader && known.message === error.message && known.line === error.line)) continue;
          this.#record({ level: 'error', code: error.line > 0 ? 'shader-compilation' : 'backend-preparation', message: `${error.shader}: ${error.message}` }, {
            name: error.shader, line: error.line, column: error.column, source: error.source,
          });
        }
        this.#shaderErrors = errors;
        options.onShaderErrors?.(errors);
      },
      ...(options.memoryBudget !== undefined ? { memoryBudget: options.memoryBudget } : {}),
    };
    const config = this.#config;
    return config.kind === 'canvas'
      ? new InteractiveViewer({
        canvas: config.canvas, context: config.context, device, outputFormat: config.outputFormat,
        orbitControls: options.orbitControls ?? false, streaming: options.streaming ?? false, ...callbacks,
      })
      : new InteractiveViewer({ width: config.width, height: config.height, device, outputFormat: 'rgba8unorm', ...callbacks });
  }

  /** Builds the viewer and instruments a (new) device. */
  #attach(device: GPUDevice): void {
    this.#viewer = this.#createViewer(device);
    if (this.#telemetry) {
      this.#telemetry.watchUploads(device.queue);
      if (device.features?.has('timestamp-query')) {
        this.#timing?.dispose();
        this.#timing = new GpuTimingRecorder(device, () => this.#activity ?? this.#viewer.backend,
          (category, milliseconds) => this.#telemetry?.recordGpu(category, milliseconds));
      }
    }
    device.addEventListener?.('uncapturederror', event => {
      if (device === this.#device) this.#record({ level: 'error', code: 'uncaptured-gpu-error', message: `Uncaptured WebGPU error: ${(event as GPUUncapturedErrorEvent).error.message}` });
    });
    void device.lost?.then(info => {
      if (this.#disposed || info.reason === 'destroyed' || device !== this.#device) return;
      this.#deviceLost(info);
    });
  }

  #record(diagnostic: Diagnostic, shader?: DiagnosticRecord['shader']): void {
    this.#journal.record(diagnostic, shader);
    const sink = this.#options.onDiagnostic;
    if (sink) sink(diagnostic);
    else if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
    else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
  }

  #deviceLost(info: GPUDeviceLostInfo): void {
    this.#record({ level: 'warning', code: 'device-lost', message: `GPU device lost (${info.reason}): ${info.message || 'no message'}`,
      detail: { reason: info.reason, message: info.message } });
    let recovery: Promise<boolean>;
    if (this.#ownedDevice) {
      recovery = this.#recover();
    } else {
      this.#lost = true;
      this.#record({ level: 'error', code: 'device-recovery-failed',
        message: 'The borrowed GPU device was lost; create a new engine with a new device.' });
      recovery = Promise.resolve(false);
    }
    this.#options.onDeviceLost?.({ reason: info.reason, message: info.message, recovery });
  }

  async #recover(): Promise<boolean> {
    this.#recovering = true;
    const snapshot = this.#viewer.snapshotState();
    const wasLoaded = this.#loaded;
    try {
      try { this.#viewer.dispose(); } catch { /* the lost device may reject teardown */ }
      this.#timing?.dispose();
      this.#timing = undefined;
      let acquired: { device: GPUDevice; info?: GPUAdapterInfo } | undefined;
      let failure: unknown;
      for (let attempt = 0; attempt < 3 && !acquired && !this.#disposed; attempt++) {
        if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 500 * attempt));
        try { acquired = await requestSceneDevice(); } catch (error) { failure = error; }
      }
      if (this.#disposed) {
        acquired?.device.destroy();
        return false;
      }
      if (!acquired) throw failure ?? new Error('No WebGPU adapter found.');
      const { device } = acquired;
      this.#device = device;
      this.#ownedDevice = device;
      this.#capabilities = describeGpuCapabilities(device, acquired.info);
      if (this.#config.kind === 'canvas') this.#config.context.configure({ device, format: this.#config.outputFormat, alphaMode: 'opaque' });
      this.#attach(device);
      this.#loaded = false;
      await this.#viewer.restoreState(snapshot);
      if (this.#disposed) return false;
      this.#loaded = wasLoaded;
      this.#record({ level: 'info', code: 'device-restored', message: 'GPU device recreated; scene and settings restored.' });
      return true;
    } catch (error) {
      this.#lost = true;
      this.#record({ level: 'error', code: 'device-recovery-failed',
        message: `GPU device recovery failed: ${error instanceof Error ? error.message : String(error)}` });
      return false;
    } finally {
      this.#recovering = false;
    }
  }

  #assertLoaded(): void {
    this.#assertAvailable();
    if (!this.#loaded) throw new Error('Load a USD scene first.');
  }

  #assertAvailable(): void {
    if (this.#disposed) throw new Error('MaterialXEngine is disposed.');
    if (this.#recovering) throw new Error('The GPU device was lost; the engine is restoring the scene on a new device.');
    if (this.#lost) throw new Error('The GPU device was lost and the engine could not recover; create a new engine.');
    if (this.#busy) throw new Error('A MaterialXEngine operation is already in progress.');
  }
}
