// Interactive on-canvas viewer (T051/T052 live counterpart of the offscreen USD
// capture harness). Loads a USD scene through the shared asset loader (usd-scene-
// assets.ts). Each backend's resources are built on first use. Resolution
// changes replace targets, not scene data or pipelines.

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
import { buildPathTraceUniform, pathTraceComputeWgsl, pathTraceClosureDispatch, pathTraceOpaqueScene, PathTraceBackend, pathTraceTileCount, PT_UNIFORM_SIZE } from './pathtracing/compute.ts';
import { pathTraceSettings } from './pathtracing/scene-settings.ts';
import { cameraFovY } from '../usd/cameras.ts';
import { buildMaterialDispatch } from './pathtracing/material-variant.ts';
import { buildPtDeviceBindings } from './pathtracing/device-bindings.ts';
import { maxRecordLobes, PT_MAX_LOBES } from './pathtracing/material-record.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
import { tonemapIndex, type Tonemap } from './output.ts';
import { loadUsdScene, uploadMaterialTextures, type LoadedUsdScene, type ObjectMaterialOverride, type SceneLoadOptions } from './usd-scene-assets.ts';
import { assertSceneStorageSize, assertSceneTextureBindings, withGpuValidation } from '../gpu/device.ts';
import { uploadMaterialImage, uploadMaterialImageArray } from '../gpu/material-texture.ts';
import { packPtTextureArrays } from './pathtracing/texture-arrays.ts';
import { OrbitCamera, attachOrbitControls } from '../scene/orbit-camera.ts';
import { inverse4, lookAt4, multiply4, perspective4, transformDirection, type Vec3 } from '../scene/transforms.ts';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import {
  compileShaderBatch, SHADER_COMPILATION_CONCURRENCY, type ShaderCompilationError,
} from '../gpu/shader-diagnostics.ts';
import { packHdrTexture } from '../assets/hdr-texture.ts';
import { generateEnvironmentMipmaps } from './env/mipmaps.ts';
import { assembleIrForwardShader, type RasterQuality } from './raster/ir-forward.ts';
import { rasterVolumeWgsl, RASTER_VOLUME_UNIFORM_BYTES } from './raster/volume-pass.ts';
import {
  pathTraceDisplayWgsl, pathTraceStorageBytesPerPixel, pathTraceViewIndex, pathTraceViewStoresAov, previewScale,
  PT_DISPLAY_INFO_BYTES, PT_DISPLAY_PIXEL_BYTES, PT_SURFACE_AOV_PIXEL_BYTES, type PathTraceAovData, type PathTraceView,
} from './pathtracing/display.ts';
import {
  pathTraceConvergenceWgsl, PT_CONVERGENCE_COLUMNS, PT_CONVERGENCE_MIN_SAMPLES,
  PT_CONVERGENCE_MAX_TARGET_RELATIVE_ERROR, PT_CONVERGENCE_MIN_TARGET_RELATIVE_ERROR,
  PT_CONVERGENCE_ROWS, PT_CONVERGENCE_TARGET_RELATIVE_ERROR, PT_CONVERGENCE_UNIFORM_BYTES, PT_CONVERGENCE_ZONE_BYTES,
  type PathTraceConvergence,
} from './pathtracing/convergence.ts';
import { JsDenoiser } from './pathtracing/js-denoiser.ts';
import { PathTraceStopping, pathTraceMetrics, type PathTraceRenderLimits, type PathTraceProgress, type PathTraceMetrics } from './pathtracing/render-limits.ts';
import { canInsertMaterialConstant, changeMaterialConstant, changeMaterialConstantLink, changeMaterialParameters, compileEditableMaterial, materialConstantSources, materialUniformData, packParameterUniforms, visibleMaterialParameters, type MaterialParameter } from './material-parameters.ts';
import { applySceneDisplacement } from './displacement.ts';
import type { MaterialResource, SceneResources } from './scene-resources.ts';
import { prepareDisneyScene } from './pathtracing/disney-scene.ts';
import { DisneyGpuBackend } from './pathtracing/disney-gpu-backend.ts';
import { packDisneyLights } from './pathtracing/disney-lights.ts';
import type { DisneyShaderSpecialization } from './pathtracing/disney-shader-specialization.ts';
import { buildDisneyEnvironmentCdf } from './pathtracing/disney-environment.ts';
import { disneyTileForIndex, type DisneyRenderSettings } from './pathtracing/disney-render.ts';
import type { SceneLight } from '../usd/lights.ts';
import {
  applyCompiledMaterials, compiledRasterShaderKey, loadCompiledMaterial, loadCompiledScene, readCompiledLayerReferences,
  type CompiledMaterial,
} from '../scene/compiled-scene.ts';

function describeObjects(
  loaded: LoadedUsdScene, assetPaths: ReadonlyMap<string, string>,
): Array<{ path: string; material: string; assetPath?: string }> {
  return loaded.resources.instances.filter((instance) => instance.hasGeometry).map((instance) => {
    const material = instance.materialKey ? loaded.resources.materials.get(instance.materialKey) : undefined;
    const assetPath = assetPaths.get(instance.primPath);
    return { path: instance.primPath, material: material?.materialName ?? 'Default', ...(assetPath ? { assetPath } : {}) };
  });
}

/** Preview fill + framing shared with the capture harness so the live view matches. */
const PREVIEW_ENV: Vec3 = [0.65, 0.68, 0.72];
const RASTER_BAND_PIXELS = 256 * 256;
const PATH_TRACE_TILES_PER_REFRESH = 4;
const PATH_TRACE_MAX_TILES_PER_REFRESH = 16;
function previewCamera(aspect: number, exposure: number): FrameCamera {
  const target: Vec3 = [0, 0.3, 0];
  const dir: Vec3 = [0.657, 0.438, 0.613];
  const dist = 7;
  const eye: Vec3 = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
  return { viewProj: multiply4(perspective4(0.62, aspect, 0.001, 10000), lookAt4(eye, target, [0, 1, 0])), eye, exposure };
}

const DISNEY_TEXTURE_SIZE = 2048;
const DISNEY_TILES_PER_FRAME = 4;
const DISNEY_STATIC_PATH_OPTIONS = {
  rrDepth: 2, russianRoulette: true, uniformLight: false, hideEmitters: false,
  transparentBackground: false, alphaTest: true, medium: false, volumeMis: false,
  flipNormalY: false, mollify: false, environmentLinear: true,
} satisfies Omit<DisneyShaderSpecialization, 'lightCount'>;

function disneyCamera(orbit: OrbitCamera): DisneyRenderSettings['camera'] {
  const eye = orbit.eye;
  const forwardVector: Vec3 = [orbit.target[0] - eye[0], orbit.target[1] - eye[1], orbit.target[2] - eye[2]];
  const forwardLength = Math.hypot(...forwardVector);
  if (!(forwardLength > 0) || !Number.isFinite(forwardLength)) throw new Error('Invalid Disney camera direction.');
  const forward: Vec3 = [
    forwardVector[0] / forwardLength, forwardVector[1] / forwardLength, forwardVector[2] / forwardLength,
  ];
  const rightVector: Vec3 = [-forward[2], 0, forward[0]];
  const rightLength = Math.hypot(...rightVector);
  if (!(rightLength > 0) || !Number.isFinite(rightLength)) throw new Error('Invalid Disney camera right vector.');
  const right: Vec3 = [rightVector[0] / rightLength, rightVector[1] / rightLength, rightVector[2] / rightLength];
  const up: Vec3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  return {
    position: eye, right, up, forward, fov: orbit.fovY, focalDistance: orbit.distance, aperture: 0,
    orthographic: orbit.projection === 'orthographic',
  };
}

function disneyEnvironmentRotation(lights: readonly SceneLight[]): number {
  const dome = lights.find(light => light.type === 'dome');
  if (!dome) return 0;
  const x = transformDirection(dome.transform, [1, 0, 0]);
  const y = transformDirection(dome.transform, [0, 1, 0]);
  if (Math.abs(x[1]) > 1e-5 || Math.abs(y[0]) > 1e-5 || Math.abs(y[2]) > 1e-5 || y[1] < 0) {
    throw new Error(`Disney environment supports only upright dome rotations: ${dome.path}.`);
  }
  const rotation = Math.atan2(-x[2], x[0]) / (2 * Math.PI);
  if (!Number.isFinite(rotation)) throw new Error(`Invalid Disney environment rotation: ${dome.path}.`);
  return rotation;
}

export type BackendKind = 'raster' | 'pathtracing' | 'disney';
export type MaterialVariantSlot = 'A' | 'B';

export type PathTracerState = 'idle' | 'compiling' | 'ready' | 'error';
export type DenoiserStatus =
  | { state: 'off' | 'waiting' | 'running' | 'ready' }
  | { state: 'error'; error: string };

export interface ViewerStatus {
  environmentEnabled: boolean;
  backend: BackendKind;
  pathTracingPaused: boolean;
  pathTracer: PathTracerState;
  rasterQuality: RasterQuality;
  pathTracingDenoise: boolean;
  denoiserComparison?: boolean;
  pathTracingAdaptive: boolean;
  pathTracingView: PathTraceView;
  pathTracingLimits: PathTraceRenderLimits;
  pathTracingProgress?: PathTraceProgress;
  pathTracingMetrics?: PathTraceMetrics;
  denoiser: DenoiserStatus;
  drawCount: number;
  passes: readonly ScenePassKind[];
  samples: number;
  warnings: number;
  convergence?: PathTraceConvergence;
  convergenceError?: string;
}

/** A disposable per-scene GPU render set (raster + lazily built path tracer) for one loaded USD. */
interface SceneRender {
  setEnvironmentEnabled: (enabled: boolean) => void;
  updateMaterial: (key: string, material: MaterialResource) => void;
  frame: SceneFramePlan;
  resize: (width: number, height: number) => Promise<void>;
  setRasterQuality: (quality: RasterQuality) => Promise<void>;
  pathTracingDepth: () => number;
  setPathTracingDepth: (depth: number) => void;
  setExposure: (exposure: number) => void;
  setTonemap: (tonemap: Tonemap) => Promise<void>;
  renderRaster: (targetView: GPUTextureView) => void;
  /** Starts the path tracer build on first call; renders nothing until it is ready. */
  renderPathTrace: (targetView: GPUTextureView, tiled: boolean, accumulate: boolean) => void;
  capturePathTrace: (targetView: GPUTextureView, samples: number) => Promise<void>;
  renderDisney: (targetView: GPUTextureView, accumulate: boolean) => void;
  reportFrameTime: (milliseconds: number) => void;
  invalidateDenoise: () => void;
  denoiserStatus: () => DenoiserStatus;
  pathTraceConvergence: () => PathTraceConvergence | undefined;
  pathTraceConvergenceError: () => string | undefined;
  readPathTracingAov: (view: Exclude<PathTraceView, 'beauty'>) => Promise<PathTraceAovData>;
  pathTraceProgress: () => PathTraceProgress | undefined;
  setPathTracingLimits: (limits: PathTraceRenderLimits) => void;
  resetPathTrace: () => void;
  applyCamera: (viewProj: readonly number[], eye: Vec3, backgroundInvViewProj: readonly number[]) => void;
  frameCount: () => number;
  pathTracerState: () => PathTracerState;
  dispose: () => void;
}

export class InteractiveViewer {
  readonly #device: GPUDevice;
  readonly #context: GPUCanvasContext | undefined;
  readonly #outputFormat: GPUTextureFormat;
  readonly #canvas: HTMLCanvasElement | undefined;
  #width: number;
  #height: number;
  #backend: BackendKind = 'raster';
  #rasterQuality: RasterQuality = 'interactive';
  #pathTracingDepthOverride: number | undefined;
  #pathTracingPaused = false;
  #pathTracingDenoise = false;
  #pathTracingDenoiserComparison = false;
  #pathTracingAdaptive = false;
  #pathTracingView: PathTraceView = 'beauty';
  #pathTracingLimits: PathTraceRenderLimits = {
    stopOnConvergence: false, timeBudgetSeconds: 0, targetRelativeError: PT_CONVERGENCE_TARGET_RELATIVE_ERROR,
  };
  #environmentEnabled = true;
  readonly #jsDenoiser: JsDenoiser;
  #ptDisplayDirty = true;
  #orbit: OrbitCamera;
  #current: SceneRender | null = null;
  #loaded: Awaited<ReturnType<typeof loadUsdScene>> | undefined;
  readonly #materialVariants = new Map<string, Partial<Record<MaterialVariantSlot, MaterialResource>>>();
  #loadOptions: SceneLoadOptions = {};
  #firstFrameStart: number | undefined;
  #sceneEntry: string | undefined;
  #materialOverrides = new Map<string, ObjectMaterialOverride>();
  #compiledBase: LoadedUsdScene | undefined;
  #compiledOverrides = new Map<string, { assetPath: string; material: CompiledMaterial }>();
  readonly #compiledMaterialCache = new Map<string, Promise<CompiledMaterial>>();
  #objects: ReadonlyArray<{ path: string; material: string; assetPath?: string }> = [];
  #warnings = 0;
  #rasterDirty = true;
  #framePending = false;
  #pathTraceRefill: ReturnType<typeof setTimeout> | undefined;
  #disposed = false;
  #lastCameraChange = -Infinity;
  readonly #orbitControls: boolean;
  #detachControls: () => void;
  #onStatus: ((s: ViewerStatus) => void) | undefined;
  #onShaderErrors: ((errors: readonly ShaderCompilationError[]) => void) | undefined;
  #onDiagnostic: DiagnosticSink | undefined;
  #exposure: number | undefined;
  #tonemap: Tonemap = 'acesFilmic';

  constructor(opts: {
    device: GPUDevice;
    outputFormat: GPUTextureFormat;
    onStatus?: (s: ViewerStatus) => void;
    onShaderErrors?: (errors: readonly ShaderCompilationError[]) => void;
    onDiagnostic?: DiagnosticSink;
  } & (
    { canvas: HTMLCanvasElement; context: GPUCanvasContext; orbitControls?: boolean }
    | { width: number; height: number }
  )) {
    this.#device = opts.device;
    this.#jsDenoiser = new JsDenoiser(opts.device);
    this.#context = 'context' in opts ? opts.context : undefined;
    this.#outputFormat = opts.outputFormat;
    this.#canvas = 'canvas' in opts ? opts.canvas : undefined;
    this.#width = 'canvas' in opts ? opts.canvas.width : opts.width;
    this.#height = 'canvas' in opts ? opts.canvas.height : opts.height;
    this.#onStatus = opts.onStatus;
    this.#onShaderErrors = opts.onShaderErrors;
    this.#onDiagnostic = opts.onDiagnostic;
    this.#orbitControls = 'canvas' in opts && opts.orbitControls !== false;
    this.#orbit = OrbitCamera.fromEyeTarget([0, 0.3 + 0.438 * 7, 0], [0, 0.3, 0], this.#width / this.#height);
    this.#detachControls = this.#bindOrbitControls();
    if (this.#context) this.#loop();
  }

  get backend(): BackendKind {
    return this.#backend;
  }

  get rasterQuality(): RasterQuality {
    return this.#rasterQuality;
  }

  get pathTracingDepth(): number {
    return this.#current?.pathTracingDepth() ?? this.#pathTracingDepthOverride ?? 64;
  }

  setPathTracingDepth(depth: number): void {
    if (!Number.isInteger(depth) || depth < 0 || depth > 64) {
      throw new Error('Path-tracing depth must be an integer between 0 and 64.');
    }
    if (depth === this.pathTracingDepth) return;
    this.#clearDenoiserComparison();
    this.#pathTracingDepthOverride = depth;
    this.#current?.setPathTracingDepth(depth);
    this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  get environmentEnabled(): boolean { return this.#environmentEnabled; }

  setEnvironmentEnabled(enabled: boolean): void {
    if (enabled === this.#environmentEnabled) return;
    this.#clearDenoiserComparison();
    this.#environmentEnabled = enabled;
    this.#current?.setEnvironmentEnabled(enabled);
    if (this.#backend === 'pathtracing' || this.#backend === 'disney') this.#current?.resetPathTrace();
    this.#rasterDirty = true;
    this.#ptDisplayDirty = true;
    this.#emitStatus();
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

  objectParameters(path: string, nodeId?: string): readonly MaterialParameter[] {
    const resources = this.#loaded?.parameterResources;
    const key = resources?.instances.find(instance => instance.primPath === path)?.materialKey;
    const material = key ? resources?.materials.get(key) : undefined;
    return material ? visibleMaterialParameters(material, nodeId) : [];
  }

  objectSurfaceGraph(path: string) {
    const resources = this.#loaded?.parameterResources ?? this.#loaded?.resources;
    const key = resources?.instances.find(instance => instance.primPath === path)?.materialKey;
    return key ? resources?.materials.get(key)?.surfaceGraph : undefined;
  }

  objectSurfaceInputDiagnostics(path: string, nodeId: string) {
    const resources = this.#loaded?.parameterResources ?? this.#loaded?.resources;
    const key = resources?.instances.find(instance => instance.primPath === path)?.materialKey;
    const surface = key ? resources?.materials.get(key)?.resolvedSurface : undefined;
    return surface?.nodeId === nodeId ? surface.inputDiagnostics ?? [] : [];
  }

  objectMaterialVariants(path: string) {
    const material = this.#editableObjectMaterial(path);
    if (!material?.surfaceGraph) return undefined;
    const saved = this.#materialVariants.get(path);
    return {
      A: saved?.A === undefined ? 'empty' : saved.A === material ? 'active' : 'saved',
      B: saved?.B === undefined ? 'empty' : saved.B === material ? 'active' : 'saved',
    } as const;
  }

  saveObjectMaterialVariant(path: string, slot: MaterialVariantSlot): void {
    const material = this.#editableObjectMaterial(path);
    if (!material?.surfaceGraph) throw new Error('Aucun graphe éditable pour cet objet.');
    this.#materialVariants.set(path, { ...this.#materialVariants.get(path), [slot]: material });
  }

  async applyObjectMaterialVariant(path: string, slot: MaterialVariantSlot): Promise<void> {
    const saved = this.#materialVariants.get(path)?.[slot];
    if (!saved) throw new Error(`La variante ${slot} est vide.`);
    await this.#editObjectGraph(path, () => saved);
  }

  #editableObjectMaterial(path: string): MaterialResource | undefined {
    const source = this.#loaded?.parameterResources;
    const key = source?.instances.find(instance => instance.primPath === path)?.materialKey;
    return key ? source?.materials.get(key) : undefined;
  }

  canInsertObjectConstant(path: string, nodeId: string, input: string): boolean {
    const material = this.#editableObjectMaterial(path);
    return !!material && canInsertMaterialConstant(material, nodeId, input);
  }

  async setObjectConstant(path: string, nodeId: string, input: string, insert: boolean): Promise<void> {
    await this.#editObjectGraph(path, material => changeMaterialConstant(material, nodeId, input, insert));
  }

  objectConstantSources(path: string, nodeId: string, input: string): string[] {
    const material = this.#editableObjectMaterial(path);
    return material ? materialConstantSources(material, nodeId, input) : [];
  }

  canUnlinkObjectConstant(path: string, nodeId: string, input: string): boolean {
    const material = this.#editableObjectMaterial(path);
    return material?.resolvedSurface?.nodeId === nodeId
      && !!material.parameters?.some(parameter => parameter.input === input && parameter.linkedConstant !== undefined);
  }

  async setObjectConstantLink(path: string, nodeId: string, input: string, sourceId: string | null): Promise<void> {
    await this.#editObjectGraph(path, material => changeMaterialConstantLink(material, nodeId, input, sourceId));
  }

  async #editObjectGraph(path: string, edit: (material: MaterialResource) => MaterialResource): Promise<void> {
    const loaded = this.#loaded;
    const source = loaded?.parameterResources;
    const key = source?.instances.find(instance => instance.primPath === path)?.materialKey;
    const material = key ? source?.materials.get(key) : undefined;
    if (!loaded || !source || !key || !material || !this.#current) throw new Error(`Unknown editable object: ${path}`);
    const updated = edit(material);
    if (updated === material) return;
    const materials = new Map(source.materials);
    materials.set(key, updated);
    await this.#rebuildMaterialResources(loaded, { ...source, materials });
  }

  get isCompiledScene(): boolean {
    return this.#loaded?.precompiled === true;
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
    const uniformOnly = material.volumeIr === undefined && [...changes.keys()].every(id =>
      material.parameters?.find(parameter => parameter.id === id)?.update === 'uniform');
    let rebuild = false;
    if (!uniformOnly) {
      const compiled = compileEditableMaterial(updated);
      const before = buildSceneFrame(source, { surfaceFor: loaded.mtlx.surfaceFor }).draws.find(draw => draw.materialKey === key);
      const probeMaterials = new Map(source.materials);
      probeMaterials.set(key, compiled);
      const after = buildSceneFrame({ ...source, materials: probeMaterials }, { surfaceFor: loaded.mtlx.surfaceFor })
        .draws.find(draw => draw.materialKey === key);
      rebuild = material.volumeIr !== undefined || material.parameters?.some(parameter => changes.has(parameter.id) && parameter.update === 'rebuild')
        || compiled.sceneShader?.code !== material.sceneShader?.code || before?.pass !== after?.pass;
      if (rebuild) updated = compiled;
    }
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
    await this.#rebuildMaterialResources(loaded, parameterResources);
  }

  async #rebuildMaterialResources(loaded: LoadedUsdScene, parameterResources: SceneResources): Promise<void> {
    const resources = await applySceneDisplacement(parameterResources, loaded.mtlx.imageProvider);
    const candidate = { ...loaded, resources, parameterResources };
    delete candidate.compiled;
    await this.#replaceLoaded(loaded, candidate, 'Scene changed during material update.');
  }

  /** Swap the active scene state without reparsing USD (frame + GPU render set rebuilt from resources). */
  async #replaceLoaded(loaded: LoadedUsdScene, candidate: LoadedUsdScene, changedMessage: string): Promise<void> {
    if (!this.#current) throw new Error('No scene loaded.');
    const exposure = candidate.cameras[0]?.exposure ?? 0;
    const frame = buildSceneFrame(candidate.resources, {
      lights: candidate.lights, surfaceFor: candidate.mtlx.surfaceFor,
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
      throw new Error(changedMessage);
    }
    this.#current.dispose();
    this.#current = render;
    if (this.#pathTracingDepthOverride !== undefined) render.setPathTracingDepth(this.#pathTracingDepthOverride);
    this.#loaded = candidate;
    this.#onCameraChanged();
    this.#emitStatus();
  }

  async resetObjectParameters(path: string): Promise<void> {
    await this.setObjectParameters(path, new Map(this.objectParameters(path)
      .filter(parameter => parameter.value.some((value, i) => value !== parameter.initial[i]))
      .map(parameter => [parameter.id, parameter.initial])));
  }

  /** Replace an object's material. Compiled scenes require `compiledUrl`, a precompiled MaterialX package. */
  async setObjectMaterial(path: string, assetPath?: string, compiledUrl?: string): Promise<void> {
    if (!this.#sceneEntry || !this.#objects.some((object) => object.path === path)) {
      throw new Error(`Unknown object: ${path}`);
    }
    if (this.isCompiledScene) {
      const base = this.#compiledBase;
      if (!base) throw new Error('Compiled scene state is unavailable.');
      if (assetPath && !compiledUrl) throw new Error('This material has no precompiled package.');
      const overrides = new Map(this.#compiledOverrides);
      if (assetPath && compiledUrl) overrides.set(path, { assetPath, material: await this.#compiledMaterial(compiledUrl) });
      else overrides.delete(path);
      const loaded = this.#loaded!;
      const candidate = overrides.size
        ? await applyCompiledMaterials(base, new Map([...overrides].map(([key, value]) => [key, value.material])))
        : base;
      await this.#replaceLoaded(loaded, candidate, 'Scene changed during material replacement.');
      this.#compiledOverrides = overrides;
      this.#objects = describeObjects(candidate, new Map([...overrides].map(([key, value]) => [key, value.assetPath])));
      return;
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

  #compiledMaterial(url: string): Promise<CompiledMaterial> {
    let material = this.#compiledMaterialCache.get(url);
    if (!material) {
      material = loadCompiledMaterial(url).catch(error => { this.#compiledMaterialCache.delete(url); throw error; });
      this.#compiledMaterialCache.set(url, material);
    }
    return material;
  }

  /** Resolve a compiled scene: a `scene.json` manifest, or a USDA layer referencing compiled binaries. */
  async #loadEntry(
    entry: string, overrides: ReadonlyMap<string, ObjectMaterialOverride>, options: SceneLoadOptions, sink: DiagnosticSink,
  ): Promise<LoadedUsdScene> {
    const sourceOptions = { ...options, editableParameters: true };
    if (/(?:^|\/)scene\.json(?:[?#]|$)/i.test(entry)) {
      if (overrides.size || options.imported) throw new Error('Compiled scenes cannot import source material overrides.');
      return loadCompiledScene(entry, sink);
    }
    const references = !options.imported && /\.usda(?:[?#]|$)/i.test(entry)
      ? await readCompiledLayerReferences(entry).catch(() => undefined) : undefined;
    if (!references) return loadUsdScene(entry, sink, () => { }, overrides, sourceOptions);
    if (overrides.size) {
      if (!references.source) throw new Error('Compiled scenes cannot import source material overrides.');
      return loadUsdScene(references.source, sink, () => { }, overrides, sourceOptions);
    }
    try {
      const { shaders, buffers } = references;
      const loaded = await loadCompiledScene(references.scene, sink, fetch, {
        ...(shaders ? { shaders } : {}), ...(buffers ? { buffers } : {}),
      });
      return { ...loaded, entry };
    } catch (error) {
      if (!references.source) throw error;
      sink({ level: 'warning', message: `Compiled binaries unavailable; loading source ${references.source}`, detail: String(error) });
      return loadUsdScene(references.source, sink, () => { }, overrides, sourceOptions);
    }
  }

  get pathTracingPaused(): boolean {
    return this.#pathTracingPaused;
  }

  get pathTracingDenoise(): boolean {
    return this.#pathTracingDenoise;
  }

  get pathTracingAdaptive(): boolean {
    return this.#pathTracingAdaptive;
  }

  get pathTracingView(): PathTraceView {
    return this.#pathTracingView;
  }

  setPathTracingView(view: PathTraceView): void {
    if (pathTraceViewIndex(view) < 0) throw new RangeError(`Unknown path-tracing view: ${view}`);
    if (view === this.#pathTracingView) return;
    if (view !== 'beauty') this.#clearDenoiserComparison();
    this.#pathTracingView = view;
    if (pathTraceViewStoresAov(view)) this.#current?.resetPathTrace();
    this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  readPathTracingAov(): Promise<PathTraceAovData> {
    if (this.#backend !== 'pathtracing' || this.#pathTracingView === 'beauty' || !this.#current) {
      throw new Error('A path-tracing AOV must be selected before exporting it.');
    }
    return this.#current.readPathTracingAov(this.#pathTracingView);
  }

  setPathTracingAdaptive(enabled: boolean): void {
    if (enabled === this.#pathTracingAdaptive) return;
    this.#clearDenoiserComparison();
    this.#pathTracingAdaptive = enabled;
    this.#current?.resetPathTrace();
    this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  get pathTracingLimits(): PathTraceRenderLimits {
    return { ...this.#pathTracingLimits };
  }

  setPathTracingLimits(limits: PathTraceRenderLimits): void {
    if (!Number.isFinite(limits.timeBudgetSeconds) || limits.timeBudgetSeconds < 0) {
      throw new RangeError('Path-tracing time budget must be finite and non-negative.');
    }
    if (!Number.isFinite(limits.targetRelativeError)
      || limits.targetRelativeError < PT_CONVERGENCE_MIN_TARGET_RELATIVE_ERROR
      || limits.targetRelativeError > PT_CONVERGENCE_MAX_TARGET_RELATIVE_ERROR) {
      throw new RangeError('Path-tracing noise target must be between 0.5% and 25%.');
    }
    const targetChanged = limits.targetRelativeError !== this.#pathTracingLimits.targetRelativeError;
    if (limits.stopOnConvergence === this.#pathTracingLimits.stopOnConvergence
      && limits.timeBudgetSeconds === this.#pathTracingLimits.timeBudgetSeconds
      && !targetChanged) return;
    this.#pathTracingLimits = { ...limits };
    this.#current?.setPathTracingLimits(this.#pathTracingLimits);
    if (targetChanged) this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  restartPathTracing(): void {
    this.#clearDenoiserComparison();
    this.#current?.resetPathTrace();
    this.#pathTracingPaused = false;
    this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  setPathTracingDenoise(enabled: boolean): void {
    this.#pathTracingDenoise = enabled;
    if (!enabled) this.#clearDenoiserComparison();
    this.#current?.invalidateDenoise();
    this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  setPathTracingPaused(paused: boolean): void {
    if (paused !== this.#pathTracingPaused) this.#ptDisplayDirty = true;
    if (!paused) this.#clearDenoiserComparison();
    this.#pathTracingPaused = paused;
    this.#emitStatus();
  }

  setPathTracingDenoiserComparison(enabled: boolean): void {
    if (!enabled) {
      if (!this.#pathTracingDenoiserComparison) return;
      this.#pathTracingDenoiserComparison = false;
      this.#ptDisplayDirty = true;
      this.#emitStatus();
      return;
    }
    if (this.#backend !== 'pathtracing' || !this.#pathTracingPaused || !this.#pathTracingDenoise
      || this.#pathTracingView !== 'beauty' || !this.#current || this.#current.frameCount() < 1) {
      throw new Error('Denoiser comparison requires a paused MaterialX beauty render with samples and denoising enabled.');
    }
    this.#pathTracingDenoiserComparison = true;
    this.#current.invalidateDenoise();
    this.#ptDisplayDirty = true;
    this.#emitStatus();
  }

  setBackend(kind: BackendKind): void {
    if (kind === this.#backend) return;
    this.#clearDenoiserComparison();
    this.#backend = kind;
    if (this.#canvas) this.#canvas.style.imageRendering = 'auto';
    this.#ptDisplayDirty = true;
    if (kind === 'pathtracing' || kind === 'disney') this.#current?.resetPathTrace();
    else {
      this.#current?.invalidateDenoise();
      this.#rasterDirty = true;
    }
    this.#emitStatus();
  }

  setExposure(value: number): void {
    if (value === this.#exposure) return;
    this.#clearDenoiserComparison();
    this.#exposure = value;
    this.#current?.setExposure(value);
    this.#ptDisplayDirty = true;
    this.#rasterDirty = true;
    this.#emitStatus();
  }

  async setTonemap(value: Tonemap): Promise<void> {
    if (value === this.#tonemap) return;
    this.#clearDenoiserComparison();
    this.#tonemap = value;
    await this.#current?.setTonemap(value);
    this.#ptDisplayDirty = true;
    this.#rasterDirty = true;
    this.#emitStatus();
  }

  dispose(): void {
    if (this.#pathTraceRefill !== undefined) clearTimeout(this.#pathTraceRefill);
    this.#disposed = true;
    this.#detachControls();
    this.#current?.dispose();
    this.#current = null;
    this.#jsDenoiser.dispose();
    this.#loaded?.mtlx.documents?.delete();
    this.#loaded = undefined;
    this.#materialVariants.clear();
  }

  async resize(width: number, height = width): Promise<void> {
    if (!(width === height && [128, 256, 512, 1024].includes(width)) && !(width === 1024 && height === 768)) throw new Error('Unsupported render resolution.');
    if (width === this.#width && height === this.#height) return;
    await this.#current?.resize(width, height);
    this.#width = width;
    this.#height = height;
    if (this.#canvas) {
      this.#canvas.width = width;
      this.#canvas.height = height;
    }
    this.#orbit.aspect = width / height;
    const camera = this.#loaded?.cameras[0];
    if (camera?.pathtracerFov !== undefined) this.#orbit.fovY = cameraFovY(camera, width / height);
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
      if (this.#onDiagnostic) this.#onDiagnostic(d);
      else if (d.level === 'error') console.error(d.message, d.detail ?? '');
      else if (d.level === 'warning') console.warn(d.message, d.detail ?? '');
    };
    const loaded = await this.#loadEntry(entry, overrides, options, sink);
    const exposure = loaded.cameras[0]?.exposure ?? 0;
    let frame: SceneFramePlan;
    let render: SceneRender;
    try {
      if (this.#disposed) throw new Error('Viewer disposed during load.');
      if (overrides.size > 0 && loaded.resources.pendingMaterials.length > 0) {
        throw new Error('MaterialX compilation failed.');
      }
      const env = loaded.environment;
      const environment = env
        ? { radiance: env.averageRadiance, tint: env.tint, intensity: env.intensity, hasTexture: true, sh: env.sh }
        : { radiance: pathTraceSettings(loaded.scene).converted ? [0, 0, 0] as Vec3 : PREVIEW_ENV };
      Object.assign(environment, { enabled: this.#environmentEnabled });
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
      if (this.#disposed) throw new Error('Viewer disposed during load.');
      const gpuBuildStarted = performance.now();
      render = await this.#buildSceneRender(loaded, frame, exposure, sink);
      performance.measure('viewer:raster-build', { start: gpuBuildStarted, end: performance.now(), detail: { entry } });
    } catch (error) {
      loaded.mtlx.documents?.delete();
      throw error;
    }
    if (this.#disposed) {
      render.dispose();
      loaded.mtlx.documents?.delete();
      throw new Error('Viewer disposed during load.');
    }
    this.#current = render;
    this.#firstFrameStart = loadStarted;
    this.#loaded?.mtlx.documents?.delete();
    this.#loaded = loaded;
    this.#materialVariants.clear();
    this.#loadOptions = options;
    this.#sceneEntry = entry;
    this.#materialOverrides = new Map(overrides);
    this.#compiledBase = loaded.precompiled ? { ...loaded } : undefined;
    this.#compiledOverrides = new Map();
    this.#objects = describeObjects(loaded, new Map([...overrides].map(([key, value]) => [key, value.assetPath])));

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
        if (options.imported) {
          const radius = Math.max(1e-6, Math.hypot(
            bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1], bounds.max[2] - bounds.min[2],
          ) / 2);
          const fovY = Math.PI / 3;
          const distance = 1.2 * radius / Math.sin(fovY / 2);
          const eye: Vec3 = [center[0] + 0.657 * distance, center[1] + 0.438 * distance, center[2] + 0.613 * distance];
          this.#orbit = OrbitCamera.fromEyeTarget(eye, center, this.#width / this.#height, fovY, radius / 1000, distance + radius * 100);
          this.#orbit.projection = 'perspective';
        } else {
          this.#orbit = OrbitCamera.fromEyeTarget(frame.camera.eye, center, this.#width / this.#height);
        }
      }
    }
    this.#detachControls();
    this.#detachControls = this.#bindOrbitControls();
    this.#onCameraChanged();
    this.#emitStatus();
  }

  #onCameraChanged(): void {
    if (!this.#current) return;
    this.#clearDenoiserComparison();
    this.#lastCameraChange = performance.now();
    this.#current.applyCamera(this.#orbit.viewProj(), this.#orbit.eye, inverse4(this.#orbit.backgroundViewProj()));
    this.#rasterDirty = true;
    this.#ptDisplayDirty = true;
    if (this.#backend === 'pathtracing' || this.#backend === 'disney') this.#current.resetPathTrace();
  }

  #emitStatus(): void {
    if (!this.#onStatus || !this.#current) return;
    const convergence = this.#current.pathTraceConvergence();
    const convergenceError = this.#current.pathTraceConvergenceError();
    const progress = this.#current.pathTraceProgress();
    this.#onStatus({
      environmentEnabled: this.#environmentEnabled,
      backend: this.#backend,
      pathTracingPaused: this.#pathTracingPaused,
      pathTracer: this.#current.pathTracerState(),
      rasterQuality: this.#rasterQuality,
      pathTracingDenoise: this.#pathTracingDenoise,
      denoiserComparison: this.#pathTracingDenoiserComparison,
      pathTracingAdaptive: this.#pathTracingAdaptive,
      pathTracingView: this.#pathTracingView,
      pathTracingLimits: this.pathTracingLimits,
      ...(progress ? { pathTracingProgress: progress } : {}),
      ...(progress && this.#backend === 'pathtracing' ? {
        pathTracingMetrics: pathTraceMetrics(progress, this.#pathTracingLimits, this.#current.frameCount(),
          this.#pathTracingAdaptive, convergenceError ? undefined : convergence),
      } : {}),
      denoiser: this.#current.denoiserStatus(),
      drawCount: this.#current.frame.draws.length,
      passes: this.#current.frame.passes,
      samples: this.#current.frameCount(),
      warnings: this.#warnings,
      ...(convergence ? { convergence } : {}),
      ...(convergenceError ? { convergenceError } : {}),
    });
  }

  #clearDenoiserComparison(): void {
    this.#pathTracingDenoiserComparison = false;
  }

  #bindOrbitControls(): () => void {
    return this.#orbitControls && this.#canvas
      ? attachOrbitControls(this.#canvas, this.#orbit, () => this.#onCameraChanged())
      : () => {};
  }

  #loop = (): void => {
    if (this.#disposed) return;
    this.#renderNextFrame();
    requestAnimationFrame(this.#loop);
  };

  renderRasterTo(targetView: GPUTextureView): void {
    if (!this.#current || this.#backend !== 'raster' || this.#context) {
      throw new Error('A loaded headless raster scene is required.');
    }
    this.#current.renderRaster(targetView);
  }

  async renderPathTraceTo(targetView: GPUTextureView, samples: number): Promise<void> {
    if (!this.#current || this.#context) throw new Error('A loaded headless scene is required.');
    await this.#current.capturePathTrace(targetView, samples);
  }

  #renderNextFrame = (): void => {
    const context = this.#context;
    if (this.#disposed || !context) return;
    const current = this.#current;
    if (current && !this.#framePending) {
      let submitted = false;
      const started = performance.now();
      const pathTracingFrame = this.#backend === 'pathtracing' || this.#backend === 'disney';
      const denoising = current.denoiserStatus().state === 'running';
      const stopped = current.pathTraceProgress()?.stopReason !== undefined;
        if (this.#backend === 'pathtracing' && ((!this.#pathTracingPaused && !denoising && !stopped) || this.#ptDisplayDirty)) {
        const tiled = performance.now() - this.#lastCameraChange >= 200;
        current.renderPathTrace(context.getCurrentTexture().createView(), tiled, !this.#pathTracingPaused && !denoising && !stopped);
        this.#ptDisplayDirty = false;
        submitted = true;
        this.#emitStatus();
        } else if (this.#backend === 'disney' && (this.#ptDisplayDirty ||
          (!this.#pathTracingPaused && (current.pathTracerState() === 'idle' || current.pathTracerState() === 'ready')))) {
          current.renderDisney(context.getCurrentTexture().createView(), !this.#pathTracingPaused);
          this.#ptDisplayDirty = false;
          submitted = true;
          this.#emitStatus();
      } else if (this.#backend === 'raster' && this.#rasterDirty) {
        this.#rasterDirty = false;
        current.renderRaster(context.getCurrentTexture().createView());
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
              detail: { entry: this.#sceneEntry, backend: this.#backend } });
          }
          if (pathTracingFrame) current.reportFrameTime(performance.now() - started);
          if (!this.#disposed && current === this.#current) this.#emitStatus();
          this.#framePending = false;
          if (!this.#disposed && current === this.#current && (this.#backend === 'pathtracing' || this.#backend === 'disney')
            && !this.#pathTracingPaused && performance.now() - this.#lastCameraChange >= 200
            && (this.#backend !== 'pathtracing' || current.pathTraceProgress()?.stopReason === undefined)
            && (this.#backend !== 'disney' || current.pathTracerState() === 'ready')
            && this.#pathTraceRefill === undefined) {
            // Refill after a task-boundary yield, not another display-vsync wait.
            // The same framePending gate keeps only one bounded batch in flight.
            this.#pathTraceRefill = setTimeout(() => {
              this.#pathTraceRefill = undefined;
              if (this.#canvas?.ownerDocument?.visibilityState !== 'hidden') this.#renderNextFrame();
            }, 0);
          }
        }, (error: unknown) => {
          this.#framePending = false;
          console.error('GPU frame failed:', error);
        });
      }
    }
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
    let pathTracingDepth = pathTraceSettings(loaded.scene).maxDepth;
    let disposed = false;
    let pathTraceScene: PathTraceScene | undefined;
    let cameraViewProj = frame.camera.viewProj;
    let cameraEye = frame.camera.eye;
    let backgroundInvViewProj = inverse4(frame.camera.viewProj);
    let currentExposure = this.#exposure ?? exposure;
    let currentTonemap = this.#tonemap;
    const outputFormat = this.#outputFormat;
    const resources = { ...loaded.resources, materials: new Map(loaded.resources.materials) };
    const parameterBuffers = new Map<string, GPUBuffer[]>();
    const frameUniforms: Array<{ buffer: GPUBuffer; draw: SceneFramePlan['draws'][number] }> = [];
    let envBgUniform: GPUBuffer | undefined;
    let volumeUniform: GPUBuffer | undefined;
    let uploadPtParameters: (() => void) | undefined;
    this.#onShaderErrors?.([]);
    let rasterErrors: ShaderCompilationError[] = [];
    let pathTraceErrors: ShaderCompilationError[] = [];
    const track = <T extends { destroy(): void }>(o: T): T => {
      if (disposed) {
        o.destroy();
        throw new Error('Viewer disposed during resource preparation.');
      }
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
      const cdf = loaded.compiled?.environmentCdf ?? buildEnvCdf(envAsset.image);
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

    const rasterBackground = (): Vec3 => frame.environment.enabled === false ? [0, 0, 0] : frame.environment.radiance;

    // Keep material textures, geometry buffers and driver pipelines out of a PT-only load.
    const buildRaster = async () => {
      let backend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
      const resolveBackend = backend;
      const resolvePipeline = await resolveBackend.createResolvePipelineAsync(true);

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
      const rasterLights = frame.analyticLights
        ? track(device.createBuffer({ size: frame.analyticLights.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST }))
        : undefined;
      if (rasterLights && frame.analyticLights) device.queue.writeBuffer(rasterLights, 0, frame.analyticLights);
      const rasterSets = new Map<RasterQuality, { backend: RasterBackend; draws: Map<ScenePassKind, SceneDrawCall[]> }>();
      const buildRasterQuality = async (quality: RasterQuality): Promise<void> => {
        const cached = rasterSets.get(quality);
        if (cached) {
          backend = cached.backend;
          drawsByPass = cached.draws;
          return;
        }
        const nextBackend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
        const shaderMaterials = new Map<string, NonNullable<ReturnType<typeof resources.materials.get>>>();
        for (const draw of frame.draws) {
          const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
          if (material?.volumeBoundary || !material?.surfaceModule || shaderMaterials.has(material.variant.pipelineKey)) continue;
          shaderMaterials.set(material.variant.pipelineKey, material);
        }
        const shaders = new Map<string, ReturnType<typeof assembleIrForwardShader>>();
        const shaderMaterialsInOrder = [...shaderMaterials];
        const compiledShaders = await compileShaderBatch(device, shaderMaterialsInOrder.map(([key, material]) => ({
          label: `Raster ${quality}: ${material.materialName}`,
          code: () => {
            const shader = loaded.compiled?.rasterShaders.get(compiledRasterShaderKey(material.unitKey, quality)) ??
              assembleIrForwardShader(material.surfaceModule!, {
                displacement: material.displacement !== undefined, rasterQuality: quality,
                analyticLights: rasterLights !== undefined,
              });
            shaders.set(key, shader);
            return shader.code;
          },
        })));
        if (disposed) throw new Error('Viewer disposed during raster compilation.');
        rasterErrors = compiledShaders.flatMap(compiled => compiled.errors);
        this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
        if (rasterErrors.length > 0) throw new Error(`WGSL: ${rasterErrors.length} erreur(s) de compilation.`);
        const compiledByKey = new Map(shaderMaterialsInOrder.map(([key], index) => [key, compiledShaders[index]!]));
        const pipelineRequests = new Map<string, { pass: ScenePassKind; key: string; material: NonNullable<ReturnType<typeof resources.materials.get>> }>();
        for (const draw of frame.draws) {
          const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
          if (material?.volumeBoundary || !material?.surfaceModule) continue;
          const key = material.variant.pipelineKey;
          const cacheKey = `${draw.pass}:${key}`;
          if (!pipelineRequests.has(cacheKey)) pipelineRequests.set(cacheKey, { pass: draw.pass, key, material });
        }
        const pipelineJobs = [...pipelineRequests.values()];
        const createPipeline = async ({ pass, key, material }: typeof pipelineJobs[number]): Promise<void> => {
          const shader = shaders.get(key);
          const compiled = compiledByKey.get(key);
          if (!shader || !compiled) throw new Error(`Missing compiled raster shader: ${material.materialName}`);
          await nextBackend.createSceneVariantPipelineAsync(
            pass, key, shader.code, compiled.module, !!material.resolvedSurface?.backNodeId,
          );
        };
        for (let start = 0; start < pipelineJobs.length; start += SHADER_COMPILATION_CONCURRENCY) {
          const batch = await Promise.allSettled(
            pipelineJobs.slice(start, start + SHADER_COMPILATION_CONCURRENCY).map(createPipeline),
          );
          for (const result of batch) {
            if (result.status === 'rejected') throw result.reason;
          }
        }
        const nextDraws = new Map<ScenePassKind, SceneDrawCall[]>();
        for (const draw of frame.draws) {
          const buffers = uploaded.get(draw.prototypeId);
          const geometry = resources.geometries.get(draw.prototypeId);
          const position = buffers?.vertexBuffers.get('position');
          const normal = buffers?.vertexBuffers.get('normal');
          if (!buffers || !geometry || !position || !normal) continue;
          const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
          if (material?.volumeBoundary) continue;
          if (!material?.sceneShader) continue;
          const shader = shaders.get(material.variant.pipelineKey);
          if (!shader) throw new Error(`Missing raster shader: ${material.materialName}`);
          const pipeline = nextBackend.sceneVariantPipeline(draw.pass, material.variant.pipelineKey)
            ?? nextBackend.createSceneVariantPipeline(draw.pass, material.variant.pipelineKey, shader.code, undefined, !!material.resolvedSurface?.backNodeId);
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
          frameUniforms.push({ buffer: frameUniform, draw });
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
              ...(rasterLights ? { analyticLights: rasterLights } : {}),
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
      device.queue.writeBuffer(resolveUniform, 0, new Float32Array([currentExposure, tonemapIndex(currentTonemap)]));
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      let volumePipeline: GPURenderPipeline | undefined;
      const volumeEntries: GPUBindGroupEntry[] = [];
      if ([...resources.materials.values()].some(material => material.volumeIr)) {
        const volumeScene = loaded.compiled?.pathTrace ?? await buildCachedPathTraceScene(resources, {
          lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor,
          frameCamera: { viewProj: cameraViewProj, eye: cameraEye, exposure },
          environment: frame.environment, settings: pathTraceSettings(loaded.scene),
        });
        const [compiled] = await compileShaderBatch(device, [{
          label: 'Raster volume',
          code: () => rasterVolumeWgsl(volumeScene.volumeData !== undefined, rasterLights !== undefined),
        }]);
        if (!compiled) throw new Error('Raster volume shader compilation produced no result.');
        rasterErrors = compiled.errors;
        this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
        if (rasterErrors.length) throw new Error(`WGSL volume raster: ${rasterErrors.length} erreur(s).`);
        volumePipeline = await device.createRenderPipelineAsync({
          layout: 'auto', vertex: { module: compiled.module, entryPoint: 'vs' },
          fragment: { module: compiled.module, entryPoint: 'fs', targets: [{ format: backend.hdrFormat }] },
          primitive: { topology: 'triangle-list' },
        });
        const storage: Array<[number, Float32Array | Uint32Array]> = [
          [1,volumeScene.nodes],[2,volumeScene.triangles],[3,volumeScene.triangleOrder],[4,volumeScene.materials],
        ];
        if (volumeScene.volumeData) storage.push([10,volumeScene.volumeData]);
        for (const [binding,data] of storage) {
          assertSceneStorageSize(device,Math.max(data.byteLength,4),'raster volume');
          const buffer = track(device.createBuffer({ size: Math.max(data.byteLength,4),usage: GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST }));
          device.queue.writeBuffer(buffer,0,data);
          volumeEntries.push({ binding,resource: { buffer } });
        }
        volumeUniform = track(device.createBuffer({ size: RASTER_VOLUME_UNIFORM_BYTES,usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST }));
        volumeEntries.push({ binding: 5,resource: { buffer: volumeUniform } });
        if (rasterLights) volumeEntries.push({ binding: 9,resource: { buffer: rasterLights } });
      }
      const createRasterTargets = (w: number, h: number) => {
        const hdr = device.createTexture({
          size: [w, h], format: backend.hdrFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
        });
        let depth: GPUTexture | undefined;
        let volumeHdr: GPUTexture | undefined;
        try {
          depth = device.createTexture({
            size: [w, h], format: backend.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT,
          });
          const hdrView = hdr.createView();
          let volumeView: GPUTextureView | undefined;
          let volumeBindGroup: GPUBindGroup | undefined;
          if (volumePipeline) {
            volumeHdr = device.createTexture({ size: [w,h],format: backend.hdrFormat,
              usage: GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING });
            volumeView = volumeHdr.createView();
            volumeBindGroup = device.createBindGroup({ layout: volumePipeline.getBindGroupLayout(0),
              entries: [{ binding: 0,resource: hdrView },...volumeEntries] });
          }
          const resolveBindGroup = device.createBindGroup({
            layout: resolvePipeline.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: volumeView ?? hdrView }, { binding: 1, resource: sampler },
              { binding: 2, resource: { buffer: resolveUniform } },
            ],
          });
          const depthView = depth.createView();
          const depthTexture = depth;
          const volumeTexture = volumeHdr;
          return { hdrView, depthView, resolveBindGroup, volumeView, volumeBindGroup,
            destroy: () => { hdr.destroy(); depthTexture.destroy(); volumeTexture?.destroy(); } };
        } catch (error) {
          hdr.destroy();
          depth?.destroy();
          volumeHdr?.destroy();
          throw error;
        }
      };
      let targets = createRasterTargets(width, height);
      trash.push({ destroy: () => targets.destroy() });

      // Optional raster environment background: a fullscreen pass that samples the
      // equirect dome texture along each pixel's world ray, cleared behind geometry.
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
        envBgPipeline = await device.createRenderPipelineAsync({
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
        if (frame.environment.enabled !== false && envBgPipeline && envBgBindGroup) {
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
            backend.recordScenePass(encoder, { pass, hdrView, depthView, draws, clear: first, clearColor: rasterBackground(), scissor });
            first = false;
          }
          if (y + bandRows < height) {
            device.queue.submit([encoder.finish()]);
            encoder = device.createCommandEncoder();
          }
        }
        if (first) {
          const bg = rasterBackground();
          const clear = encoder.beginRenderPass({ colorAttachments: [{ view: hdrView,
            clearValue: { r:bg[0],g:bg[1],b:bg[2],a:1 },loadOp:'clear',storeOp:'store' }] });
          clear.end();
        }
        if (volumePipeline && targets.volumeView && targets.volumeBindGroup && volumeUniform) {
          device.queue.writeBuffer(volumeUniform,112,new Float32Array([...rasterBackground(),0,width,height,64,(frame.analyticLights?.length ?? 0)/28]));
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: targets.volumeView,loadOp:'clear',storeOp:'store' }] });
          pass.setPipeline(volumePipeline);
          pass.setBindGroup(0,targets.volumeBindGroup);
          pass.draw(3);
          pass.end();
        }
        device.queue.writeBuffer(resolveUniform, 0, new Float32Array([currentExposure, tonemapIndex(currentTonemap)]));
        resolveBackend.recordResolvePass(encoder, { outputView: targetView, bindGroup: resolveBindGroup });
        device.queue.submit([encoder.finish()]);
      };
      return {
        render: renderRaster,
        resize: (w: number, h: number) => {
          const next = createRasterTargets(w, h);
          targets.destroy();
          targets = next;
        },
        setQuality: buildRasterQuality,
      };
    };
    let raster: Awaited<ReturnType<typeof buildRaster>> | undefined;
    let rasterBuild: Promise<void> | undefined;
    const ensureRaster = (): Promise<void> => {
      if (!rasterBuild) {
        rasterBuild = buildRaster().then(built => {
          if (disposed) throw new Error('Viewer disposed during raster preparation.');
          raster = built;
          applyCamera(cameraViewProj, cameraEye, backgroundInvViewProj);
          this.#rasterDirty = true;
        });
      }
      return rasterBuild;
    };
    const clearOutput = (targetView: GPUTextureView): void => {
      const color = rasterBackground();
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [{ view: targetView, clearValue: { r: color[0], g: color[1], b: color[2], a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      });
      pass.end();
      device.queue.submit([encoder.finish()]);
    };

    // --- path tracer (built on first use: its pipeline costs ~230 MB of driver memory on mobile) ---
    const buildPathTracer = async (ptTrash: Array<{ destroy(): void }>) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (disposed) throw new Error('Viewer disposed during path tracer preparation.');
      const pathTraceBuildStarted = performance.now();
      const ptOptions = {
        lights: loaded.lights,
        surfaceFor: loaded.mtlx.surfaceFor,
        frameCamera: { viewProj: cameraViewProj, eye: cameraEye, exposure },
        environment: frame.environment,
        settings: pathTraceSettings(loaded.scene),
      };
      const ptScene: PathTraceScene = loaded.compiled
        ? {
          ...loaded.compiled.pathTrace,
          camera: { ...loaded.compiled.pathTrace.camera, ...ptOptions.frameCamera, invViewProj: inverse4(cameraViewProj) },
          environment: frame.environment,
        }
        : await buildCachedPathTraceScene(resources, ptOptions);
      performance.measure('pathtracing:scene-build', {
        start: pathTraceBuildStarted,
        end: performance.now(),
        detail: { triangles: ptScene.triangleCount, nodes: ptScene.nodeCount },
      });
      ptScene.environment.textureRadianceScale = envRadianceScale;
      ptScene.camera.backgroundInvViewProj = backgroundInvViewProj;
      pathTraceScene = ptScene;
      const sourceDispatch = loaded.compiled?.dispatch ?? buildMaterialDispatch(ptScene.variantSources);
      const sourceBindings = await buildPtDeviceBindings(sourceDispatch, ptScene, loaded.mtlx.imageProvider, { sink });
      const { dispatch, bindings } = packPtTextureArrays(sourceDispatch, sourceBindings, device.limits.maxTextureArrayLayers);
      const storageSlots = bindings.group0.filter(slot => slot.usage === 'storage').length;
      if (storageSlots > device.limits.maxStorageBuffersPerShaderStage) {
        throw new Error(`Path tracing requires ${storageSlots} storage buffers; this GPU supports ${device.limits.maxStorageBuffersPerShaderStage}.`);
      }
      for (const slot of bindings.group0) {
        if (slot.usage === 'storage' && slot.data) {
          assertSceneStorageSize(device, Math.max(slot.data.byteLength, 4), slot.role);
        }
      }
      const track = <T extends { destroy(): void }>(o: T): T => {
        ptTrash.push(o);
        return o;
      };
      // Mobile drivers reserve per-thread stack for the by-value lobe array: size it to the scene.
      assertSceneTextureBindings(device, dispatch.textures.length + (envAsset ? 1 : 0), dispatch.samplers.length + (envAsset ? 1 : 0));
      const maxLobes = Math.min(
        PT_MAX_LOBES,
        Math.max(
          ...dispatch.variants.map((variant) => variant.lobeCount),
          maxRecordLobes(ptScene.materials, new Set(dispatch.variants.map((variant) => variant.index))),
        ),
      );
      const [ptCompilation, displayCompilation, convergenceCompilation] = await compileShaderBatch(device, [
        {
          label: 'Path tracing',
          code: () => pathTraceComputeWgsl({
            volumeGrid: ptScene.volumeData !== undefined,
            dispatch, environment: loaded.environment !== undefined, maxLobes, displayAovs: true,
            closureDispatch: pathTraceClosureDispatch(dispatch, ptScene.materials),
            opaque: pathTraceOpaqueScene(dispatch, ptScene.materials),
            analyticLights: ptScene.analyticLights !== undefined,
            pruneUnusedFunctions: true,
            rouletteDepth: ptOptions.settings.rouletteDepth,
          }),
        },
        {
          label: 'Path tracing display',
          code: () => pathTraceDisplayWgsl(envAsset !== undefined, true, true),
        },
        {
          label: 'Path tracing convergence',
          code: pathTraceConvergenceWgsl,
        },
      ]);
      pathTraceErrors = [...ptCompilation!.errors, ...displayCompilation!.errors, ...convergenceCompilation!.errors];
      if (pathTraceErrors.length > 0) {
        this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
        throw new Error(`WGSL: ${pathTraceErrors.length} erreur(s) de compilation (path tracing).`);
      }
      const ptParameterData = (): ArrayBuffer => packParameterUniforms(dispatch.uniforms, field => {
        const index = /^m(\d+)_/.exec(field.field)?.[1];
        const key = index === undefined ? undefined : ptScene.materialKeys[Number(index)];
        const parameter = key ? resources.materials.get(key)?.parameters?.find(parameter => parameter.uniform === field.name) : undefined;
        if (!parameter) throw new Error(`Missing path-tracing parameter: ${field.field}`);
        return parameter.value;
      });
      const ptBackend = new PathTraceBackend(device, { dispatch, ...(envAsset ? { environment: true } : {}) });
      if (disposed) throw new Error('Viewer disposed during path tracer compilation.');
      const [ptPipelineResult, ptDisplayPipeline, ptConvergencePipeline] = await Promise.all([
        ptBackend.createPipelineAsync(ptCompilation!.module),
        device.createRenderPipelineAsync({
          layout: 'auto',
          vertex: { module: displayCompilation!.module, entryPoint: 'vs' },
          fragment: { module: displayCompilation!.module, entryPoint: 'fs', targets: [{ format: outputFormat }] },
          primitive: { topology: 'triangle-list' },
        }),
        device.createComputePipelineAsync({
          layout: 'auto',
          compute: { module: convergenceCompilation!.module, entryPoint: 'mx_path_trace_convergence' },
        }),
      ]);
      const ptPipeline = ptPipelineResult.pipeline;
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
      let aovStorageEnabled = pathTraceViewStoresAov(this.#pathTracingView);
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

      const accumulation = (w: number, h: number, view: PathTraceView): GPUBuffer => {
        const size = w * h * pathTraceStorageBytesPerPixel(view);
        assertSceneStorageSize(device, size);
        return device.createBuffer({
          size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
        });
      };
      let accumBuffer = accumulation(width, height, this.#pathTracingView);
      ptTrash.push({ destroy: () => accumBuffer.destroy() });
      const convergenceBuffer = track(device.createBuffer({
        size: PT_CONVERGENCE_COLUMNS * PT_CONVERGENCE_ROWS * PT_CONVERGENCE_ZONE_BYTES,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      }));
      const convergenceReadback = track(device.createBuffer({
        size: PT_CONVERGENCE_COLUMNS * PT_CONVERGENCE_ROWS * PT_CONVERGENCE_ZONE_BYTES,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      }));
      const convergenceUniform = track(device.createBuffer({
        size: PT_CONVERGENCE_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      }));
      const convergenceBindGroup = (accum: GPUBuffer): GPUBindGroup => device.createBindGroup({
        layout: ptConvergencePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: accum } },
          { binding: 1, resource: { buffer: convergenceUniform } },
          { binding: 2, resource: { buffer: convergenceBuffer } },
        ],
      });
      let ptConvergenceBindGroup = convergenceBindGroup(accumBuffer);
      let previewBuffer = accumulation(Math.ceil(width / 2), Math.ceil(height / 2), this.#pathTracingView);
      ptTrash.push({ destroy: () => previewBuffer.destroy() });
      const ptUniform = track(device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const ptUniforms = [ptUniform, ...Array.from({ length: PATH_TRACE_MAX_TILES_PER_REFRESH - 1 }, () =>
        track(device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })))];

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
      const computeGroups = (accum: GPUBuffer): GPUBindGroup[] => ptUniforms.map(uniform =>
        device.createBindGroup({
          layout: ptPipeline.getBindGroupLayout(0),
          entries: group0Entries.map(entry => {
            const role = bindings.group0.find(slot => slot.binding === entry.binding)?.role;
            return role === 'uniform' ? { ...entry, resource: { buffer: uniform } }
              : role === 'accum' ? { ...entry, resource: { buffer: accum } } : entry;
          }),
        }));
      let ptComputeGroups = computeGroups(accumBuffer);

      const textureViews = new Map<number, GPUTextureView>();
      for (const tex of bindings.textures) {
        const image = bindings.images[tex.imageIndex];
        const gpuTex = track(tex.arrayImages
          ? uploadMaterialImageArray(device, tex.arrayImages.map(index => bindings.images[index]), tex.format, tex.textureKind === 'index-array')
          : uploadMaterialImage(device, image, tex.format, tex.textureKind));
        textureViews.set(tex.binding, gpuTex.createView(tex.arrayImages || tex.textureKind === 'udim' ? { dimension: '2d-array' } : {}));
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
      let convergenceBusy = false;
      let convergenceRevision = 0;
      let lastConvergenceSample = 0;
      let convergenceRefreshPending = false;
      let convergenceTarget = this.#pathTracingLimits.targetRelativeError;
      let convergenceStatus: PathTraceConvergence | undefined;
      let convergenceError: string | undefined;
      const stopping = new PathTraceStopping(this.#pathTracingLimits);
      let timedBatch = false;
      const invalidateConvergence = (): void => {
        convergenceRevision++;
        lastConvergenceSample = 0;
        convergenceStatus = undefined;
        convergenceError = undefined;
      };
      const invalidateDenoise = (): void => {
        denoiserRevision++;
        neuralReady = false;
        lastDenoisedSample = 0;
        denoiserStatus = { state: 'waiting' };
        if (denoiserBusy) this.#jsDenoiser.abort();
      };
      const resetPathTrace = (): void => {
        stopping.reset();
        timedBatch = false;
        invalidateDenoise();
        invalidateConvergence();
        ptBackend.resetAccumulation();
        resetPending = true;
        needsPreview = true;
        previewWidth = 0;
        previewHeight = 0;
      };
      const readConvergence = async (
        revision: number, samples: number, columns: number, rows: number,
      ): Promise<void> => {
        convergenceBusy = true;
        let mapped = false;
        try {
          await convergenceReadback.mapAsync(GPUMapMode.READ);
          mapped = true;
          const values = new Float32Array(convergenceReadback.getMappedRange().slice(0));
          convergenceReadback.unmap();
          mapped = false;
          if (disposed || revision !== convergenceRevision) return;
          convergenceStatus = {
            columns, rows, samples, targetRelativeError: this.#pathTracingLimits.targetRelativeError,
            zones: Array.from({ length: columns * rows }, (_, index) => ({
              relativeError: values[index * 4]!,
              maximumRelativeError: values[index * 4 + 1]!,
              convergedFraction: values[index * 4 + 2]!,
              validFraction: values[index * 4 + 3]!,
            })),
          };
          convergenceError = undefined;
          stopping.observe(convergenceStatus);
        } catch (error) {
          if (!disposed && revision === convergenceRevision) {
            stopping.observe(undefined);
            convergenceError = error instanceof Error ? error.message : String(error);
            console.error('Path-tracing convergence readback failed:', error);
          }
        } finally {
          if (mapped) convergenceReadback.unmap();
          convergenceBusy = false;
          if (!disposed) {
            if (convergenceRefreshPending) this.#ptDisplayDirty = true;
            this.#emitStatus();
          }
        }
      };
      const resizePathTrace = (w: number, h: number): void => {
        const nextAccum = accumulation(w, h, this.#pathTracingView);
        let nextPreview: GPUBuffer | undefined;
        let nextNeural: GPUTexture | undefined;
        try {
          nextPreview = accumulation(Math.ceil(w / 2), Math.ceil(h / 2), this.#pathTracingView);
          nextNeural = neuralTarget(w, h);
          const nextComputeGroups = computeGroups(nextAccum);
          const nextDisplay = displayGroup(nextAccum, nextPreview, nextNeural);
          const nextConvergence = convergenceBindGroup(nextAccum);
          accumBuffer.destroy();
          previewBuffer.destroy();
          neuralTexture.destroy();
          accumBuffer = nextAccum;
          previewBuffer = nextPreview;
          neuralTexture = nextNeural;
          ptComputeGroups = nextComputeGroups;
          ptDisplayBindGroup = nextDisplay;
          ptConvergenceBindGroup = nextConvergence;
          aovStorageEnabled = pathTraceViewStoresAov(this.#pathTracingView);
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
      const renderPathTrace = (
        targetView: GPUTextureView | undefined, tiled: boolean, accumulate: boolean, captureTiles?: number,
      ): void => {
        const capturing = captureTiles !== undefined;
        const nextAovStorageEnabled = pathTraceViewStoresAov(this.#pathTracingView);
        if (nextAovStorageEnabled !== aovStorageEnabled) {
          const nextAccum = accumulation(width, height, this.#pathTracingView);
          let nextPreview: GPUBuffer | undefined;
          try {
            nextPreview = accumulation(Math.ceil(width / 2), Math.ceil(height / 2), this.#pathTracingView);
            const nextComputeGroups = computeGroups(nextAccum);
            const nextDisplay = displayGroup(nextAccum, nextPreview, neuralTexture);
            const nextConvergence = convergenceBindGroup(nextAccum);
            if (!nextAovStorageEnabled && !resetPending) {
              const copy = device.createCommandEncoder();
              copy.copyBufferToBuffer(accumBuffer, 0, nextAccum, 0, ptWidth * ptHeight * PT_DISPLAY_PIXEL_BYTES);
              if (previewWidth > 0 && previewHeight > 0) {
                copy.copyBufferToBuffer(
                  previewBuffer, 0, nextPreview, 0, previewWidth * previewHeight * PT_DISPLAY_PIXEL_BYTES,
                );
              }
              device.queue.submit([copy.finish()]);
            }
            accumBuffer.destroy();
            previewBuffer.destroy();
            accumBuffer = nextAccum;
            previewBuffer = nextPreview;
            ptComputeGroups = nextComputeGroups;
            ptDisplayBindGroup = nextDisplay;
            ptConvergenceBindGroup = nextConvergence;
            aovStorageEnabled = nextAovStorageEnabled;
          } catch (error) {
            nextAccum.destroy();
            nextPreview?.destroy();
            throw error;
          }
        }
        const encoder = device.createCommandEncoder();
        tiled = tiled && (capturing || !needsPreview);
        const nextPixelScale = accumulate ? (tiled ? 1 : interactiveScale) : pixelScale;
        if (resetPending) {
          encoder.clearBuffer(accumBuffer);
          resetPending = false;
        } else if (pixelScale > 1 && nextPixelScale === 1) {
          // Preserve this camera's complete preview until each full-resolution tile arrives.
          encoder.copyBufferToBuffer(accumBuffer, 0, previewBuffer, 0,
            ptWidth * ptHeight * pathTraceStorageBytesPerPixel(this.#pathTracingView));
          previewWidth = ptWidth;
          previewHeight = ptHeight;
        }
        if (pixelScale !== nextPixelScale) {
          pixelScale = nextPixelScale;
          ptWidth = Math.max(1, Math.ceil(width / pixelScale));
          ptHeight = Math.max(1, Math.ceil(height / pixelScale));
          ptBackend.resetAccumulation();
          invalidateConvergence();
          encoder.clearBuffer(accumBuffer);
        }
        const info = new ArrayBuffer(PT_DISPLAY_INFO_BYTES);
        const floats = new Float32Array(info);
        const ints = new Uint32Array(info);
        ints.set([ptWidth, ptHeight], 0);
        floats[2] = currentExposure;
        ints[3] = this.#pathTracingDenoise && neuralReady ? 1 : 0;
        ints.set([previewWidth, previewHeight, width, height], 4);
        floats.set(backgroundInvViewProj, 8);
        floats.set([...cameraEye, pathTraceViewIndex(this.#pathTracingView)], 24);
        const tint = envAsset?.tint ?? [1, 1, 1];
        floats.set(tint.map((v) => frame.environment.enabled === false ? 0 : v * (envAsset?.intensity ?? 1) * envRadianceScale), 28);
        floats[31] = this.#pathTracingDenoiserComparison && neuralReady ? 0.5 : 0;
        floats.set([...rasterBackground(), tonemapIndex(currentTonemap)], 32);
        device.queue.writeBuffer(ptInfo, 0, info);
        lastPreview = accumulate && !tiled;
        timedBatch = accumulate && pixelScale === 1;
        if (accumulate) {
          needsPreview = false;
          const tileCount = captureTiles ?? (tiled ? Math.min(PATH_TRACE_MAX_TILES_PER_REFRESH, Math.max(
            PATH_TRACE_TILES_PER_REFRESH,
            Math.ceil(pathTraceTileCount(ptWidth, ptHeight) / PATH_TRACE_TILES_PER_REFRESH),
          )) : 1);
          for (let i = 0; i < tileCount; i++) {
            const { tile, frameIndex } = tiled
              ? ptBackend.advanceTile(ptWidth, ptHeight)
              : { tile: { x: 0, y: 0, width: ptWidth, height: ptHeight }, frameIndex: ptBackend.advanceFrame() };
            if (tile.width === 0 || tile.height === 0) continue;
            const [wgX, wgY] = PathTraceBackend.workgroupCount(tile.width, tile.height);
            // Separate uniforms let watchdog-sized tile dispatches share a submission.
            device.queue.writeBuffer(ptUniforms[i]!, 0,
              buildPathTraceUniform(ptScene, frameIndex, 1, ptWidth, ptHeight, 0, tile, pathTracingDepth,
                !capturing && this.#pathTracingAdaptive && tiled, this.#pathTracingView, this.#pathTracingLimits.targetRelativeError));
            const compute = encoder.beginComputePass();
            compute.setPipeline(ptPipeline);
            compute.setBindGroup(0, ptComputeGroups[i]!);
            if (group1) compute.setBindGroup(1, group1);
            if (group2) compute.setBindGroup(2, group2);
            if (ptEnvGroup) compute.setBindGroup(3, ptEnvGroup);
            compute.dispatchWorkgroups(wgX, wgY, 1);
            compute.end();
          }
        }
        let convergenceRequest: { revision: number; samples: number; columns: number; rows: number } | undefined;
        const samples = ptBackend.frameIndex;
        if (!capturing && pixelScale === 1 && samples >= PT_CONVERGENCE_MIN_SAMPLES && !convergenceBusy
          && (convergenceRefreshPending || (accumulate
            && samples >= lastConvergenceSample + PT_CONVERGENCE_MIN_SAMPLES))) {
          const columns = Math.min(PT_CONVERGENCE_COLUMNS, ptWidth);
          const rows = Math.min(PT_CONVERGENCE_ROWS, ptHeight);
          const settings = new ArrayBuffer(PT_CONVERGENCE_UNIFORM_BYTES);
          const settingInts = new Uint32Array(settings);
          settingInts.set([ptWidth, ptHeight, columns, rows], 0);
          settingInts[5] = PT_CONVERGENCE_MIN_SAMPLES;
          new Float32Array(settings)[4] = this.#pathTracingLimits.targetRelativeError;
          device.queue.writeBuffer(convergenceUniform, 0, settings);
          const convergencePass = encoder.beginComputePass();
          convergencePass.setPipeline(ptConvergencePipeline);
          convergencePass.setBindGroup(0, ptConvergenceBindGroup);
          convergencePass.dispatchWorkgroups(columns, rows, 1);
          convergencePass.end();
          encoder.copyBufferToBuffer(
            convergenceBuffer, 0, convergenceReadback, 0,
            columns * rows * PT_CONVERGENCE_ZONE_BYTES,
          );
          lastConvergenceSample = samples;
          convergenceRefreshPending = false;
          convergenceRequest = { revision: convergenceRevision, samples, columns, rows };
        }
        if (targetView) {
          const renderPass = encoder.beginRenderPass({
            colorAttachments: [{ view: targetView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
          });
          renderPass.setPipeline(ptDisplayPipeline);
          renderPass.setBindGroup(0, ptDisplayBindGroup);
          renderPass.draw(3);
          renderPass.end();
        }
        device.queue.submit([encoder.finish()]);
        if (convergenceRequest) void readConvergence(
          convergenceRequest.revision,
          convergenceRequest.samples,
          convergenceRequest.columns,
          convergenceRequest.rows,
        );
        if (!capturing && this.#pathTracingView === 'beauty' && this.#pathTracingDenoise && !denoiserBusy && !this.#jsDenoiser.busy && denoiserStatus.state !== 'error'
          && pixelScale === 1 && samples >= 1 && (lastDenoisedSample === 0 || samples >= lastDenoisedSample + 8)) {
          void runDenoise(info, samples);
        }
      };
      const readPathTracingAov = async (view: Exclude<PathTraceView, 'beauty'>): Promise<PathTraceAovData> => {
        if (disposed || this.#pathTracingView !== view) {
          throw new Error('The selected path-tracing AOV changed before export.');
        }
        if (ptBackend.frameIndex < 1) throw new Error('The path tracer has not accumulated any samples.');
        const exportWidth = ptWidth;
        const exportHeight = ptHeight;
        const pixelCount = exportWidth * exportHeight;
        const variance = view === 'variance';
        const channels = variance ? 1 : 3;
        const source = accumBuffer;
        const sourceOffset = 0;
        const byteLength = variance ? pixelCount * PT_DISPLAY_PIXEL_BYTES
          : pixelCount * (PT_DISPLAY_PIXEL_BYTES + PT_SURFACE_AOV_PIXEL_BYTES);
        const readback = device.createBuffer({
          size: byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        let mapped = false;
        try {
          const encoder = device.createCommandEncoder();
          encoder.copyBufferToBuffer(source, sourceOffset, readback, 0, byteLength);
          device.queue.submit([encoder.finish()]);
          await readback.mapAsync(GPUMapMode.READ);
          mapped = true;
          if (disposed || this.#pathTracingView !== view) {
            throw new Error('The selected path-tracing AOV changed during export.');
          }
          const sourceValues = new Float32Array(readback.getMappedRange().slice(0));
          const values = new Float32Array(pixelCount * channels);
          for (let pixel = 0; pixel < pixelCount; pixel++) {
            if (variance) {
              const index = pixel * 8;
              const count = sourceValues[index + 3]!;
              values[pixel] = count < 2 ? Number.NaN : Math.max(0, sourceValues[index + 5]!) / (count - 1);
            } else {
              const sampleCount = sourceValues[pixel * 8 + 3]!;
              const sourceIndex = pixelCount * 8 + pixel * 4;
              const destinationIndex = pixel * 3;
              const coverage = sourceValues[sourceIndex + 3]!;
              if (sampleCount === 0) {
                values.fill(Number.NaN, destinationIndex, destinationIndex + 3);
                continue;
              }
              const divisor = view === 'emission' ? 1 : coverage;
              if (coverage === 0 && view !== 'emission') {
                values.fill(0, destinationIndex, destinationIndex + 3);
              } else {
                for (let channel = 0; channel < 3; channel++) {
                  values[destinationIndex + channel] = sourceValues[sourceIndex + channel]! / divisor;
                }
              }
            }
          }
          return { width: exportWidth, height: exportHeight, channels, values };
        } finally {
          if (mapped) readback.unmap();
          readback.destroy();
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
          new Float32Array(data)[27] = 0;
          new Float32Array(data)[31] = 0;
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
            this.#clearDenoiserComparison();
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
        if (timedBatch) {
          stopping.recordBatch(milliseconds);
          timedBatch = false;
        }
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
        pathTraceConvergence: (): PathTraceConvergence | undefined => convergenceStatus,
        pathTraceConvergenceError: (): string | undefined => convergenceError,
        readPathTracingAov,
        pathTraceProgress: (): PathTraceProgress => stopping.progress,
        setPathTracingLimits: (limits: PathTraceRenderLimits): void => {
          stopping.configure(limits);
          if (limits.targetRelativeError !== convergenceTarget) {
            convergenceTarget = limits.targetRelativeError;
            invalidateConvergence();
            convergenceRefreshPending = true;
          }
        },
        resize: resizePathTrace, frameCount: () => ptBackend.frameIndex,
      };
    };

    let disneyState: PathTracerState = 'idle';
    let disneyBackend: DisneyGpuBackend | undefined;
    let disneyBuildRevision = 0;
    let disneyFrameIndex = 0;
    let disneySeedFrame = 1;
    let disneyTileIndex = 0;
    let disneyErrorReadback = false;
    let disneyErrors: ShaderCompilationError[] = [];
    let disneySceneData: ReturnType<typeof prepareDisneyScene> | undefined;
    let disneyLightCount = 0;
    let disneyEnvironmentTotal = 0;
    let disneyEnvironmentRotationValue = 0;
    let disneyHasEnvironment = false;

    const resetDisneyPathTrace = (): void => {
      disneyFrameIndex = 0;
      disneySeedFrame = 1;
      disneyTileIndex = 0;
      disneyBackend?.reset();
    };

    const setDisneyError = (error: unknown, shader: string): void => {
      if (disposed) return;
      disneyState = 'error';
      const message = error instanceof Error ? error.message : String(error);
      disneyErrors = [{ shader, message, line: 0, column: 0, source: '' }];
      this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors, ...disneyErrors]);
      console.error(`Disney path tracer: ${message}`);
      this.#ptDisplayDirty = true;
      this.#emitStatus();
    };

    const startDisneyTracer = (): void => {
      if (disneyState !== 'idle') return;
      disneyState = 'compiling';
      this.#emitStatus();
      const revision = ++disneyBuildRevision;
      void (async () => {
        await new Promise(resolve => setTimeout(resolve, 0));
        if (disposed || revision !== disneyBuildRevision) return;
        const proxyPaths = new Set(loaded.lights.map(light => `${light.path}_Geometry`));
        const disneyResources = {
          ...resources,
          instances: resources.instances.filter(instance =>
            instance.hasGeometry && !proxyPaths.has(instance.primPath)),
        };
        const scene = prepareDisneyScene(loaded.scene, disneyResources);
        for (const warning of scene.warnings) {
          sink({ level: 'warning', message: warning.message, detail: warning.materialKey });
        }
        const lightData = packDisneyLights(loaded.lights);
        let environment: { width: number; height: number; data: Float32Array } | undefined;
        if (envAsset) {
          const data = new Float32Array(envAsset.image.data.length);
          for (let i = 0; i < data.length; i++) {
            const value = Math.fround(envAsset.image.data[i]! * envAsset.tint[i % 3]! * envAsset.intensity);
            if (!Number.isFinite(value)) throw new Error(`Disney environment exceeds float32 range at pixel ${Math.floor(i / 3)}.`);
            data[i] = value;
          }
          environment = { width: envAsset.image.width, height: envAsset.image.height, data };
        }
        const environmentTotal = environment ? buildDisneyEnvironmentCdf(environment).totalSum : 0;
        const environmentRotation = environment ? disneyEnvironmentRotation(loaded.lights) : 0;
        const backend = await DisneyGpuBackend.create(device, scene, {
          width, height, textureSize: DISNEY_TEXTURE_SIZE, imageProvider: loaded.mtlx.imageProvider,
          outputFormat, lights: lightData.data, specialization: { ...DISNEY_STATIC_PATH_OPTIONS, lightCount: lightData.count },
          ...(environment ? { environment } : {}),
        });
        if (disposed || revision !== disneyBuildRevision) {
          backend.dispose();
          return;
        }
        disneyBackend = backend;
        disneySceneData = scene;
        disneyLightCount = lightData.count;
        disneyEnvironmentTotal = environmentTotal;
        disneyEnvironmentRotationValue = environmentRotation;
        disneyHasEnvironment = environment !== undefined;
        trash.push({ destroy: () => backend.dispose() });
        disneyState = 'ready';
        this.#ptDisplayDirty = true;
        this.#emitStatus();
      })().catch(error => {
        if (revision === disneyBuildRevision) setDisneyError(error, 'Disney path tracing - preparation / pipeline');
      });
    };

    const renderDisney = (targetView: GPUTextureView, accumulate: boolean): void => {
      if (disneyState === 'idle') startDisneyTracer();
      const backend = disneyBackend;
      if (!backend || disneyState !== 'ready') {
        clearOutput(targetView);
        return;
      }
      if (!accumulate) {
        try {
          backend.display(targetView, [width, height], currentExposure, currentTonemap);
        } catch (error) {
          setDisneyError(error, 'Disney path tracing - display');
        }
        return;
      }
      try {
        for (let i = 0; i < DISNEY_TILES_PER_FRAME; i++) {
          renderDisneyTile(backend, targetView, i === DISNEY_TILES_PER_FRAME - 1);
        }
        if (!disneyErrorReadback) {
          disneyErrorReadback = true;
          void backend.readError().then(error => {
            if (error !== 0 && backend === disneyBackend) {
              setDisneyError(new Error(`GPU render status ${error}.`), 'Disney path tracing - dispatch');
            }
          }).catch(error => {
            if (backend === disneyBackend) setDisneyError(error, 'Disney path tracing - status readback');
          }).finally(() => {
            if (backend === disneyBackend) disneyErrorReadback = false;
          });
        }
        this.#ptDisplayDirty = false;
        this.#emitStatus();
      } catch (error) {
        setDisneyError(error, 'Disney path tracing - dispatch');
      }
    };

    const renderDisneyTile = (backend: DisneyGpuBackend, targetView: GPUTextureView, display: boolean): void => {
      const tile = disneyTileForIndex(disneyTileIndex, [width, height]);
      const scene = disneySceneData;
      if (!scene) throw new Error('Disney scene preparation did not produce render data.');
      if (disneySeedFrame > 0xffffffff) throw new Error('Disney source frame counter overflow.');
      const settings: DisneyRenderSettings = {
        resolution: [width, height], ...tile, frame: disneySeedFrame,
        root: scene.geometry.topLevelIndex,
        camera: disneyCamera(this.#orbit),
        lightCount: disneyLightCount, maxDepth: pathTracingDepth, ...DISNEY_STATIC_PATH_OPTIONS,
        environment: disneyHasEnvironment && frame.environment.enabled !== false,
        mollificationAmount: 0,
        environmentTotal: disneyEnvironmentTotal, environmentRotation: disneyEnvironmentRotationValue,
        environmentIntensity: 1, uniformColor: [0, 0, 0],
      };
      backend.renderTile(settings, display ? targetView : undefined, currentExposure, currentTonemap);
      disneySeedFrame++;
      disneyTileIndex++;
      if (disneyTileIndex === tile.tileCount) {
        disneyTileIndex = 0;
        disneyFrameIndex++;
      }
    };

    let ptState: PathTracerState = 'idle';
    let pathTracer: Awaited<ReturnType<typeof buildPathTracer>> | undefined;
    let pathTraceBuild: Promise<void> | undefined;
    let pathTraceBuildError: unknown;
    const startPathTracer = (): Promise<void> => {
      if (pathTraceBuild) return pathTraceBuild;
      ptState = 'compiling';
      const ptTrash: Array<{ destroy(): void }> = [];
      pathTraceBuild = buildPathTracer(ptTrash).then((built) => {
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
        pathTraceBuildError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!pathTraceErrors.length) {
          pathTraceErrors = [{ shader: 'Path tracing - preparation / pipeline', message, line: 0, column: 0, source: '' }];
          this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
        }
        console.error(`Path tracer: ${message}`);
        this.#emitStatus();
      });
      return pathTraceBuild;
    };

    const capturePathTrace = async (targetView: GPUTextureView, samples: number): Promise<void> => {
      await startPathTracer();
      if (disposed) throw new Error('Viewer disposed during capture.');
      if (!pathTracer) throw pathTraceBuildError ?? new Error('Path tracer preparation failed.');
      const { renderPathTrace, resetPathTrace } = pathTracer;
      resetPathTrace();
      let remaining = samples * pathTraceTileCount(width, height);
      while (remaining > 0) {
        const tiles = Math.min(remaining, PATH_TRACE_MAX_TILES_PER_REFRESH);
        await withGpuValidation(device, () => renderPathTrace(undefined, true, true, tiles));
        await device.queue.onSubmittedWorkDone();
        if (disposed) throw new Error('Viewer disposed during capture.');
        remaining -= tiles;
      }
      await withGpuValidation(device, () => renderPathTrace(targetView, true, false, 0));
    };

    const applyCamera = (viewProj: readonly number[], eye: Vec3, backgroundInverse: readonly number[]): void => {
      cameraViewProj = viewProj;
      cameraEye = eye;
      backgroundInvViewProj = backgroundInverse;
      const viewProjArray = new Float32Array(viewProj);
      const eyeArray = new Float32Array([eye[0], eye[1], eye[2], 0]);
      for (const { buffer: buf } of frameUniforms) {
        device.queue.writeBuffer(buf, 16 * 4, viewProjArray);
        device.queue.writeBuffer(buf, 32 * 4, eyeArray);
      }
      const invViewProj = inverse4(viewProj);
      if (volumeUniform) {
        device.queue.writeBuffer(volumeUniform,0,new Float32Array(invViewProj));
        device.queue.writeBuffer(volumeUniform,64,eyeArray);
        device.queue.writeBuffer(volumeUniform,80,new Float32Array([
          -frame.light.direction[0],-frame.light.direction[1],-frame.light.direction[2],0,
          ...frame.light.color.map(c => c*frame.light.intensity),0]));
      }
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

    if (this.#backend === 'raster') await ensureRaster();

    return {
      setEnvironmentEnabled: (enabled) => {
        frame.environment.enabled = enabled;
        if (pathTraceScene) pathTraceScene.environment.enabled = enabled;
        for (const { buffer, draw } of frameUniforms) {
          const data = buildSceneFrameUniform(frame, draw);
          device.queue.writeBuffer(buffer, 44 * 4, data.subarray(44));
        }
        resetDisneyPathTrace();
      },
      updateMaterial: (key, material) => {
        resources.materials.set(key, material);
        const data = materialUniformData(material);
        for (const buffer of parameterBuffers.get(key) ?? []) device.queue.writeBuffer(buffer, 0, data);
        uploadPtParameters?.();
      },
      frame,
      resize: async (w, h) => {
        pathTracer?.resize(w, h);
        raster?.resize(w, h);
        width = w;
        height = h;
        if (disneyBackend || disneyState === 'compiling') {
          disneyBuildRevision++;
          disneyBackend?.dispose();
          disneyBackend = undefined;
          disneySceneData = undefined;
          disneyErrorReadback = false;
          disneyState = 'idle';
          if (this.#backend === 'disney') startDisneyTracer();
        }
      },
      setRasterQuality: async (quality) => {
        if (this.#backend === 'raster' || raster) {
          await ensureRaster();
          if (!raster) throw new Error('Raster preparation did not produce a renderer.');
          await raster.setQuality(quality);
        }
        if (disposed) throw new Error('Viewer disposed during raster compilation.');
        rasterQuality = quality;
        applyCamera(cameraViewProj, cameraEye, backgroundInvViewProj);
      },
      pathTracingDepth: () => pathTracingDepth,
      setPathTracingDepth: (depth) => {
        if (!Number.isInteger(depth) || depth < 0 || depth > 64) {
          throw new Error('Path-tracing depth must be an integer between 0 and 64.');
        }
        if (depth === pathTracingDepth) return;
        pathTracingDepth = depth;
        pathTracer?.resetPathTrace();
        resetDisneyPathTrace();
      },
      renderRaster: targetView => {
        if (raster) raster.render(targetView);
        else {
          clearOutput(targetView);
          if (!rasterBuild) {
            void ensureRaster().catch((error: unknown) => {
              if (disposed) return;
              const message = error instanceof Error ? error.message : String(error);
              if (!rasterErrors.length) {
                rasterErrors = [{ shader: 'Raster - preparation / pipeline', message, line: 0, column: 0, source: '' }];
              }
              this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
              console.error(`Raster: ${message}`);
            });
          }
        }
      },
      renderPathTrace: (targetView, tiled, accumulate) => {
        if (pathTracer) pathTracer.renderPathTrace(targetView, tiled, accumulate);
        else {
          void startPathTracer();
          clearOutput(targetView);
        }
      },
      capturePathTrace,
      renderDisney,
      reportFrameTime: (milliseconds) => pathTracer?.reportFrameTime(milliseconds),
      invalidateDenoise: () => pathTracer?.invalidateDenoise(),
      denoiserStatus: () => pathTracer?.denoiserStatus() ?? { state: this.#pathTracingDenoise ? 'waiting' : 'off' },
      pathTraceConvergence: () => pathTracer?.pathTraceConvergence(),
      pathTraceConvergenceError: () => pathTracer?.pathTraceConvergenceError(),
      readPathTracingAov: view => {
        if (!pathTracer) throw new Error('The path tracer is not ready to export an AOV.');
        return pathTracer.readPathTracingAov(view);
      },
      pathTraceProgress: () => pathTracer?.pathTraceProgress(),
      setPathTracingLimits: limits => pathTracer?.setPathTracingLimits(limits),
      resetPathTrace: () => {
        pathTracer?.resetPathTrace();
        resetDisneyPathTrace();
      },
      setExposure: (value: number) => {
        currentExposure = value;
        pathTracer?.invalidateDenoise();
        this.#ptDisplayDirty = true;
      },
      setTonemap: async (tonemap: Tonemap) => {
        currentTonemap = tonemap;
        pathTracer?.invalidateDenoise();
        this.#ptDisplayDirty = true;
      },
      applyCamera,
      frameCount: () => this.#backend === 'disney' ? disneyFrameIndex : pathTracer?.frameCount() ?? 0,
      pathTracerState: () => this.#backend === 'disney' ? disneyState : ptState,
      dispose: () => {
        disposed = true;
        disneyBuildRevision++;
        pathTracer?.invalidateDenoise();
        pathTracer = undefined;
        for (const o of trash) o.destroy();
      },
    };
  }
}
