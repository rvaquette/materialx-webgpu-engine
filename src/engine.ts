import { sceneDeviceDescriptor } from './gpu/device.ts';
import { captureRgba, rgbaCaptureStride } from './gpu/capture.ts';
import { InteractiveViewer } from './render/viewer.ts';
import type { BackendKind, ViewerStatus } from './render/viewer.ts';
import type { DiagnosticSink } from './core/diagnostics.ts';
import type { ShaderCompilationError } from './gpu/shader-diagnostics.ts';
import { resolveRuntimeAssets, type EngineRuntimeAssets, type RuntimeAssetUrls } from './assets/runtime.ts';

export type { EngineRuntimeAssets } from './assets/runtime.ts';
export type { BackendKind, ViewerStatus as EngineStatus } from './render/viewer.ts';
export type { Diagnostic, DiagnosticSink } from './core/diagnostics.ts';
export type { ShaderCompilationError } from './gpu/shader-diagnostics.ts';

export interface EngineOptions {
  /** An optional borrowed device; the caller retains ownership. */
  device?: GPUDevice;
  runtimeAssets?: EngineRuntimeAssets;
  orbitControls?: boolean;
  onStatus?: (status: ViewerStatus) => void;
  onDiagnostic?: DiagnosticSink;
  onShaderErrors?: (errors: readonly ShaderCompilationError[]) => void;
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

export type EngineCaptureOptions =
  | { backend?: 'raster'; samples?: never }
  | { backend: 'pathtracing'; samples: number };

export type EngineRenderOptions =
  | { backend?: 'raster' | 'disney'; targetNoise?: never }
  | { backend: 'pathtracing'; targetNoise?: number };

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

async function requestSceneDevice(): Promise<GPUDevice> {
  const gpu = globalThis.navigator?.gpu;
  if (!gpu) throw new Error('WebGPU is not available in this browser.');
  const adapter = await gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter found.');
  return adapter.requestDevice(sceneDeviceDescriptor(adapter));
}

/** Canvas-based or offscreen rendering without the ImGui application. */
export class MaterialXEngine {
  #disposed = false;
  #busy = false;
  #loaded = false;

  private constructor(
    private readonly viewer: InteractiveViewer,
    private readonly context: GPUCanvasContext | undefined,
    private readonly ownedDevice: GPUDevice | undefined,
    private readonly headless?: { device: GPUDevice; width: number; height: number },
    private readonly runtimeAssets?: RuntimeAssetUrls,
  ) {}

  static async create(canvas: HTMLCanvasElement, options: EngineOptions = {}): Promise<MaterialXEngine> {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) throw new Error('WebGPU is not available in this browser.');
    if (!(canvas.width > 0 && canvas.height > 0)) throw new RangeError('The canvas must have a positive width and height.');
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('No WebGPU canvas context.');
    const runtimeAssets = options.runtimeAssets && resolveRuntimeAssets(options.runtimeAssets);
    const device = options.device ?? await requestSceneDevice();
    const ownedDevice = options.device ? undefined : device;
    let configured = false;
    try {
      const outputFormat = gpu.getPreferredCanvasFormat();
      context.configure({ device, format: outputFormat, alphaMode: 'opaque' });
      configured = true;
      const viewer = new InteractiveViewer({
        canvas, context, device, outputFormat, orbitControls: options.orbitControls ?? false,
        ...(options.onStatus ? { onStatus: options.onStatus } : {}),
        ...(options.onDiagnostic ? { onDiagnostic: options.onDiagnostic } : {}),
        ...(options.onShaderErrors ? { onShaderErrors: options.onShaderErrors } : {}),
      });
      return new MaterialXEngine(viewer, context, ownedDevice, undefined, runtimeAssets);
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
    const { width, height, onStatus, onDiagnostic, onShaderErrors } = options;
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) {
      throw new RangeError('Headless dimensions must be positive integers.');
    }
    const runtimeAssets = options.runtimeAssets && resolveRuntimeAssets(options.runtimeAssets);
    const device = options.device ?? await requestSceneDevice();
    const ownedDevice = options.device ? undefined : device;
    try {
      const bytesPerRow = rgbaCaptureStride(width);
      if (Math.max(width, height) > device.limits.maxTextureDimension2D ||
          bytesPerRow * height > device.limits.maxBufferSize) {
        throw new RangeError('Headless dimensions exceed GPU texture or readback limits.');
      }
      const viewer = new InteractiveViewer({
        width, height, device, outputFormat: 'rgba8unorm',
        ...(onStatus ? { onStatus } : {}),
        ...(onDiagnostic ? { onDiagnostic } : {}),
        ...(onShaderErrors ? { onShaderErrors } : {}),
      });
      return new MaterialXEngine(viewer, undefined, ownedDevice, { device, width, height }, runtimeAssets);
    } catch (error) {
      ownedDevice?.destroy();
      throw error;
    }
  }

  async loadUsd(entry: string | URL): Promise<void> {
    this.#assertAvailable();
    this.#busy = true;
    this.#loaded = false;
    try {
      if (this.runtimeAssets) {
        await this.viewer.load(String(entry), undefined, undefined, { runtimeAssets: this.runtimeAssets });
      } else {
        await this.viewer.load(String(entry));
      }
      if (this.#disposed) throw new Error('MaterialXEngine was disposed during scene loading.');
      this.#loaded = true;
    } finally {
      this.#busy = false;
    }
  }

  get objects(): readonly EngineObject[] {
    return this.#loaded && !this.#disposed ? this.viewer.objects.map(object => ({ ...object })) : [];
  }

  get isCompiledScene(): boolean {
    return this.#loaded && !this.#disposed && this.viewer.isCompiledScene;
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
      await this.viewer.setObjectMaterial(path, url, compiledUrl);
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
    if (this.headless && backend !== 'raster') {
      throw new Error('Use capture() to run headless path tracing. Headless Disney is not supported.');
    }
    this.#busy = true;
    try {
      if (backend === 'pathtracing') {
        const limits = this.viewer.pathTracingLimits;
        this.viewer.setPathTracingLimits({
          ...limits,
          stopOnConvergence: options.targetNoise !== undefined,
          targetRelativeError: options.targetNoise ?? limits.targetRelativeError,
        });
      }
      if (this.#disposed) throw new Error('MaterialXEngine was disposed while configuring rendering.');
      this.viewer.setBackend(backend);
      if (this.#disposed) throw new Error('MaterialXEngine was disposed while configuring rendering.');
      if (backend !== 'raster') this.viewer.setPathTracingPaused(false);
    } finally {
      this.#busy = false;
    }
  }

  async capture(options: EngineCaptureOptions = {}): Promise<EngineCapture> {
    this.#assertAvailable();
    if (!this.headless) throw new Error('Capture requires a headless engine.');
    if (!this.#loaded) throw new Error('Load a USD scene before capturing.');
    const backend = options.backend ?? 'raster';
    const samples = options.backend === 'pathtracing' ? options.samples : 0;
    if (backend !== 'raster' && backend !== 'pathtracing') throw new Error('Unsupported headless capture backend.');
    if (backend === 'pathtracing' && (!Number.isInteger(samples) || samples < 1 || samples > 2 ** 24)) {
      throw new RangeError('Path-tracing capture samples must be an integer from 1 to 16777216.');
    }
    const { device, width, height } = this.headless;
    this.#busy = true;
    try {
      return await captureRgba(device, width, height, backend === 'pathtracing'
        ? { pathTrace: target => this.viewer.renderPathTraceTo(target, samples) }
        : { raster: target => this.viewer.renderRasterTo(target) }, () => {
        if (this.#disposed) throw new Error('MaterialXEngine was disposed during capture.');
      });
    } finally {
      this.#busy = false;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.viewer.dispose();
    } finally {
      try {
        this.context?.unconfigure();
      } finally {
        this.ownedDevice?.destroy();
      }
    }
  }

  #assertAvailable(): void {
    if (this.#disposed) throw new Error('MaterialXEngine is disposed.');
    if (this.#busy) throw new Error('A MaterialXEngine operation is already in progress.');
  }
}
