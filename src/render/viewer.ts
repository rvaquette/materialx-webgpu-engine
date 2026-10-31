// Interactive on-canvas viewer (T051/T052 live counterpart of the offscreen USD
// capture harness). Loads a USD scene through the shared asset loader (usd-scene-
// assets.ts). Raster resources are built on load, path-tracing CPU/GPU resources
// on first use. Resolution changes replace targets, not scene data or pipelines.

import {
  buildSceneFrame,
  buildSceneFrameUniform,
  buildSceneMaterialUniform,
  type FrameCamera,
  type SceneFramePlan,
} from './raster/scene-frame.ts';
import {
  RasterBackend,
  RESOLVE_UNIFORM_SIZE,
  SCENE_FRAME_UNIFORM_SIZE,
  SCENE_MATERIAL_UNIFORM_SIZE,
  type ScenePassKind,
  type SceneDrawCall,
} from './raster/backend.ts';
import { createSceneBindGroups, uploadGeometry, type SceneDrawBuffers } from './scene-resources.ts';
import { buildEnvCdf } from '../assets/environment-cdf.ts';
import { buildCachedPathTraceScene, type PathTraceScene } from './pathtracing/scene-buffers.ts';
import { buildPathTraceUniform, pathTraceComputeWgsl, pathTraceClosureDispatch, pathTraceOpaqueScene, PathTraceBackend, PT_UNIFORM_SIZE } from './pathtracing/compute.ts';
import { pathTraceSettings } from './pathtracing/scene-settings.ts';
import { cameraFovY } from '../usd/cameras.ts';
import { buildMaterialDispatch } from './pathtracing/material-variant.ts';
import { buildPtDeviceBindings } from './pathtracing/device-bindings.ts';
import { maxRecordLobes } from './pathtracing/material-record.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
import { loadUsdScene, uploadMaterialTextures, type ObjectMaterialOverride, type SceneLoadOptions } from './usd-scene-assets.ts';
import { assertSceneStorageSize } from '../gpu/device.ts';
import { OrbitCamera, attachOrbitControls } from '../scene/orbit-camera.ts';
import { inverse4, lookAt4, multiply4, perspective4, type Vec3 } from '../scene/transforms.ts';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import { compileShaderWithDiagnostics, type ShaderCompilationError } from '../gpu/shader-diagnostics.ts';
import { packHdrTexture } from '../assets/hdr-texture.ts';
import { generateEnvironmentMipmaps } from './env/mipmaps.ts';
import { assembleIrForwardShader, type RasterQuality } from './raster/ir-forward.ts';
import { pathTraceDisplayWgsl, previewScale, PT_DISPLAY_INFO_BYTES, PT_DISPLAY_PIXEL_BYTES } from './pathtracing/display.ts';
import { JsDenoiser } from './pathtracing/js-denoiser.ts';
import { changeMaterialParameters, compileEditableMaterial, materialUniformData, packParameterUniforms, visibleMaterialParameters, type MaterialParameter } from './material-parameters.ts';
import { applySceneDisplacement } from './displacement.ts';
import type { MaterialResource } from './scene-resources.ts';

/** Preview fill + framing shared with the capture harness so the live view matches. */
const PREVIEW_ENV: Vec3 = [0.65, 0.68, 0.72];
const RASTER_BAND_PIXELS = 256 * 256;
function previewCamera(aspect: number, exposure: number): FrameCamera {
  const target: Vec3 = [0, 0.3, 0];
  const dir: Vec3 = [0.657, 0.438, 0.613];
  const dist = 7;
  const eye: Vec3 = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
  return { viewProj: multiply4(perspective4(0.62, aspect, 0.001, 10000), lookAt4(eye, target, [0, 1, 0])), eye, exposure };
}

export type BackendKind = 'raster' | 'pathtracing';

export type PathTracerState = 'idle' | 'compiling' | 'ready' | 'error';
export type DenoiserStatus =
  | { state: 'off' | 'waiting' | 'running' | 'ready' }
  | { state: 'error'; error: string };

export interface ViewerStatus {
  backend: BackendKind;
  pathTracingPaused: boolean;
  pathTracer: PathTracerState;
  rasterQuality: RasterQuality;
  pathTracingDenoise: boolean;
  denoiser: DenoiserStatus;
  drawCount: number;
  passes: readonly ScenePassKind[];
  samples: number;
  warnings: number;
}

/** A disposable per-scene GPU render set (raster + lazily built path tracer) for one loaded USD. */
interface SceneRender {
  updateMaterial: (key: string, material: MaterialResource) => void;
  frame: SceneFramePlan;
  resize: (width: number, height: number) => void;
  setRasterQuality: (quality: RasterQuality) => Promise<void>;
  renderRaster: (targetView: GPUTextureView) => void;
  /** Starts the path tracer build on first call; renders nothing until it is ready. */
  renderPathTrace: (targetView: GPUTextureView, tiled: boolean, accumulate: boolean) => void;
  reportFrameTime: (milliseconds: number) => void;
  invalidateDenoise: () => void;
  denoiserStatus: () => DenoiserStatus;
  resetPathTrace: () => void;
  applyCamera: (viewProj: readonly number[], eye: Vec3, backgroundInvViewProj: readonly number[]) => void;
  frameCount: () => number;
  pathTracerState: () => PathTracerState;
  dispose: () => void;
}

export class InteractiveViewer {
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext;
  readonly #outputFormat: GPUTextureFormat;
  readonly #canvas: HTMLCanvasElement;
  #width: number;
  #height: number;
  #backend: BackendKind = 'raster';
  #rasterQuality: RasterQuality = 'interactive';
  #pathTracingPaused = false;
  #pathTracingDenoise = false;
  readonly #jsDenoiser: JsDenoiser;
  #ptDisplayDirty = true;
  #orbit: OrbitCamera;
  #current: SceneRender | null = null;
  #loaded: Awaited<ReturnType<typeof loadUsdScene>> | undefined;
  #loadOptions: SceneLoadOptions = {};
  #firstFrameStart: number | undefined;
  #sceneEntry: string | undefined;
  #materialOverrides = new Map<string, ObjectMaterialOverride>();
  #objects: ReadonlyArray<{ path: string; material: string; assetPath?: string }> = [];
  #warnings = 0;
  #rasterDirty = true;
  #framePending = false;
  #disposed = false;
  #lastCameraChange = -Infinity;
  #detachControls: () => void;
  #onStatus: ((s: ViewerStatus) => void) | undefined;
  #onShaderErrors: ((errors: readonly ShaderCompilationError[]) => void) | undefined;

  constructor(opts: {
    device: GPUDevice;
    context: GPUCanvasContext;
    outputFormat: GPUTextureFormat;
    canvas: HTMLCanvasElement;
    onStatus?: (s: ViewerStatus) => void;
    onShaderErrors?: (errors: readonly ShaderCompilationError[]) => void;
  }) {
    this.#device = opts.device;
    this.#jsDenoiser = new JsDenoiser(opts.device);
    this.#context = opts.context;
    this.#outputFormat = opts.outputFormat;
    this.#canvas = opts.canvas;
    this.#width = opts.canvas.width;
    this.#height = opts.canvas.height;
    this.#onStatus = opts.onStatus;
    this.#onShaderErrors = opts.onShaderErrors;
    this.#orbit = OrbitCamera.fromEyeTarget([0, 0.3 + 0.438 * 7, 0], [0, 0.3, 0], this.#width / this.#height);
    this.#detachControls = attachOrbitControls(this.#canvas, this.#orbit, () => this.#onCameraChanged());
    this.#loop();
  }

  get backend(): BackendKind {
    return this.#backend;
  }

  get rasterQuality(): RasterQuality {
    return this.#rasterQuality;
  }

  async setRasterQuality(quality: RasterQuality): Promise<void> {
    if (quality !== 'interactive' && quality !== 'reference') throw new Error('Unsupported raster quality.');
    if (quality === this.#rasterQuality) return;
    await this.#current?.setRasterQuality(quality);
    this.#rasterQuality = quality;
    this.#onCameraChanged();
    this.#emitStatus();
  }

  get objects(): ReadonlyArray<{ path: string; material: string; assetPath?: string }> {
    return this.#objects;
  }

  objectParameters(path: string): readonly MaterialParameter[] {
    const resources = this.#loaded?.parameterResources;
    const key = resources?.instances.find(instance => instance.primPath === path)?.materialKey;
    const material = key ? resources?.materials.get(key) : undefined;
    return material ? visibleMaterialParameters(material) : [];
  }

  async setObjectParameters(path: string, changes: ReadonlyMap<string, readonly number[]>): Promise<void> {
    const loaded = this.#loaded;
    const source = loaded?.parameterResources;
    const key = source?.instances.find(instance => instance.primPath === path)?.materialKey;
    const material = key ? source?.materials.get(key) : undefined;
    if (!loaded || !source || !key || !material || !this.#current) throw new Error(`Unknown editable object: ${path}`);
    changes = new Map([...changes].filter(([id, value]) => {
      const current = material.parameters?.find(parameter => parameter.id === id);
      return !current || value.length !== current.value.length || value.some((component, i) => component !== current.value[i]);
    }));
    if (changes.size === 0) return;
    let updated = changeMaterialParameters(material, changes);
    const compiled = compileEditableMaterial(updated);
    const before = buildSceneFrame(source, { surfaceFor: loaded.mtlx.surfaceFor }).draws.find(draw => draw.materialKey === key);
    const probeMaterials = new Map(source.materials);
    probeMaterials.set(key, compiled);
    const after = buildSceneFrame({ ...source, materials: probeMaterials }, { surfaceFor: loaded.mtlx.surfaceFor })
      .draws.find(draw => draw.materialKey === key);
    const rebuild = material.parameters?.some(parameter => changes.has(parameter.id) && parameter.update === 'rebuild')
      || compiled.sceneShader?.code !== material.sceneShader?.code || before?.pass !== after?.pass;
    if (rebuild) updated = compiled;
    const materials = new Map(source.materials);
    materials.set(key, updated);
    const parameterResources = { ...source, materials };
    if (!rebuild) {
      // Keep baked geometry metadata; source materials retain displacement for future rebuilds.
      const baked = { ...loaded.resources.materials.get(key)!, parameters: updated.parameters!,
        surfaceGraph: updated.surfaceGraph!, resolvedSurface: updated.resolvedSurface! };
      this.#current.updateMaterial(key, baked);
      const bakedMaterials = new Map(loaded.resources.materials);
      bakedMaterials.set(key, baked);
      loaded.resources = { ...loaded.resources, materials: bakedMaterials };
      loaded.parameterResources = parameterResources;
      this.#rasterDirty = true;
      this.#ptDisplayDirty = true;
      this.#current.resetPathTrace();
      this.#emitStatus();
      return;
    }
    const resources = await applySceneDisplacement(parameterResources, loaded.mtlx.imageProvider);
    const candidate = { ...loaded, resources, parameterResources };
    const exposure = loaded.cameras[0]?.exposure ?? 0;
    const frame = buildSceneFrame(resources, {
      lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor,
      environment: this.#current.frame.environment,
      frameCamera: { viewProj: this.#orbit.viewProj(), eye: this.#orbit.eye, exposure },
    });
    const sink: DiagnosticSink = diagnostic => {
      if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
      else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
    };
    const render = await this.#buildSceneRender(candidate, frame, exposure, sink);
    if (this.#loaded !== loaded || this.#disposed) {
      render.dispose();
      throw new Error('Scene changed during parameter update.');
    }
    this.#current.dispose();
    this.#current = render;
    this.#loaded = candidate;
    this.#onCameraChanged();
    this.#emitStatus();
  }

  async resetObjectParameters(path: string): Promise<void> {
    await this.setObjectParameters(path, new Map(this.objectParameters(path)
      .filter(parameter => parameter.value.some((value, i) => value !== parameter.initial[i]))
      .map(parameter => [parameter.id, parameter.initial])));
  }

  async setObjectMaterial(path: string, assetPath?: string): Promise<void> {
    if (!this.#sceneEntry || !this.#objects.some((object) => object.path === path)) {
      throw new Error(`Unknown object: ${path}`);
    }
    const overrides = new Map(this.#materialOverrides);
    if (assetPath) {
      const response = await fetch(assetPath);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${assetPath}`);
      const document = new DOMParser().parseFromString(await response.text(), 'application/xml');
      if (document.querySelector('parsererror')) throw new Error('Invalid MaterialX XML.');
      const materialName = document.getElementsByTagName('surfacematerial')[0]?.getAttribute('name');
      if (!materialName) throw new Error('No surfacematerial in this MaterialX document.');
      overrides.set(path, { assetPath, materialName });
    } else {
      overrides.delete(path);
    }
    await this.load(this.#sceneEntry, overrides, true, this.#loadOptions);
  }

  get pathTracingPaused(): boolean {
    return this.#pathTracingPaused;
  }

  get pathTracingDenoise(): boolean {
    return this.#pathTracingDenoise;
  }

  setPathTracingDenoise(enabled: boolean): void {
    this.#pathTracingDenoise = enabled;
    this.#current?.invalidateDenoise();
    this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  setPathTracingPaused(paused: boolean): void {
    this.#pathTracingPaused = paused;
    this.#emitStatus();
  }

  setBackend(kind: BackendKind): void {
    if (kind === this.#backend) return;
    this.#backend = kind;
    this.#canvas.style.imageRendering = 'auto';
    this.#ptDisplayDirty = true;
    if (kind === 'pathtracing') this.#current?.resetPathTrace();
    else {
      this.#current?.invalidateDenoise();
      this.#rasterDirty = true;
    }
    this.#emitStatus();
  }

  dispose(): void {
    this.#disposed = true;
    this.#detachControls();
    this.#current?.dispose();
    this.#current = null;
    this.#jsDenoiser.dispose();
    this.#loaded?.mtlx.documents.delete();
    this.#loaded = undefined;
  }

  async resize(size: number): Promise<void> {
    if (![256, 512, 1024].includes(size)) throw new Error('Unsupported render resolution.');
    if (size === this.#width && size === this.#height) return;
    this.#current?.resize(size, size);
    this.#width = size;
    this.#height = size;
    this.#canvas.width = size;
    this.#canvas.height = size;
    this.#canvas.style.width = `${size}px`;
    this.#orbit.aspect = 1;
    const camera = this.#loaded?.cameras[0];
    if (camera?.pathtracerFov !== undefined) this.#orbit.fovY = cameraFovY(camera, 1);
    this.#onCameraChanged();
    this.#emitStatus();
  }

  /** (Re)load a USD scene entry and rebuild both backends on its resources. */
  async load(
    entry: string,
    overrides: ReadonlyMap<string, ObjectMaterialOverride> = new Map(),
    preserveCamera = false,
    options: SceneLoadOptions = {},
  ): Promise<void> {
    const loadStarted = performance.now();
    this.#warnings = 0;
    const sink: DiagnosticSink = (d) => {
      if (d.level === 'warning' || d.level === 'error') this.#warnings++;
      if (d.level === 'error') console.error(d.message, d.detail ?? '');
      else if (d.level === 'warning') console.warn(d.message, d.detail ?? '');
    };
    const loaded = await loadUsdScene(entry, sink, () => { }, overrides, { ...options, editableParameters: true });
    const exposure = loaded.cameras[0]?.exposure ?? 0;
    let frame: SceneFramePlan;
    let render: SceneRender;
    try {
      if (overrides.size > 0 && loaded.resources.pendingMaterials.length > 0) {
        throw new Error('MaterialX compilation failed.');
      }
      const env = loaded.environment;
      const environment = env
        ? { radiance: env.averageRadiance, tint: env.tint, intensity: env.intensity, hasTexture: true, sh: env.sh }
        : { radiance: pathTraceSettings(loaded.scene).converted ? [0, 0, 0] as Vec3 : PREVIEW_ENV };
      frame = buildSceneFrame(loaded.resources, {
        lights: loaded.lights,
        frameCamera: previewCamera(this.#width / this.#height, exposure),
        environment,
        surfaceFor: loaded.mtlx.surfaceFor,
      });
      // Pipelines are only reclaimed by GC: drop the old set before compiling the new one.
      this.#current?.dispose();
      this.#current = null;
      await new Promise((resolve) => setTimeout(resolve, 0));
      const gpuBuildStarted = performance.now();
      render = await this.#buildSceneRender(loaded, frame, exposure, sink);
      performance.measure('viewer:raster-build', { start: gpuBuildStarted, end: performance.now(), detail: { entry } });
    } catch (error) {
      loaded.mtlx.documents.delete();
      throw error;
    }
    if (this.#disposed) {
      render.dispose();
      loaded.mtlx.documents.delete();
      throw new Error('Viewer disposed during load.');
    }
    this.#current = render;
    this.#firstFrameStart = loadStarted;
    this.#loaded?.mtlx.documents.delete();
    this.#loaded = loaded;
    this.#loadOptions = options;
    this.#sceneEntry = entry;
    this.#materialOverrides = new Map(overrides);
    this.#objects = loaded.resources.instances.filter((instance) => instance.hasGeometry).map((instance) => {
      const material = instance.materialKey ? loaded.resources.materials.get(instance.materialKey) : undefined;
      const override = overrides.get(instance.primPath);
      return {
        path: instance.primPath,
        material: material?.materialName ?? 'Default',
        ...(override ? { assetPath: override.assetPath } : {}),
      };
    });

    // Seed the orbit from the scene bounds so the first frame is framed, then push
    // the camera into both backends and restart accumulation.
    const bounds = loaded.resources.tlas.bounds;
    const center: Vec3 = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    if (!preserveCamera) {
      const camera = loaded.cameras[0];
      if (camera) {
        const transform = camera.transform;
        const eye: Vec3 = [transform[12]!, transform[13]!, transform[14]!];
        const distance = Math.hypot(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]);
        const axisLength = Math.hypot(transform[8]!, transform[9]!, transform[10]!) || 1;
        const target: Vec3 = [
          eye[0] - transform[8]! * distance / axisLength,
          eye[1] - transform[9]! * distance / axisLength,
          eye[2] - transform[10]! * distance / axisLength,
        ];
        this.#orbit = OrbitCamera.fromEyeTarget(eye, target, this.#width / this.#height, cameraFovY(camera, this.#width / this.#height) || 0.62);
        if (pathTraceSettings(loaded.scene).converted) this.#orbit.projection = camera.projection;
      } else {
        this.#orbit = OrbitCamera.fromEyeTarget(frame.camera.eye, center, this.#width / this.#height);
      }
    }
    this.#detachControls();
    this.#detachControls = attachOrbitControls(this.#canvas, this.#orbit, () => this.#onCameraChanged());
    this.#onCameraChanged();
    this.#emitStatus();
  }

  #onCameraChanged(): void {
    if (!this.#current) return;
    this.#lastCameraChange = performance.now();
    this.#current.applyCamera(this.#orbit.viewProj(), this.#orbit.eye, inverse4(this.#orbit.backgroundViewProj()));
    this.#rasterDirty = true;
    this.#ptDisplayDirty = true;
    if (this.#backend === 'pathtracing') this.#current.resetPathTrace();
  }

  #emitStatus(): void {
    if (!this.#onStatus || !this.#current) return;
    this.#onStatus({
      backend: this.#backend,
      pathTracingPaused: this.#pathTracingPaused,
      pathTracer: this.#current.pathTracerState(),
      rasterQuality: this.#rasterQuality,
      pathTracingDenoise: this.#pathTracingDenoise,
      denoiser: this.#current.denoiserStatus(),
      drawCount: this.#current.frame.draws.length,
      passes: this.#current.frame.passes,
      samples: this.#current.frameCount(),
      warnings: this.#warnings,
    });
  }

  #loop = (): void => {
    if (this.#disposed) return;
    const current = this.#current;
    if (current && !this.#framePending) {
      let submitted = false;
      const started = performance.now();
      const pathTracingFrame = this.#backend === 'pathtracing';
      const denoising = current.denoiserStatus().state === 'running';
      if (this.#backend === 'pathtracing' && ((!this.#pathTracingPaused && !denoising) || this.#ptDisplayDirty)) {
        const tiled = performance.now() - this.#lastCameraChange >= 200;
        current.renderPathTrace(this.#context.getCurrentTexture().createView(), tiled, !this.#pathTracingPaused && !denoising);
        this.#ptDisplayDirty = false;
        submitted = true;
        this.#emitStatus();
      } else if (this.#backend === 'raster' && this.#rasterDirty) {
        this.#rasterDirty = false;
        current.renderRaster(this.#context.getCurrentTexture().createView());
        submitted = true;
        this.#emitStatus();
      }
      if (submitted) {
        const firstFrameStart = this.#firstFrameStart;
        this.#firstFrameStart = undefined;
        this.#framePending = true;
        void this.#device.queue.onSubmittedWorkDone().then(() => {
          if (firstFrameStart !== undefined) {
            performance.measure('viewer:first-frame', { start: firstFrameStart, end: performance.now(),
              detail: { entry: this.#sceneEntry, backend: pathTracingFrame ? 'pathtracing' : 'raster' } });
          }
          if (pathTracingFrame) current.reportFrameTime(performance.now() - started);
          this.#framePending = false;
        }, (error: unknown) => {
          this.#framePending = false;
          console.error('GPU frame failed:', error);
        });
      }
    }
    requestAnimationFrame(this.#loop);
  };

  /** Build the raster forward + compute path-trace GPU state for one scene. */
  async #buildSceneRender(
    loaded: Awaited<ReturnType<typeof loadUsdScene>>,
    frame: SceneFramePlan,
    exposure: number,
    sink: DiagnosticSink,
  ): Promise<SceneRender> {
    const trash: Array<{ destroy(): void }> = [];
    try {
      return await this.#createSceneRender(loaded, frame, exposure, sink, trash);
    } catch (error) {
      for (const resource of trash) resource.destroy();
      throw error;
    }
  }

  async #createSceneRender(
    loaded: Awaited<ReturnType<typeof loadUsdScene>>,
    frame: SceneFramePlan,
    exposure: number,
    sink: DiagnosticSink,
    trash: Array<{ destroy(): void }>,
  ): Promise<SceneRender> {
    const device = this.#device;
    let width = this.#width;
    let height = this.#height;
    let rasterQuality = this.#rasterQuality;
    let disposed = false;
    let pathTraceScene: PathTraceScene | undefined;
    let cameraViewProj = frame.camera.viewProj;
    let cameraEye = frame.camera.eye;
    let backgroundInvViewProj = inverse4(frame.camera.viewProj);
    const outputFormat = this.#outputFormat;
    const resources = { ...loaded.resources, materials: new Map(loaded.resources.materials) };
    const parameterBuffers = new Map<string, GPUBuffer[]>();
    let uploadPtParameters: (() => void) | undefined;
    this.#onShaderErrors?.([]);
    let rasterErrors: ShaderCompilationError[] = [];
    const track = <T extends { destroy(): void }>(o: T): T => {
      trash.push(o);
      return o;
    };

    // Shared equirect environment texture (dome envmap), uploaded once as a
    // filterable rgba16float and consumed by both the raster background pass and
    // the path tracer's group 3. env.w in the PT uniform carries the intensity.
    const envAsset = loaded.environment;
    let envTextureView: GPUTextureView | undefined;
    let envSampler: GPUSampler | undefined;
    let envRadianceScale = 1;
    let envCdfBuffer: GPUBuffer | undefined;
    if (envAsset) {
      const { width: ew, height: eh } = envAsset.image;
      const packed = packHdrTexture(envAsset.image);
      envRadianceScale = packed.radianceScale;
      frame.environment.textureRadianceScale = envRadianceScale;
      const cdf = buildEnvCdf(envAsset.image);
      frame.environment.envResX = cdf.width;
      frame.environment.envResY = cdf.height;
      frame.environment.envTotalSum = cdf.totalSum;
      envCdfBuffer = track(device.createBuffer({ size: Math.max(16, cdf.cdf.byteLength), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
      device.queue.writeBuffer(envCdfBuffer, 0, cdf.cdf);
      const envTexture = track(device.createTexture({
        size: [ew, eh],
        mipLevelCount: Math.floor(Math.log2(Math.max(ew, eh))) + 1,
        format: 'rgba16float',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
      }));
      device.queue.writeTexture(
        { texture: envTexture },
        packed.data,
        { bytesPerRow: ew * 8, rowsPerImage: eh },
        [ew, eh, 1],
      );
      generateEnvironmentMipmaps(device, envTexture);
      envTextureView = envTexture.createView();
      envSampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'clamp-to-edge',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
      });
    }

    // --- raster ---------------------------------------------------------------
    let backend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
    const resolveBackend = backend;
    const resolvePipeline = resolveBackend.createResolvePipeline();

    const imageCache = new Map<string, DecodedPixelImage | undefined>();
    const materialTextures = new Map<string, { textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler> }>();
    for (const [key, material] of resources.materials) {
      if (material.surfaceModule && material.surfaceModule.textures.length > 0) {
        const uploadedTextures = await uploadMaterialTextures(device, material, loaded.mtlx.imageProvider, imageCache);
        uploadedTextures.textures.forEach(track);
        materialTextures.set(key, uploadedTextures);
      }
    }

    const materialDisplacement = new Map<string, NonNullable<SceneDrawBuffers['displacement']>>();
    for (const [key, material] of resources.materials) {
      const group = material.sceneShader?.displacementGroup;
      if (group === undefined || !material.displacement) continue;
      const file = material.displacement.file;
      if (!imageCache.has(file)) imageCache.set(file, await loaded.mtlx.imageProvider.decode(file));
      const image = imageCache.get(file);
      if (!image || image.componentType !== 'uint8' || image.channels !== 4) {
        throw new Error(`Invalid displacement map: ${file}`);
      }
      const texture = track(device.createTexture({
        size: [image.width, image.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      }));
      device.queue.writeTexture(
        { texture }, image.data,
        { bytesPerRow: image.width * 4, rowsPerImage: image.height },
        [image.width, image.height, 1],
      );
      const params = track(device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      device.queue.writeBuffer(params, 0, new Float32Array([material.displacement.scale, 0.5, 0, 0]));
      materialDisplacement.set(key, {
        group,
        params,
        textureView: texture.createView(),
        sampler: device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' }),
      });
    }

    const uploaded = new Map<string, ReturnType<typeof uploadGeometry>>();
    for (const [id, geometry] of resources.geometries) {
      const buffers = uploadGeometry(device, geometry, id);
      track(buffers.indexBuffer);
      for (const vb of buffers.vertexBuffers.values()) track(vb);
      uploaded.set(id, buffers);
    }

    let drawsByPass = new Map<ScenePassKind, SceneDrawCall[]>();
    const zeroTexcoords = new Map<string, GPUBuffer>();
    const zeroTangents = new Map<string, GPUBuffer>();
    const frameUniforms: GPUBuffer[] = [];
    const rasterSets = new Map<RasterQuality, { backend: RasterBackend; draws: Map<ScenePassKind, SceneDrawCall[]> }>();
    const buildRasterQuality = async (quality: RasterQuality): Promise<void> => {
      const cached = rasterSets.get(quality);
      if (cached) {
        backend = cached.backend;
        drawsByPass = cached.draws;
        return;
      }
      const nextBackend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
      const shaders = new Map<string, ReturnType<typeof assembleIrForwardShader>>();
      for (const draw of frame.draws) {
        const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
        if (!material?.surfaceModule || shaders.has(material.variant.pipelineKey)) continue;
        const shader = assembleIrForwardShader(material.surfaceModule, {
          displacement: material.displacement !== undefined, rasterQuality: quality,
        });
        const compiled = await compileShaderWithDiagnostics(device, shader.code, `Raster ${quality}: ${material.materialName}`);
        if (disposed) throw new Error('Viewer disposed during raster compilation.');
        rasterErrors = compiled.errors;
        this.#onShaderErrors?.(rasterErrors);
        if (rasterErrors.length > 0) throw new Error(`WGSL: ${rasterErrors.length} erreur(s) de compilation.`);
        shaders.set(material.variant.pipelineKey, shader);
        nextBackend.createSceneVariantPipeline(draw.pass, material.variant.pipelineKey, shader.code, compiled.module);
      }
      const nextDraws = new Map<ScenePassKind, SceneDrawCall[]>();
      for (const draw of frame.draws) {
        const buffers = uploaded.get(draw.prototypeId);
        const geometry = resources.geometries.get(draw.prototypeId);
        const position = buffers?.vertexBuffers.get('position');
        const normal = buffers?.vertexBuffers.get('normal');
        if (!buffers || !geometry || !position || !normal) continue;
        const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
        if (!material?.sceneShader) continue;
        const shader = shaders.get(material.variant.pipelineKey);
        if (!shader) throw new Error(`Missing raster shader: ${material.materialName}`);
        const pipeline = nextBackend.sceneVariantPipeline(draw.pass, material.variant.pipelineKey)
          ?? nextBackend.createSceneVariantPipeline(draw.pass, material.variant.pipelineKey, shader.code);
        if (!pipeline) continue;
        let texcoord = buffers.vertexBuffers.get('uv');
        if (!texcoord) {
          texcoord = zeroTexcoords.get(draw.prototypeId);
          if (!texcoord) {
            texcoord = track(device.createBuffer({ size: geometry.vertexCount * 8, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }));
            device.queue.writeBuffer(texcoord, 0, new Float32Array(geometry.vertexCount * 2));
            zeroTexcoords.set(draw.prototypeId, texcoord);
          }
        }
        const frameUniform = track(device.createBuffer({ size: SCENE_FRAME_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        let tangent = buffers.vertexBuffers.get('tangent') ?? zeroTangents.get(draw.prototypeId);
        if (!tangent) {
          tangent = track(device.createBuffer({ size: geometry.vertexCount * 16, usage: GPUBufferUsage.VERTEX }));
          zeroTangents.set(draw.prototypeId, tangent);
        }
        device.queue.writeBuffer(frameUniform, 0, buildSceneFrameUniform(frame, draw));
        frameUniforms.push(frameUniform);
        const materialData = material.parameters ? materialUniformData(material) : buildSceneMaterialUniform(draw);
        const materialUniform = track(device.createBuffer({ size: Math.max(SCENE_MATERIAL_UNIFORM_SIZE, materialData.byteLength), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
        device.queue.writeBuffer(materialUniform, 0, materialData);
        if (draw.materialKey && material.parameters) {
          const buffers = parameterBuffers.get(draw.materialKey) ?? [];
          buffers.push(materialUniform);
          parameterBuffers.set(draw.materialKey, buffers);
        }
        const textures = draw.materialKey ? materialTextures.get(draw.materialKey) : undefined;
        const displacement = draw.materialKey ? materialDisplacement.get(draw.materialKey) : undefined;
        const bindGroups = createSceneBindGroups(
          device,
          { ...material, sceneShader: shader },
          {
            frame: frameUniform,
            material: materialUniform,
            ...(textures ? { textureViews: textures.textureViews, samplers: textures.samplers } : {}),
            ...(displacement ? { displacement } : {}),
            ...(envTextureView && envSampler && envCdfBuffer ? { environment: { textureView: envTextureView, sampler: envSampler, cdf: envCdfBuffer } } : {}),
          },
          (group) => pipeline.getBindGroupLayout(group),
        );
        const textureBindGroups = new Map<number, GPUBindGroup>();
        for (const [group, bindGroup] of bindGroups.byGroup) {
          if (bindGroup !== bindGroups.materialBindGroup && bindGroup !== bindGroups.frameBindGroup) {
            textureBindGroups.set(group, bindGroup);
          }
        }
        const list = nextDraws.get(draw.pass) ?? [];
        list.push({
          materialBindGroup: bindGroups.materialBindGroup,
          frameBindGroup: bindGroups.frameBindGroup,
          positionBuffer: position,
          normalBuffer: normal,
          texcoordBuffer: texcoord,
          tangentBuffer: tangent,
          indexBuffer: buffers.indexBuffer,
          indexCount: buffers.indexCount,
          pipelineKey: material.variant.pipelineKey,
          ...(textureBindGroups.size > 0 ? { textureBindGroups } : {}),
        });
        nextDraws.set(draw.pass, list);
      }
      rasterSets.set(quality, { backend: nextBackend, draws: nextDraws });
      backend = nextBackend;
      drawsByPass = nextDraws;
    };
    await buildRasterQuality(rasterQuality);

    const resolveUniform = track(device.createBuffer({ size: RESOLVE_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
    device.queue.writeBuffer(resolveUniform, 0, new Float32Array([frame.camera.exposure]));
    const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
    const createRasterTargets = (w: number, h: number) => {
      const hdr = device.createTexture({
        size: [w, h], format: backend.hdrFormat,
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
      });
      let depth: GPUTexture | undefined;
      try {
        depth = device.createTexture({
          size: [w, h], format: backend.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const hdrView = hdr.createView();
        const resolveBindGroup = device.createBindGroup({
          layout: resolvePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: hdrView }, { binding: 1, resource: sampler },
            { binding: 2, resource: { buffer: resolveUniform } },
          ],
        });
        const depthView = depth.createView();
        const depthTexture = depth;
        return { hdrView, depthView, resolveBindGroup, destroy: () => { hdr.destroy(); depthTexture.destroy(); } };
      } catch (error) {
        hdr.destroy();
        depth?.destroy();
        throw error;
      }
    };
    let targets = createRasterTargets(width, height);
    trash.push({ destroy: () => targets.destroy() });
    const rasterBackground = frame.environment.radiance;

    // Optional raster environment background: a fullscreen pass that samples the
    // equirect dome texture along each pixel's world ray, cleared behind geometry.
    let envBgUniform: GPUBuffer | undefined;
    let envBgBindGroup: GPUBindGroup | undefined;
    let envBgPipeline: GPURenderPipeline | undefined;
    if (envAsset && envTextureView && envSampler) {
      const envBgModule = device.createShaderModule({
        code: `
struct EnvBg { invViewProj: mat4x4<f32>, eye: vec4<f32>, tint: vec4<f32> };
@group(0) @binding(0) var<uniform> E : EnvBg;
@group(0) @binding(1) var envTex : texture_2d<f32>;
@group(0) @binding(2) var envSamp : sampler;
const PI : f32 = 3.14159265358979;
struct VO { @builtin(position) pos: vec4<f32>, @location(0) ndc: vec2<f32> };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VO {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -3.0), vec2<f32>(-1.0, 1.0), vec2<f32>(3.0, 1.0));
  var o: VO;
  o.pos = vec4<f32>(p[i], 1.0, 1.0);
  o.ndc = p[i];
  return o;
}
fn dir_to_uv(d: vec3<f32>) -> vec2<f32> {
  let n = normalize(d);
  let u = atan2(n.z, n.x) * (0.5 / PI) + 0.5;
  let v = acos(clamp(n.y, -1.0, 1.0)) / PI;
  return vec2<f32>(u, v);
}
@fragment fn fs(in: VO) -> @location(0) vec4<f32> {
  let near = E.invViewProj * vec4<f32>(in.ndc, 0.0, 1.0);
  let world = near.xyz / near.w;
  let dir = world - E.eye.xyz;
  let c = textureSample(envTex, envSamp, dir_to_uv(dir)).xyz;
  return vec4<f32>(c * E.tint.xyz, 1.0);
}
`,
      });
      envBgPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: envBgModule, entryPoint: 'vs' },
        fragment: { module: envBgModule, entryPoint: 'fs', targets: [{ format: backend.hdrFormat }] },
        primitive: { topology: 'triangle-list' },
        depthStencil: { format: backend.depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
      });
      envBgUniform = track(device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const inten = envAsset.intensity * envRadianceScale;
      const t = envAsset.tint;
      device.queue.writeBuffer(envBgUniform, 80, new Float32Array([t[0] * inten, t[1] * inten, t[2] * inten, 1]));
      envBgBindGroup = device.createBindGroup({
        layout: envBgPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: envBgUniform } },
          { binding: 1, resource: envTextureView },
          { binding: 2, resource: envSampler },
        ],
      });
    }

    // Keep watchdog-safe bands for reference quadrature, not interactive IBL.
    const renderRaster = (targetView: GPUTextureView): void => {
      const { hdrView, depthView, resolveBindGroup } = targets;
      const bandRows = rasterQuality === 'interactive' ? height : Math.max(1, Math.floor(RASTER_BAND_PIXELS / width));
      let encoder = device.createCommandEncoder();
      let first = true;
      if (envBgPipeline && envBgBindGroup) {
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
          depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
        });
        pass.setPipeline(envBgPipeline);
        pass.setBindGroup(0, envBgBindGroup);
        pass.draw(3);
        pass.end();
        first = false;
      }
      for (let y = 0;y < height;y += bandRows) {
        const scissor = { x: 0, y, width, height: Math.min(bandRows, height - y) };
        for (const pass of frame.passes) {
          const draws = drawsByPass.get(pass) ?? [];
          if (draws.length === 0) continue;
          backend.recordScenePass(encoder, { pass, hdrView, depthView, draws, clear: first, clearColor: rasterBackground, scissor });
          first = false;
        }
        if (y + bandRows < height) {
          device.queue.submit([encoder.finish()]);
          encoder = device.createCommandEncoder();
        }
      }
      resolveBackend.recordResolvePass(encoder, { outputView: targetView, bindGroup: resolveBindGroup });
      device.queue.submit([encoder.finish()]);
    };

    // --- path tracer (built on first use: its pipeline costs ~230 MB of driver memory on mobile) ---
    const buildPathTracer = async (ptTrash: Array<{ destroy(): void }>) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (disposed) throw new Error('Viewer disposed during path tracer preparation.');
      const pathTraceBuildStarted = performance.now();
      const ptScene = await buildCachedPathTraceScene(resources, {
        lights: loaded.lights,
        surfaceFor: loaded.mtlx.surfaceFor,
        frameCamera: { viewProj: cameraViewProj, eye: cameraEye, exposure },
        environment: frame.environment,
        settings: pathTraceSettings(loaded.scene),
      });
      performance.measure('pathtracing:scene-build', {
        start: pathTraceBuildStarted,
        end: performance.now(),
        detail: { triangles: ptScene.triangleCount, nodes: ptScene.nodeCount },
      });
      ptScene.environment.textureRadianceScale = envRadianceScale;
      ptScene.camera.backgroundInvViewProj = backgroundInvViewProj;
      pathTraceScene = ptScene;
      const dispatch = buildMaterialDispatch(ptScene.variantSources);
      const track = <T extends { destroy(): void }>(o: T): T => {
        ptTrash.push(o);
        return o;
      };
      // Mobile drivers reserve per-thread stack for the by-value lobe array: size it to the scene.
      const maxLobes = Math.max(
        ...dispatch.variants.map((variant) => variant.lobeCount),
        maxRecordLobes(ptScene.materials, new Set(dispatch.variants.map((variant) => variant.index))),
      );
      const ptCompilation = await compileShaderWithDiagnostics(
        device, pathTraceComputeWgsl({
          dispatch, environment: loaded.environment !== undefined, maxLobes, displayAovs: true,
          closureDispatch: pathTraceClosureDispatch(dispatch, ptScene.materials),
          opaque: pathTraceOpaqueScene(dispatch, ptScene.materials),
          analyticLights: ptScene.analyticLights !== undefined,
        }), 'Path tracing');
      if (ptCompilation.errors.length > 0) {
        this.#onShaderErrors?.([...rasterErrors, ...ptCompilation.errors]);
        throw new Error(`WGSL: ${ptCompilation.errors.length} erreur(s) de compilation (path tracing).`);
      }
      const bindings = await buildPtDeviceBindings(dispatch, ptScene, loaded.mtlx.imageProvider, { sink });
      const ptParameterData = (): ArrayBuffer => packParameterUniforms(dispatch.uniforms, field => {
        const index = /^m(\d+)_/.exec(field.field)?.[1];
        const key = index === undefined ? undefined : ptScene.materialKeys[Number(index)];
        const parameter = key ? resources.materials.get(key)?.parameters?.find(parameter => parameter.uniform === field.name) : undefined;
        if (!parameter) throw new Error(`Missing path-tracing parameter: ${field.field}`);
        return parameter.value;
      });
      const ptBackend = new PathTraceBackend(device, { dispatch, ...(envAsset ? { environment: true } : {}) });
      const { pipeline: ptPipeline } = await ptBackend.createPipelineAsync(ptCompilation.module);
      const displayCompilation = await compileShaderWithDiagnostics(
        device, pathTraceDisplayWgsl(envAsset !== undefined), 'Path tracing display');
      if (displayCompilation.errors.length > 0) {
        this.#onShaderErrors?.([...rasterErrors, ...displayCompilation.errors]);
        throw new Error(`WGSL: ${displayCompilation.errors.length} erreur(s) de compilation (path tracing display).`);
      }
      if (disposed) throw new Error('Viewer disposed during path tracer compilation.');
      let pixelScale = 4;
      let interactiveScale = 4;
      let previewWidth = 0;
      let previewHeight = 0;
      let resetPending = true;
      let needsPreview = true;
      let lastPreview = false;
      let measuredFrames = 0;
      let measuredTime = 0;
      let ptWidth = Math.ceil(width / pixelScale);
      let ptHeight = Math.ceil(height / pixelScale);
      const storage = (data: Float32Array | Uint32Array): GPUBuffer => {
        assertSceneStorageSize(device, Math.max(data.byteLength, 4));
        return track(device.createBuffer({ size: Math.max(data.byteLength, 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }));
      };
      const storageData = (data: Float32Array | Uint32Array): GPUBuffer => {
        const safe = data.byteLength > 0 ? data : data instanceof Uint32Array ? new Uint32Array(1) : new Float32Array(1);
        const buf = storage(safe);
        device.queue.writeBuffer(buf, 0, safe);
        return buf;
      };

      const accumulation = (w: number, h: number): GPUBuffer => device.createBuffer({
        size: w * h * PT_DISPLAY_PIXEL_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      });
      let accumBuffer = accumulation(width, height);
      ptTrash.push({ destroy: () => accumBuffer.destroy() });
      let previewBuffer = accumulation(Math.ceil(width / 2), Math.ceil(height / 2));
      ptTrash.push({ destroy: () => previewBuffer.destroy() });
      const ptUniform = track(device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));

      const group0Entries: GPUBindGroupEntry[] = bindings.group0.map((slot) => {
        if (slot.role === 'uniform') return { binding: slot.binding, resource: { buffer: ptUniform } };
        if (slot.role === 'accum') return { binding: slot.binding, resource: { buffer: accumBuffer } };
        if (slot.role === 'mxUniforms') {
          const data = ptParameterData();
          const mx = track(device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
          uploadPtParameters = () => device.queue.writeBuffer(mx, 0, ptParameterData());
          uploadPtParameters();
          return { binding: slot.binding, resource: { buffer: mx } };
        }
        return { binding: slot.binding, resource: { buffer: storageData(slot.data ?? new Float32Array(1)) } };
      });
      let group0 = device.createBindGroup({ layout: ptPipeline.getBindGroupLayout(0), entries: group0Entries });

      const textureViews = new Map<number, GPUTextureView>();
      for (const tex of bindings.textures) {
        const image = bindings.images[tex.imageIndex];
        const w = image?.width ?? 1;
        const h = image?.height ?? 1;
        const gpuTex = track(device.createTexture({
          size: [w, h],
          format: tex.format,
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        }));
        if (image && image.componentType === 'uint8' && image.channels === 4) {
          device.queue.writeTexture({ texture: gpuTex }, image.data, { bytesPerRow: w * 4, rowsPerImage: h }, [w, h, 1]);
        }
        textureViews.set(tex.binding, gpuTex.createView());
      }
      const group1 =
        bindings.textures.length > 0
          ? device.createBindGroup({
            layout: ptPipeline.getBindGroupLayout(1),
            entries: bindings.textures.map((tex) => ({ binding: tex.binding, resource: textureViews.get(tex.binding)! })),
          })
          : undefined;
      const group2 =
        bindings.samplers.length > 0
          ? device.createBindGroup({
            layout: ptPipeline.getBindGroupLayout(2),
            entries: bindings.samplers.map((s) => ({
              binding: s.binding,
              resource: device.createSampler({
                addressModeU: s.descriptor.addressModeU,
                addressModeV: s.descriptor.addressModeV,
                magFilter: s.descriptor.magFilter,
                minFilter: s.descriptor.minFilter,
              }),
            })),
          })
          : undefined;
      const ptEnvGroup =
        envAsset && envTextureView && envSampler && envCdfBuffer
          ? device.createBindGroup({
            layout: ptPipeline.getBindGroupLayout(3),
            entries: [
              { binding: 0, resource: envTextureView },
              { binding: 1, resource: envSampler },
              { binding: 2, resource: { buffer: envCdfBuffer } },
            ],
          })
          : undefined;

      const ptDisplayModule = displayCompilation.module;
      const ptDisplayPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: ptDisplayModule, entryPoint: 'vs' },
        fragment: { module: ptDisplayModule, entryPoint: 'fs', targets: [{ format: outputFormat }] },
        primitive: { topology: 'triangle-list' },
      });
      const ptInfo = track(device.createBuffer({ size: PT_DISPLAY_INFO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const neuralTarget = (w: number, h: number): GPUTexture => device.createTexture({
        size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      let neuralTexture = neuralTarget(width, height);
      ptTrash.push({ destroy: () => neuralTexture.destroy() });
      const displayGroup = (accum: GPUBuffer, preview: GPUBuffer, neural: GPUTexture, uniform = ptInfo): GPUBindGroup => device.createBindGroup({
        layout: ptDisplayPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: accum } },
          { binding: 1, resource: { buffer: uniform } },
          { binding: 2, resource: { buffer: preview } },
          { binding: 5, resource: neural.createView() },
          ...(envAsset && envTextureView && envSampler ? [
            { binding: 3, resource: envTextureView }, { binding: 4, resource: envSampler },
          ] : []),
        ],
      });
      let ptDisplayBindGroup = displayGroup(accumBuffer, previewBuffer, neuralTexture);
      let neuralReady = false;
      let denoiserBusy = false;
      let denoiserRevision = 0;
      let lastDenoisedSample = 0;
      let denoiserStatus: DenoiserStatus = { state: 'waiting' };
      const invalidateDenoise = (): void => {
        denoiserRevision++;
        neuralReady = false;
        lastDenoisedSample = 0;
        denoiserStatus = { state: 'waiting' };
        if (denoiserBusy) this.#jsDenoiser.abort();
      };
      const resetPathTrace = (): void => {
        invalidateDenoise();
        ptBackend.resetAccumulation();
        resetPending = true;
        needsPreview = true;
        previewWidth = 0;
        previewHeight = 0;
      };
      const resizePathTrace = (w: number, h: number): void => {
        const nextAccum = accumulation(w, h);
        let nextPreview: GPUBuffer | undefined;
        let nextNeural: GPUTexture | undefined;
        try {
          nextPreview = accumulation(Math.ceil(w / 2), Math.ceil(h / 2));
          nextNeural = neuralTarget(w, h);
          const entries = group0Entries.map((entry) => bindings.group0.some(
            (slot) => slot.role === 'accum' && slot.binding === entry.binding,
          ) ? { binding: entry.binding, resource: { buffer: nextAccum } } : entry);
          const nextGroup0 = device.createBindGroup({ layout: ptPipeline.getBindGroupLayout(0), entries });
          const nextDisplay = displayGroup(nextAccum, nextPreview, nextNeural);
          accumBuffer.destroy();
          previewBuffer.destroy();
          neuralTexture.destroy();
          accumBuffer = nextAccum;
          previewBuffer = nextPreview;
          neuralTexture = nextNeural;
          group0 = nextGroup0;
          ptDisplayBindGroup = nextDisplay;
          ptWidth = Math.max(1, Math.ceil(w / pixelScale));
          ptHeight = Math.max(1, Math.ceil(h / pixelScale));
          resetPathTrace();
        } catch (error) {
          nextAccum.destroy();
          nextPreview?.destroy();
          nextNeural?.destroy();
          throw error;
        }
      };
      const renderPathTrace = (targetView: GPUTextureView, tiled: boolean, accumulate: boolean): void => {
        const encoder = device.createCommandEncoder();
        tiled = tiled && !needsPreview;
        const nextPixelScale = accumulate ? (tiled ? 1 : interactiveScale) : pixelScale;
        if (resetPending) {
          encoder.clearBuffer(accumBuffer);
          resetPending = false;
        } else if (pixelScale > 1 && nextPixelScale === 1) {
          // Preserve this camera's complete preview until each full-resolution tile arrives.
          encoder.copyBufferToBuffer(accumBuffer, 0, previewBuffer, 0, ptWidth * ptHeight * PT_DISPLAY_PIXEL_BYTES);
          previewWidth = ptWidth;
          previewHeight = ptHeight;
        }
        if (pixelScale !== nextPixelScale) {
          pixelScale = nextPixelScale;
          ptWidth = Math.max(1, Math.ceil(width / pixelScale));
          ptHeight = Math.max(1, Math.ceil(height / pixelScale));
          ptBackend.resetAccumulation();
          encoder.clearBuffer(accumBuffer);
        }
        const info = new ArrayBuffer(PT_DISPLAY_INFO_BYTES);
        const floats = new Float32Array(info);
        const ints = new Uint32Array(info);
        ints.set([ptWidth, ptHeight], 0);
        floats[2] = exposure;
        ints[3] = this.#pathTracingDenoise && neuralReady ? 1 : 0;
        ints.set([previewWidth, previewHeight, width, height], 4);
        floats.set(backgroundInvViewProj, 8);
        floats.set([...cameraEye, 0], 24);
        const tint = envAsset?.tint ?? [1, 1, 1];
        floats.set(tint.map((v) => v * (envAsset?.intensity ?? 1) * envRadianceScale), 28);
        floats.set(frame.environment.radiance, 32);
        device.queue.writeBuffer(ptInfo, 0, info);
        lastPreview = accumulate && !tiled;
        if (accumulate) {
          needsPreview = false;
          const { tile, frameIndex } = tiled
            ? ptBackend.advanceTile(ptWidth, ptHeight)
            : { tile: { x: 0, y: 0, width: ptWidth, height: ptHeight }, frameIndex: ptBackend.advanceFrame() };
          const [wgX, wgY] = PathTraceBackend.workgroupCount(tile.width, tile.height);
          device.queue.writeBuffer(ptUniform, 0, buildPathTraceUniform(ptScene, frameIndex, 1, ptWidth, ptHeight, 0, tile));
          const compute = encoder.beginComputePass();
          compute.setPipeline(ptPipeline);
          compute.setBindGroup(0, group0);
          if (group1) compute.setBindGroup(1, group1);
          if (group2) compute.setBindGroup(2, group2);
          if (ptEnvGroup) compute.setBindGroup(3, ptEnvGroup);
          compute.dispatchWorkgroups(wgX, wgY, 1);
          compute.end();
        }
        const renderPass = encoder.beginRenderPass({
          colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        });
        renderPass.setPipeline(ptDisplayPipeline);
        renderPass.setBindGroup(0, ptDisplayBindGroup);
        renderPass.draw(3);
        renderPass.end();
        device.queue.submit([encoder.finish()]);
        const samples = ptBackend.frameIndex;
        if (this.#pathTracingDenoise && !denoiserBusy && !this.#jsDenoiser.busy && denoiserStatus.state !== 'error'
          && pixelScale === 1 && samples >= 1 && (lastDenoisedSample === 0 || samples >= lastDenoisedSample + 8)) {
          void runDenoise(info, samples);
        }
      };
      const runDenoise = async (displayInfo: ArrayBuffer, samples: number): Promise<void> => {
        denoiserBusy = true;
        denoiserStatus = { state: 'running' };
        lastDenoisedSample = samples;
        const revision = denoiserRevision;
        const w = width;
        const h = height;
        const jobTrash: Array<{ destroy(): void }> = [];
        const own = <T extends { destroy(): void }>(resource: T): T => { jobTrash.push(resource); return resource; };
        this.#emitStatus();
        try {
          const source = own(device.createTexture({
            size: [w, h], format: outputFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
          }));
          const stride = Math.ceil(w * 4 / 256) * 256;
          const readback = own(device.createBuffer({ size: stride * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }));
          const rawInfo = own(device.createBuffer({ size: PT_DISPLAY_INFO_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
          const data = displayInfo.slice(0);
          new Uint32Array(data)[3] = 0;
          device.queue.writeBuffer(rawInfo, 0, data);
          const rawGroup = displayGroup(accumBuffer, previewBuffer, neuralTexture, rawInfo);
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: source.createView(), loadOp: 'clear', storeOp: 'store' }],
          });
          pass.setPipeline(ptDisplayPipeline);
          pass.setBindGroup(0, rawGroup);
          pass.draw(3);
          pass.end();
          encoder.copyTextureToBuffer({ texture: source }, { buffer: readback, bytesPerRow: stride }, [w, h]);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          const rgba = new Uint8ClampedArray(w * h * 4);
          try {
            const bytes = new Uint8Array(readback.getMappedRange());
            const bgra = outputFormat.startsWith('bgra');
            for (let y = 0; y < h; y++) {
              for (let x = 0; x < w; x++) {
                const src = y * stride + x * 4;
                const dst = (y * w + x) * 4;
                rgba[dst] = bytes[src + (bgra ? 2 : 0)]!;
                rgba[dst + 1] = bytes[src + 1]!;
                rgba[dst + 2] = bytes[src + (bgra ? 0 : 2)]!;
                rgba[dst + 3] = 255;
              }
            }
          } finally { readback.unmap(); }
          if (disposed || revision !== denoiserRevision || !this.#pathTracingDenoise) return;
          const result = await this.#jsDenoiser.run(new ImageData(rgba, w, h));
          if (disposed || revision !== denoiserRevision || !this.#pathTracingDenoise) return;
          device.queue.writeTexture({ texture: neuralTexture }, result.data, { bytesPerRow: w * 4 }, [w, h]);
          neuralReady = true;
          denoiserStatus = { state: 'ready' };
        } catch (error) {
          if (!disposed && revision === denoiserRevision) {
            const message = error instanceof Error ? error.message : String(error);
            denoiserStatus = { state: 'error', error: message };
            console.error('JS denoiser failed:', error);
          }
        } finally {
          for (const resource of jobTrash) resource.destroy();
          denoiserBusy = false;
          if (!this.#disposed) {
            this.#ptDisplayDirty = true;
            this.#emitStatus();
          }
        }
      };
      const reportFrameTime = (milliseconds: number): void => {
        if (!lastPreview) return;
        measuredFrames++;
        measuredTime += milliseconds;
        if (measuredFrames >= 4) {
          interactiveScale = previewScale(interactiveScale, measuredTime / measuredFrames);
          measuredFrames = 0;
          measuredTime = 0;
        }
      };
      return {
        renderPathTrace, reportFrameTime, resetPathTrace, invalidateDenoise,
        denoiserStatus: (): DenoiserStatus => this.#pathTracingDenoise ? denoiserStatus : { state: 'off' },
        resize: resizePathTrace, frameCount: () => ptBackend.frameIndex,
      };
    };

    let ptState: PathTracerState = 'idle';
    let pathTracer: Awaited<ReturnType<typeof buildPathTracer>> | undefined;
    const startPathTracer = (): void => {
      if (ptState !== 'idle') return;
      ptState = 'compiling';
      const ptTrash: Array<{ destroy(): void }> = [];
      buildPathTracer(ptTrash).then((built) => {
        if (disposed) {
          for (const o of ptTrash) o.destroy();
          return;
        }
        trash.push(...ptTrash);
        pathTracer = built;
        ptState = 'ready';
        this.#ptDisplayDirty = true;
        this.#emitStatus();
      }, (error: unknown) => {
        for (const o of ptTrash) o.destroy();
        if (disposed) return;
        ptState = 'error';
        console.error(`Path tracer: ${(error as Error)?.message ?? error}`);
        this.#emitStatus();
      });
    };

    const applyCamera = (viewProj: readonly number[], eye: Vec3, backgroundInverse: readonly number[]): void => {
      cameraViewProj = viewProj;
      cameraEye = eye;
      backgroundInvViewProj = backgroundInverse;
      const viewProjArray = new Float32Array(viewProj);
      const eyeArray = new Float32Array([eye[0], eye[1], eye[2], 0]);
      for (const buf of frameUniforms) {
        device.queue.writeBuffer(buf, 16 * 4, viewProjArray);
        device.queue.writeBuffer(buf, 32 * 4, eyeArray);
      }
      const invViewProj = inverse4(viewProj);
      if (envBgUniform) {
        device.queue.writeBuffer(envBgUniform, 0, new Float32Array(backgroundInvViewProj));
        device.queue.writeBuffer(envBgUniform, 64, eyeArray);
      }
      if (pathTraceScene) {
        pathTraceScene.camera.viewProj = viewProj;
        pathTraceScene.camera.invViewProj = invViewProj;
        pathTraceScene.camera.eye = [eye[0], eye[1], eye[2]];
        pathTraceScene.camera.backgroundInvViewProj = backgroundInvViewProj;
      }
    };

    return {
      updateMaterial: (key, material) => {
        resources.materials.set(key, material);
        const data = materialUniformData(material);
        for (const buffer of parameterBuffers.get(key) ?? []) device.queue.writeBuffer(buffer, 0, data);
        uploadPtParameters?.();
      },
      frame,
      resize: (w, h) => {
        const next = createRasterTargets(w, h);
        try {
          pathTracer?.resize(w, h);
        } catch (error) {
          next.destroy();
          throw error;
        }
        targets.destroy();
        targets = next;
        width = w;
        height = h;
      },
      setRasterQuality: async (quality) => {
        await buildRasterQuality(quality);
        if (disposed) throw new Error('Viewer disposed during raster compilation.');
        rasterQuality = quality;
        applyCamera(cameraViewProj, cameraEye, backgroundInvViewProj);
      },
      renderRaster,
      renderPathTrace: (targetView, tiled, accumulate) => {
        if (pathTracer) pathTracer.renderPathTrace(targetView, tiled, accumulate);
        else {
          startPathTracer();
          const encoder = device.createCommandEncoder();
          const pass = encoder.beginRenderPass({
            colorAttachments: [{ view: targets.hdrView, clearValue: { r: rasterBackground[0], g: rasterBackground[1], b: rasterBackground[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }],
            depthStencilAttachment: { view: targets.depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
          });
          if (envBgPipeline && envBgBindGroup) {
            pass.setPipeline(envBgPipeline);
            pass.setBindGroup(0, envBgBindGroup);
            pass.draw(3);
          }
          pass.end();
          resolveBackend.recordResolvePass(encoder, { outputView: targetView, bindGroup: targets.resolveBindGroup });
          device.queue.submit([encoder.finish()]);
        }
      },
      reportFrameTime: (milliseconds) => pathTracer?.reportFrameTime(milliseconds),
      invalidateDenoise: () => pathTracer?.invalidateDenoise(),
      denoiserStatus: () => pathTracer?.denoiserStatus() ?? { state: this.#pathTracingDenoise ? 'waiting' : 'off' },
      resetPathTrace: () => pathTracer?.resetPathTrace(),
      applyCamera,
      frameCount: () => pathTracer?.frameCount() ?? 0,
      pathTracerState: () => ptState,
      dispose: () => {
        disposed = true;
        pathTracer?.invalidateDenoise();
        pathTracer = undefined;
        for (const o of trash) o.destroy();
      },
    };
  }
}
