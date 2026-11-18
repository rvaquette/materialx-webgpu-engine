import { sceneDeviceDescriptor } from './gpu/device.ts';
import { InteractiveViewer } from './render/viewer.ts';
import type { BackendKind, ViewerStatus } from './render/viewer.ts';
import type { DiagnosticSink } from './core/diagnostics.ts';
import type { ShaderCompilationError } from './gpu/shader-diagnostics.ts';

export type { BackendKind, ViewerStatus as EngineStatus } from './render/viewer.ts';
export type { Diagnostic, DiagnosticSink } from './core/diagnostics.ts';
export type { ShaderCompilationError } from './gpu/shader-diagnostics.ts';

export interface EngineOptions {
  /** An optional borrowed device; the caller retains ownership. */
  device?: GPUDevice;
  orbitControls?: boolean;
  onStatus?: (status: ViewerStatus) => void;
  onDiagnostic?: DiagnosticSink;
  onShaderErrors?: (errors: readonly ShaderCompilationError[]) => void;
}

export type EngineRenderOptions =
  | { backend?: 'raster' | 'disney'; targetNoise?: never }
  | { backend: 'pathtracing'; targetNoise?: number };

/** Canvas-based rendering without the ImGui application. */
export class MaterialXEngine {
  #disposed = false;
  #busy = false;
  #loaded = false;

  private constructor(
    private readonly viewer: InteractiveViewer,
    private readonly context: GPUCanvasContext,
    private readonly ownedDevice: GPUDevice | undefined,
  ) {}

  static async create(canvas: HTMLCanvasElement, options: EngineOptions = {}): Promise<MaterialXEngine> {
    const gpu = globalThis.navigator?.gpu;
    if (!gpu) throw new Error('WebGPU is not available in this browser.');
    if (!(canvas.width > 0 && canvas.height > 0)) throw new RangeError('The canvas must have a positive width and height.');
    const context = canvas.getContext('webgpu');
    if (!context) throw new Error('No WebGPU canvas context.');
    let device = options.device;
    if (!device) {
      const adapter = await gpu.requestAdapter();
      if (!adapter) throw new Error('No WebGPU adapter found.');
      device = await adapter.requestDevice(sceneDeviceDescriptor(adapter));
    }
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
      return new MaterialXEngine(viewer, context, ownedDevice);
    } catch (error) {
      try {
        if (configured) context.unconfigure();
      } finally {
        ownedDevice?.destroy();
      }
      throw error;
    }
  }

  async loadUsd(entry: string | URL): Promise<void> {
    this.#assertAvailable();
    this.#busy = true;
    this.#loaded = false;
    try {
      await this.viewer.load(String(entry));
      if (this.#disposed) throw new Error('MaterialXEngine was disposed during scene loading.');
      this.#loaded = true;
    } finally {
      this.#busy = false;
    }
  }

  /** Applies a rendering configuration; it does not wait for a frame or convergence. */
  async render(options: EngineRenderOptions = {}): Promise<void> {
    this.#assertAvailable();
    if (!this.#loaded) throw new Error('Load a USD scene before rendering.');
    const backend: BackendKind = options.backend ?? 'raster';
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

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    try {
      this.viewer.dispose();
    } finally {
      try {
        this.context.unconfigure();
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
