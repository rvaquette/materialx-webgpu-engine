// Interactive on-canvas viewer (T051/T052 live counterpart of the offscreen USD
// capture harness). Loads a USD scene through the shared asset loader (usd-scene-
// assets.ts). Each backend's resources are built on first use. Resolution
// changes replace targets, not scene data or pipelines.

import {
  buildSceneFrame,
  buildSceneFrameUniform,
  buildSceneMaterialUniform,
  directionalLightFrom,
  NEUTRAL_SURFACE,
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
import { buildGeometry, createSceneBindGroups, uploadGeometry, type SceneDrawBuffers } from './scene-resources.ts';
import { prepareMesh, type PreparedMesh } from '../geometry/prepare.ts';
import { buildEnvCdf } from '../assets/environment-cdf.ts';
import {
  buildCachedPathTraceScene, buildPathTraceScene, PT_NODE_FLOATS, PT_TRIANGLE_FLOATS, type PathTraceScene, type PathTraceTransformRange,
} from './pathtracing/scene-buffers.ts';
import { PathTraceDynamics, type DynamicInstanceSource, type DynamicUpload } from './pathtracing/dynamic-geometry.ts';
import { rebuildBvhInBackground } from './pathtracing/bvh-rebuild.ts';
import { buildPathTraceUniform, pathTraceComputeWgsl, pathTraceHasMedia, pathTraceClosureDispatch, pathTraceOpaqueScene, PathTraceBackend, pathTraceTileCount, PT_UNIFORM_SIZE } from './pathtracing/compute.ts';
import { pathTraceSettings } from './pathtracing/scene-settings.ts';
import { cameraFovY } from '../usd/cameras.ts';
import { buildMaterialDispatch, type PtMaterialVariantCache } from './pathtracing/material-variant.ts';
import { buildPtDeviceBindings, type PtBufferRole } from './pathtracing/device-bindings.ts';
import { maxRecordLobes, PT_MAX_LOBES } from './pathtracing/material-record.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
import { tonemapIndex, type Tonemap } from './output.ts';
import { loadUsdScene, meshSourceFromScene, uploadMaterialTextures, type LoadedUsdScene, type ObjectMaterialOverride, type SceneLoadOptions } from './usd-scene-assets.ts';
import { assertSceneStorageSize, assertSceneTextureBindings, assertStorageBufferCount, GpuLimitError, withGpuValidation } from '../gpu/device.ts';
import { isMobileGpu } from '../gpu/capabilities.ts';
import { GpuMemoryTracker, type GpuMemoryUsage } from '../gpu/memory.ts';
import { limitImageProvider } from '../assets/image-limits.ts';
import { bakeGraphOutput, bakeMaterialMaps, createMeshBakeSampler } from '../materialx/bake.ts';
import type { BakedMaterialMaps } from '../materialx/bake.ts';
import { exportSceneGlb, exportSceneUsdZip } from '../materialx/scene-export.ts';
import { StreamingImages } from '../assets/streaming-images.ts';
import { captureRgba, type RgbaCapture } from '../gpu/capture.ts';
import { uploadMaterialImage, uploadMaterialImageArray } from '../gpu/material-texture.ts';
import { packPtTextureArrays } from './pathtracing/texture-arrays.ts';
import { OrbitCamera, attachOrbitControls } from '../scene/orbit-camera.ts';
import { inverse4, lookAt4, multiply4, perspective4, transformDirection, type Mat4, type Vec3 } from '../scene/transforms.ts';
import { gprimToMesh, primitiveShapeOf } from '../scene/primitives.ts';
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
import {
  addMaterialNodeDownstream, addMaterialNodeFromDefinition, canInsertMaterialInputNode, changeMaterialConstant, changeMaterialConstantLink,
  changeMaterialGraphInputLink, changeMaterialGraphInputValue, changeMaterialParameters, compileEditableMaterial,
  compatibleMaterialGraphOutputs,
  materialConstantSources, materialUniformData, packParameterUniforms, visibleMaterialParameters,
  type EditableInputNode, type MaterialGraphOutput, type MaterialParameter,
} from './material-parameters.ts';
import type { ResolvedGraph, ResolvedNode, ResolvedNodeDefRef } from '../materialx/graph.ts';
import type { NormalizedSurfaceInput, ResolvedSurface } from '../materialx/surface-graph.ts';
import { applySceneDisplacement } from './displacement.ts';
import { extractDisplacement } from './graph-material-compiler.ts';
import type { GeometryResource, InstanceResource, MaterialResource, SceneResources } from './scene-resources.ts';
import { animateScene, isInvisible, type DeformedGeometry, type LightChanges } from './scene-animation.ts';
import { sampleAt, sceneTimeline, type SceneTimeline } from '../scene/time.ts';
import type { PrimAttribute, SceneAsset } from '../scene/types.ts';
import type { SceneCamera } from '../usd/cameras.ts';
import { packAnalyticLights } from './pathtracing/analytic-lights.ts';
import {
  loadMaterialPreviewShaderBall, materialPreviewCamera, materialPreviewResources, type MaterialPreviewOptions,
} from './material-preview.ts';
import { convertDisneySceneMaterial, prepareDisneyScene } from './pathtracing/disney-scene.ts';
import { materialBackendApproximations } from './material-approximations.ts';
import { DisneyTextureRegistry } from './pathtracing/disney-texture-array.ts';
import { DisneyGpuBackend } from './pathtracing/disney-gpu-backend.ts';
import { packDisneyLights } from './pathtracing/disney-lights.ts';
import { disneyGeometryWrites, disneyInstanceWrites } from './pathtracing/disney-dynamics.ts';
import {
  lightGuideEnabled, lightGuideUpdateWgsl, lightGuideValuesOffset, PT_LIGHT_GUIDE_CELLS, PT_LIGHT_GUIDE_SETTINGS_BYTES,
} from './pathtracing/light-guide.ts';
import type { DisneyShaderSpecialization } from './pathtracing/disney-shader-specialization.ts';
import { buildDisneyEnvironmentCdf } from './pathtracing/disney-environment.ts';
import { disneyTileForIndex, type DisneyRenderSettings } from './pathtracing/disney-render.ts';
import type { SceneLight } from '../usd/lights.ts';
import {
  applyCompiledMaterials, compileMaterialDocument, compiledRasterShaderKey, loadCompiledMaterial, loadCompiledScene, readCompiledLayerReferences,
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
const RASTER_UNUSED_VARIANT_LIMIT = 16;
const PATH_TRACE_TILES_PER_REFRESH = 4;
const PATH_TRACE_MAX_TILES_PER_REFRESH = 16;
/** GPU time aimed at per path-tracing submission on mobile GPUs (adaptive tile batches). */
const PATH_TRACE_BATCH_TARGET_MS = 50;
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

interface StoredMaterialVariant {
  version: 1;
  graph: Omit<ResolvedGraph, 'nodes'> & { nodes: ResolvedNode[] };
  surface: Omit<ResolvedSurface, 'inputs'> & { inputs: [string, NormalizedSurfaceInput][] };
  parameters: readonly MaterialParameter[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isStoredMaterialVariant(value: unknown): value is StoredMaterialVariant {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.graph) || !isRecord(value.surface)) return false;
  const graph = value.graph;
  const surface = value.surface;
  return Array.isArray(graph.terminals)
    && Array.isArray(graph.nodes)
    && graph.nodes.every(node => isRecord(node) && typeof node.id === 'string' && Array.isArray(node.inputs))
    && Array.isArray(surface.inputs)
    && surface.inputs.every(input => Array.isArray(input) && typeof input[0] === 'string' && isRecord(input[1]))
    && Array.isArray(value.parameters)
    && value.parameters.every(parameter => isRecord(parameter) && typeof parameter.id === 'string'
      && typeof parameter.input === 'string' && Array.isArray(parameter.value) && Array.isArray(parameter.initial));
}

function materialVariantStorageKey(sceneEntry: string, path: string, unitKey: string, slot: MaterialVariantSlot): string {
  return `materialx-webgpu:variant:v1:${encodeURIComponent(sceneEntry)}:${encodeURIComponent(path)}:${encodeURIComponent(unitKey)}:${slot}`;
}

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
  /** The selected backend exceeds a GPU limit for this scene; frames are rendered with raster instead. */
  fallback?: BackendFallback;
  /** Present while a streaming load shows a partial scene. */
  loading?: SceneLoadingProgress;
}

export interface BackendFallback {
  readonly from: 'pathtracing' | 'disney';
  readonly to: 'raster';
  readonly reason: string;
}

export interface SceneLoadingProgress {
  /** `geometry`: meshes so far with neutral surfaces; `textures`: final geometry and materials, textures arriving. */
  readonly stage: 'geometry' | 'textures';
  readonly pendingGeometry: number;
  readonly pendingTextures: number;
}

/** Opaque viewer state for InteractiveViewer.restoreState (CPU objects only, no GPU resources). */
export interface ViewerSnapshot {
  readonly scene?: {
    readonly entry: string;
    readonly overrides: ReadonlyMap<string, ObjectMaterialOverride>;
    readonly options: SceneLoadOptions;
    readonly compiledOverrides: ReadonlyMap<string, { assetPath: string; material: CompiledMaterial }>;
    readonly time: number;
    readonly orbit: OrbitCamera;
    readonly transforms: ReadonlyMap<string, Mat4>;
    readonly visibility: ReadonlyMap<string, boolean>;
    readonly lights: ReadonlyMap<string, LightChanges>;
    readonly parameters: ReadonlyMap<string, ReadonlyMap<string, readonly number[]>>;
  };
  readonly settings: {
    readonly backend: BackendKind;
    readonly rasterQuality: RasterQuality;
    readonly depth: number | undefined;
    readonly denoise: boolean;
    readonly adaptive: boolean;
    readonly view: PathTraceView;
    readonly limits: PathTraceRenderLimits;
    readonly environmentEnabled: boolean;
    readonly paused: boolean;
    readonly exposure: number | undefined;
    readonly tonemap: Tonemap;
    readonly temporalHistory: number;
  };
}

const PREVIEW_MIN_INTERVAL_MS = 1000;
/** Previews cost at most 1/PREVIEW_COST_FACTOR of the loading time. */
/** Texture side in previews (placeholders and decoded images); the final scene uses full resolution. */
const PREVIEW_TEXTURE_SIZE = 512;
/** Textures decoded within this delay after the geometry skip the textures-stage preview. */
const PREVIEW_TEXTURE_WAIT_MS = 300;
/** Longest wait for the first preview frame before geometry work resumes. */
const PREVIEW_FRAME_TIMEOUT_MS = 500;
/** The MaterialX runtime starts at the latest this long after the load when no preview is shown first. */
const PREVIEW_MATERIALS_DELAY_MS = 1000;
/** Loads shorter than this show no preview. */
const PREVIEW_FIRST_DELAY_MS = 200;
const PREVIEW_COST_FACTOR = 20;

interface PreviewState {
  cancelled: boolean;
  building: Promise<void> | undefined;
  shown: boolean;
  lastEnd: number;
  lastCost: number;
  /** Decodes through the scene's image provider once its geometry is complete. */
  images: StreamingImages | undefined;
  /** Resolves when the first preview frame is presented (or after a short timeout); then undefined. */
  firstFrame: Promise<void> | undefined;
  releaseMaterials?: () => void;
  preserveCamera: boolean;
  options: SceneLoadOptions;
  sink: DiagnosticSink;
  loadStarted: number;
}

function sceneTextureFiles(resources: SceneResources): Set<string> {
  const files = new Set<string>();
  for (const material of resources.materials.values()) {
    for (const texture of material.surfaceModule?.textures ?? []) if (texture.fileRef) files.add(texture.fileRef);
    if (material.displacement?.file) files.add(material.displacement.file);
    for (const texture of material.displacement?.program?.ir.textures ?? []) {
      if (texture.fileRef) files.add(texture.fileRef);
    }
  }
  return files;
}

/** The memory budget never reduces material textures below this side. */
const MIN_BUDGET_TEXTURE_SIZE = 256;

const sceneCameraKey = (camera: SceneCamera): string => JSON.stringify([camera.transform, camera.fovY, camera.pathtracerFov]);

/** Dynamic scene changes; omitted fields are unchanged. */
interface SceneDynamicUpdate {
  /** World transforms by instance id. */
  transforms?: ReadonlyMap<string, Mat4>;
  /** The complete set of hidden instance ids. */
  hidden?: ReadonlySet<string>;
  /** Deformed vertex streams by prototype id (same vertex count). */
  geometry?: ReadonlyMap<string, DeformedGeometry>;
  /** All scene lights; the number of non-dome lights must not change. */
  lights?: readonly SceneLight[];
  /** Keep accumulating (motion-blur sub-frames) instead of restarting or aging. */
  keepAccumulation?: boolean;
  /** The camera also moved: age or restart the accumulation even if nothing else changed. */
  cameraChanged?: boolean;
  /** Material uniforms changed (already uploaded): age or restart the accumulation. */
  materialsChanged?: boolean;
}

/** A disposable per-scene GPU render set (raster + lazily built path tracer) for one loaded USD. */
interface SceneRender {
  setEnvironmentEnabled: (enabled: boolean) => void;
  updateMaterial: (key: string, material: MaterialResource) => void;
  updateTopology: (
    key: string, material: MaterialResource, frame: SceneFramePlan, check: () => void, commit: () => void,
  ) => Promise<void>;
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
  capturePathTrace: (
    targetView: GPUTextureView | undefined, samples: number, check?: () => void, options?: { reset?: boolean },
  ) => Promise<void>;
  /** Moves, hides, deforms or relights the scene without reloading it. */
  applyDynamics: (update: SceneDynamicUpdate) => void;
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
  fallback: () => BackendFallback | undefined;
  /** Releases a path tracer and draws its frames with raster (memory budget). */
  forceFallback: (from: BackendFallback['from'], reason: string) => void;
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
  #materialPreviewShaderBall: Promise<GeometryResource> | undefined;
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
  #pathTracingTemporalHistory = 0;
  #loadingProgress: SceneLoadingProgress | undefined;
  #firstPreviewStart: number | undefined;
  #firstPreviewPresented: (() => void) | undefined;
  readonly #memory: GpuMemoryTracker;
  #memoryBudget: number | undefined;
  #budgetTextureLimit = Infinity;
  #largestTexture = 0;
  #budgetCheckScheduled = false;
  #enforcingBudget = false;
  #budgetExceededReported = false;
  #loading = 0;
  #capturing = 0;
  #adaptiveCameraTimer: ReturnType<typeof setTimeout> | undefined;
  #adaptiveCameraUpdating = false;
  #adaptiveCameraPending = false;
  #streaming: boolean;
  // Dynamic scene state: the USD-driven state at #time, then the API overrides.
  #time = 0;
  #baseTransforms = new Map<string, Mat4>();
  #transformOverrides = new Map<string, Mat4>();
  #visibilityOverrides = new Map<string, boolean>();
  #lightOverrides = new Map<string, LightChanges>();
  #sceneCameraKey: string | undefined;
  #keepDynamicOverrides = false;

  constructor(opts: {
    device: GPUDevice;
    outputFormat: GPUTextureFormat;
    onStatus?: (s: ViewerStatus) => void;
    onShaderErrors?: (errors: readonly ShaderCompilationError[]) => void;
    onDiagnostic?: DiagnosticSink;
    /** GPU memory budget in bytes: textures are reduced, then path tracing falls back to raster (docs/INTEGRATION.md). */
    memoryBudget?: number;
    /** Show partial scenes (placeholder materials, geometry and textures as they arrive) while loading. */
    streaming?: boolean;
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
    this.#memory = new GpuMemoryTracker(opts.device);
    this.#memoryBudget = opts.memoryBudget;
    this.#streaming = opts.streaming ?? false;
    this.#memory.onChange(usage => {
      if (this.#memoryBudget !== undefined && usage.total > this.#memoryBudget) this.#scheduleBudgetCheck();
    });
    this.#orbitControls = 'canvas' in opts && opts.orbitControls !== false;
    this.#orbit = OrbitCamera.fromEyeTarget([0, 0.3 + 0.438 * 7, 0], [0, 0.3, 0], this.#width / this.#height);
    this.#detachControls = this.#bindOrbitControls();
    if (this.#context) this.#loop();
  }

  get backend(): BackendKind {
    return this.#backend;
  }

  /** Live GPU buffer and texture bytes allocated through this viewer's device. */
  get gpuMemory(): GpuMemoryUsage & { budget?: number; textureLimit: number } {
    return { ...this.#memory.usage, ...(this.#memoryBudget !== undefined ? { budget: this.#memoryBudget } : {}), textureLimit: this.textureLimit };
  }

  /**
   * Changes the GPU memory budget and applies its policy at once. Removing the budget restores
   * full-size textures and the path tracer by rebuilding the render set.
   */
  async setMemoryBudget(bytes?: number): Promise<void> {
    if (bytes !== undefined && !(Number.isFinite(bytes) && bytes > 0)) {
      throw new RangeError('The GPU memory budget must be a positive number of bytes.');
    }
    this.#memoryBudget = bytes;
    this.#budgetExceededReported = false;
    if (bytes !== undefined) {
      await this.#enforceMemoryBudget();
      return;
    }
    const restore = this.#budgetTextureLimit !== Infinity || this.#current?.fallback() !== undefined;
    this.#budgetTextureLimit = Infinity;
    const loaded = this.#loaded;
    if (restore && loaded && this.#current) {
      await this.#replaceLoaded(loaded, { ...loaded }, 'Scene changed while removing the GPU memory budget.');
    }
  }

  /** Largest material texture side: the GPU limit, lowered by the memory budget policy. */
  get textureLimit(): number {
    return Math.min(this.#device.limits.maxTextureDimension2D, this.#budgetTextureLimit);
  }

  #withTextureLimits(loaded: LoadedUsdScene, report = true): LoadedUsdScene {
    const sink = this.#diagnosticSink();
    const imageProvider = limitImageProvider(loaded.mtlx.imageProvider, () => this.textureLimit, reduction => {
      if (!report) return;
      const budget = this.#budgetTextureLimit < this.#device.limits.maxTextureDimension2D;
      // Budget reductions are summarized by memory-budget-reduced; each texture is informational.
      sink({
        level: budget ? 'info' : 'warning', code: 'texture-downscaled',
        message: `Texture ${reduction.file} reduced from ${reduction.from.join('x')} to ${reduction.to.join('x')} ` +
          (budget ? `by the GPU memory budget (${this.textureLimit} px).` : `to fit maxTextureDimension2D (${this.textureLimit}).`),
        detail: { ...reduction, limit: this.textureLimit, cause: budget ? 'memory-budget' : 'gpu-limit' },
      });
    }, image => {
      this.#largestTexture = Math.max(this.#largestTexture, image.width, image.height,
        ...(image.udim ?? []).map(layer => Math.max(layer.image.width, layer.image.height)));
    });
    // Mutated in place: material edits keep updating the same scene object.
    loaded.mtlx = { ...loaded.mtlx, imageProvider };
    return loaded;
  }

  #scheduleBudgetCheck(): void {
    if (this.#budgetCheckScheduled || this.#disposed) return;
    this.#budgetCheckScheduled = true;
    setTimeout(() => {
      this.#budgetCheckScheduled = false;
      void this.#enforceMemoryBudget().catch((error: unknown) => this.#diagnosticSink()({
        level: 'error', code: 'memory-budget-exceeded', message: `GPU memory budget enforcement failed: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }, 0);
  }

  /**
   * Budget policy, in order: halve the material texture limit (down to 256 px) and rebuild the
   * render set; then render path tracing or Disney with raster; then report the excess.
   */
  async #enforceMemoryBudget(): Promise<void> {
    const budget = this.#memoryBudget;
    const over = () => budget !== undefined && this.#memory.usage.total > budget;
    if (!over() || this.#enforcingBudget || this.#disposed || this.#loading > 0 || !this.#loaded || !this.#current) return;
    this.#enforcingBudget = true;
    const sink = this.#diagnosticSink();
    const megabytes = (bytes: number) => `${(bytes / 2 ** 20).toFixed(1)} MiB`;
    try {
      while (over() && this.#capturing === 0 && this.#loading === 0) {
        const limit = Math.max(MIN_BUDGET_TEXTURE_SIZE, Math.min(this.textureLimit, this.#largestTexture) >> 1);
        if (limit >= Math.min(this.textureLimit, this.#largestTexture)) break;
        const before = this.#memory.usage.total;
        this.#budgetTextureLimit = limit;
        sink({ level: 'warning', code: 'memory-budget-reduced',
          message: `GPU memory ${megabytes(before)} exceeds the budget of ${megabytes(budget!)}; material textures limited to ${limit} px.`,
          detail: { bytes: before, budget, textureLimit: limit } });
        const loaded = this.#loaded;
        await this.#replaceLoaded(loaded, { ...loaded }, 'Scene changed during memory budget reduction.');
      }
      const current = this.#current;
      if (over() && this.#capturing === 0 && current && (this.#backend === 'pathtracing' || this.#backend === 'disney')
          && current.fallback()?.from !== this.#backend) {
        const from = this.#backend;
        const reason = `GPU memory ${megabytes(this.#memory.usage.total)} exceeds the budget of ${megabytes(budget!)}.`;
        current.forceFallback(from, reason);
        sink({ level: 'warning', code: 'backend-fallback', message: `${reason} Rendering with raster instead of ${from}.`,
          detail: { backend: from, bytes: this.#memory.usage.total, budget } });
        this.#rasterDirty = true;
        this.#emitStatus();
      }
      if (over() && !this.#budgetExceededReported) {
        this.#budgetExceededReported = true;
        sink({ level: 'error', code: 'memory-budget-exceeded',
          message: `GPU memory ${megabytes(this.#memory.usage.total)} still exceeds the budget of ${megabytes(budget!)} after every reduction.`,
          detail: { bytes: this.#memory.usage.total, budget } });
      }
    } finally {
      this.#enforcingBudget = false;
    }
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

  /**
   * CPU-side state needed to rebuild this viewer on a new GPU device: scene entry, material
   * overrides and parameter edits, dynamic overrides, time, camera and render settings.
   * Material graph edits made in the editor are not included.
   */
  snapshotState(): ViewerSnapshot {
    const parameters = new Map<string, Map<string, readonly number[]>>();
    if (this.#loaded) {
      for (const { path } of this.#objects) {
        const changed = this.objectParameters(path).filter(parameter => parameter.value.some((value, i) => value !== parameter.initial[i]));
        if (changed.length) parameters.set(path, new Map(changed.map(parameter => [parameter.id, [...parameter.value]])));
      }
    }
    return {
      ...(this.#sceneEntry && this.#loaded ? { scene: {
        entry: this.#sceneEntry, overrides: new Map(this.#materialOverrides), options: this.#loadOptions,
        compiledOverrides: new Map(this.#compiledOverrides), time: this.#time, orbit: this.#orbit,
        transforms: new Map(this.#transformOverrides), visibility: new Map(this.#visibilityOverrides),
        lights: new Map(this.#lightOverrides), parameters,
      } } : {}),
      settings: {
        backend: this.#backend, rasterQuality: this.#rasterQuality, depth: this.#pathTracingDepthOverride,
        denoise: this.#pathTracingDenoise, adaptive: this.#pathTracingAdaptive, view: this.#pathTracingView,
        limits: this.#pathTracingLimits, environmentEnabled: this.#environmentEnabled, paused: this.#pathTracingPaused,
        exposure: this.#exposure, tonemap: this.#tonemap, temporalHistory: this.#pathTracingTemporalHistory,
      },
    };
  }

  /** Reloads a snapshot taken on another viewer (typically after a device loss). */
  async restoreState(snapshot: ViewerSnapshot): Promise<void> {
    const settings = snapshot.settings;
    this.#backend = settings.backend;
    this.#rasterQuality = settings.rasterQuality;
    this.#pathTracingDenoise = settings.denoise;
    this.#pathTracingAdaptive = settings.adaptive;
    this.#pathTracingView = settings.view;
    this.#pathTracingLimits = settings.limits;
    this.#environmentEnabled = settings.environmentEnabled;
    this.#pathTracingPaused = settings.paused;
    this.#exposure = settings.exposure;
    this.#tonemap = settings.tonemap;
    this.#pathTracingTemporalHistory = settings.temporalHistory;
    const scene = snapshot.scene;
    if (scene) {
      this.#transformOverrides = new Map(scene.transforms);
      this.#visibilityOverrides = new Map(scene.visibility);
      this.#lightOverrides = new Map(scene.lights);
      this.#keepDynamicOverrides = true;
      try {
        await this.load(scene.entry, scene.overrides, true, { ...scene.options, time: scene.time });
      } finally {
        this.#keepDynamicOverrides = false;
      }
      if (scene.compiledOverrides.size && this.#compiledBase) {
        const candidate = await applyCompiledMaterials(this.#compiledBase,
          new Map([...scene.compiledOverrides].map(([path, value]) => [path, value.material])));
        await this.#replaceLoaded(this.#loaded!, candidate, 'Scene changed during state restoration.');
        this.#compiledOverrides = new Map(scene.compiledOverrides);
        this.#objects = describeObjects(candidate, new Map([...scene.compiledOverrides].map(([key, value]) => [key, value.assetPath])));
      }
      for (const [path, changes] of scene.parameters) await this.setObjectParameters(path, changes);
      this.#orbit = scene.orbit;
      this.#orbit.aspect = this.#width / this.#height;
      this.#detachControls();
      this.#detachControls = this.#bindOrbitControls();
      this.#onCameraChanged();
      await this.#updateCameraAdaptiveSubdivision();
    }
    if (settings.depth !== undefined) this.setPathTracingDepth(settings.depth);
    this.#rasterDirty = true;
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

  objectTextureExportSource(path: string, file: string) {
    if (!this.#loaded || !this.#objects.some(object => object.path === path)) {
      throw new Error(`Objet introuvable pour l’export : ${path}.`);
    }
    return this.#loaded.mtlx.imageProvider.exportSource?.(file);
  }

  async bakeObjectMaterial(path: string, width = 512, height = width): Promise<BakedMaterialMaps> {
    const material = this.#editableObjectMaterial(path);
    if (!material?.surfaceGraph || !material.resolvedSurface || !this.#loaded) {
      throw new Error(`Material indisponible pour le baking : ${path}.`);
    }
    const source = this.#loaded.parameterResources ?? this.#loaded.resources;
    const instance = source.instances.find(candidate => candidate.primPath === path);
    const geometry = instance ? source.geometries.get(instance.prototypeId) : undefined;
    const draw = instance ? this.#current?.frame.draws.find(candidate => candidate.instanceId === instance.id) : undefined;
    if (!geometry || !draw) throw new Error(`Géométrie préparée introuvable pour le baking : ${path}.`);
    return bakeMaterialMaps(material.surfaceGraph, material.resolvedSurface, this.#loaded.mtlx.imageProvider, {
      width, height, material, sampleAt: createMeshBakeSampler(geometry, draw.model, width, height),
    });
  }

  async exportSceneGlb(): Promise<Blob> {
    if (!this.#loaded || !this.#current) throw new Error('Aucune scène chargée pour l’export glTF.');
    return exportSceneGlb(
      this.#current.frame, this.#loaded.resources, this.#loaded.mtlx.imageProvider,
      this.#loaded.parameterResources ?? this.#loaded.resources,
    );
  }

  async captureNodeOutputPreview(
    graph: ResolvedGraph, nodeId: string, outputName: string, signal: AbortSignal,
  ): Promise<RgbaCapture> {
    const loaded = this.#loaded;
    if (!loaded) throw new Error('Aucune scène chargée pour l’aperçu du graphe.');
    const check = () => {
      signal.throwIfAborted();
      if (this.#disposed || this.#loaded !== loaded) throw new Error('La scène a changé pendant le calcul de l’aperçu.');
    };
    return bakeGraphOutput(graph, nodeId, outputName, loaded.mtlx.imageProvider, { width: 128, check });
  }

  async exportSceneUsd(): Promise<Blob> {
    if (!this.#loaded || !this.#current) throw new Error('Aucune scène chargée pour l’export USD.');
    return exportSceneUsdZip(
      this.#current.frame, this.#loaded.resources, this.#loaded.mtlx.imageProvider,
      this.#loaded.parameterResources ?? this.#loaded.resources, this.#loaded.scene,
    );
  }

  objectSurfaceInputDiagnostics(path: string, nodeId: string) {
    const resources = this.#loaded?.parameterResources ?? this.#loaded?.resources;
    const key = resources?.instances.find(instance => instance.primPath === path)?.materialKey;
    const surface = key ? resources?.materials.get(key)?.resolvedSurface : undefined;
    return surface?.nodeId === nodeId ? surface.inputDiagnostics ?? [] : [];
  }

  objectDisneyMaterialDiagnostics(path: string): { warnings: readonly string[] } | { error: string } | undefined {
    if (this.#backend !== 'disney') return undefined;
    const resources = this.#loaded?.parameterResources ?? this.#loaded?.resources;
    const key = resources?.instances.find(instance => instance.primPath === path)?.materialKey;
    const material = key ? resources?.materials.get(key) : undefined;
    if (!key || !material?.surfaceGraph) return undefined;
    try {
      return { warnings: convertDisneySceneMaterial(key, material, new DisneyTextureRegistry()).warnings };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Approximations of the selected object's material in the active backend, without compiling pipelines. */
  objectMaterialBackendDiagnostics(path: string):
    ({ backend: BackendKind } & ({ warnings: readonly string[] } | { error: string })) | undefined {
    const backend = this.#backend;
    if (backend === 'disney') {
      const diagnostics = this.objectDisneyMaterialDiagnostics(path);
      return diagnostics && { backend, ...diagnostics };
    }
    const loaded = this.#loaded;
    const resources = loaded?.parameterResources ?? loaded?.resources;
    const instance = resources?.instances.find(candidate => candidate.primPath === path);
    const material = instance?.materialKey ? resources?.materials.get(instance.materialKey) : undefined;
    if (!loaded || !resources || !instance || !material?.surfaceGraph) return undefined;
    const pass = backend === 'raster'
      ? buildSceneFrame({ ...resources, instances: [instance] }, { surfaceFor: loaded.mtlx.surfaceFor }).draws[0]?.pass
      : undefined;
    return { backend, warnings: materialBackendApproximations(material, backend, pass) };
  }

  objectMaterialVariants(path: string) {
    const material = this.#editableObjectMaterial(path);
    if (!material?.surfaceGraph) return undefined;
    const saved = this.#materialVariantsFor(path, material);
    return {
      A: saved?.A === undefined ? 'empty' : saved.A === material ? 'active' : 'saved',
      B: saved?.B === undefined ? 'empty' : saved.B === material ? 'active' : 'saved',
    } as const;
  }

  objectMaterialVariantGraph(path: string, slot: MaterialVariantSlot) {
    const material = this.#editableObjectMaterial(path);
    return material?.surfaceGraph ? this.#materialVariantsFor(path, material)[slot]?.surfaceGraph : undefined;
  }

  saveObjectMaterialVariant(path: string, slot: MaterialVariantSlot): void {
    const material = this.#editableObjectMaterial(path);
    if (!material?.surfaceGraph) throw new Error('Aucun graphe éditable pour cet objet.');
    const variants = this.#materialVariantsFor(path, material);
    this.#writeMaterialVariant(path, slot, material);
    this.#materialVariants.set(path, { ...variants, [slot]: material });
  }

  async applyObjectMaterialVariant(path: string, slot: MaterialVariantSlot): Promise<void> {
    const material = this.#editableObjectMaterial(path);
    const saved = material?.surfaceGraph ? this.#materialVariantsFor(path, material)[slot] : undefined;
    if (!saved) throw new Error(`La variante ${slot} est vide.`);
    await this.#editObjectGraph(path, () => saved);
  }

  async captureObjectMaterialVariants(
    path: string, options: { backend: 'raster' } | { backend: 'pathtracing'; samples: number }, signal: AbortSignal,
  ): Promise<Readonly<Record<MaterialVariantSlot, RgbaCapture>>> {
    const loaded = this.#loaded;
    const current = this.#current;
    const source = loaded?.parameterResources;
    const key = source?.instances.find(instance => instance.primPath === path && instance.hasGeometry)?.materialKey;
    const material = this.#editableObjectMaterial(path);
    const variants = material?.surfaceGraph ? this.#materialVariantsFor(path, material) : undefined;
    if (!loaded || !current || !source || !key || !variants?.A || !variants.B) {
      throw new Error('Enregistre les variantes A et B d’un objet visible avant de les comparer.');
    }
    if (options.backend === 'pathtracing' && (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 64)) {
      throw new RangeError('Le nombre d’échantillons doit être un entier de 1 à 64.');
    }
    const check = () => {
      signal.throwIfAborted();
      if (this.#disposed || this.#loaded !== loaded || this.#current !== current || loaded.parameterResources !== source) {
        throw new Error('La scène a changé pendant la comparaison.');
      }
    };
    const scale = Math.min(1, 256 / Math.max(this.#width, this.#height));
    const width = Math.max(1, Math.round(this.#width * scale));
    const height = Math.max(1, Math.round(this.#height * scale));
    const exposure = this.#exposure ?? loaded.cameras[0]?.exposure ?? 0;
    const frameCamera = { viewProj: this.#orbit.viewProj(), eye: this.#orbit.eye, exposure };
    const background = inverse4(this.#orbit.backgroundViewProj());
    const environment = { ...current.frame.environment };
    const rasterQuality = this.#rasterQuality;
    const tonemap = this.#tonemap;
    const depth = this.#pathTracingDepthOverride;
    const capture = async (material: MaterialResource): Promise<RgbaCapture> => {
      check();
      const materials = new Map(source.materials).set(key, material);
      const resources = await applySceneDisplacement({ ...source, materials }, loaded.mtlx.imageProvider, this.#device);
      check();
      const candidate = { ...loaded, resources };
      delete candidate.compiled;
      const frame = buildSceneFrame(resources, {
        lights: candidate.lights, surfaceFor: candidate.mtlx.surfaceFor,
        environment: { ...environment }, frameCamera,
      });
      const offscreen = new InteractiveViewer({ device: this.#device, width, height, outputFormat: 'rgba8unorm' });
      offscreen.#backend = options.backend;
      offscreen.#rasterQuality = rasterQuality;
      offscreen.#tonemap = tonemap;
      try {
        // The temporary viewer owns only the GPU render set, not the shared MaterialX documents.
        const render = offscreen.#current = await offscreen.#buildSceneRender(candidate, frame, exposure, diagnostic => {
          if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
          else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
        });
        check();
        render.applyCamera(frameCamera.viewProj, frameCamera.eye, background);
        if (depth !== undefined) render.setPathTracingDepth(depth);
        return await captureRgba(this.#device, width, height, options.backend === 'pathtracing'
          ? { pathTrace: target => render.capturePathTrace(target, options.samples, check) }
          : { raster: render.renderRaster }, check);
      } finally {
        offscreen.dispose();
      }
    };
    return { A: await capture(variants.A), B: await capture(variants.B) };
  }

  async captureObjectMaterialPreview(path: string, options: MaterialPreviewOptions, signal: AbortSignal): Promise<RgbaCapture> {
    if (options.target !== 'object' && options.target !== 'shaderball') throw new Error('Support d’aperçu inconnu.');
    if (options.backend !== 'raster' && options.backend !== 'pathtracing') throw new Error('Moteur d’aperçu inconnu.');
    if (options.backend === 'pathtracing' && (!Number.isInteger(options.samples) || options.samples < 1 || options.samples > 64)) {
      throw new RangeError('Le nombre d’échantillons doit être un entier de 1 à 64.');
    }
    const loaded = this.#loaded;
    const current = this.#current;
    const parameterResources = loaded?.parameterResources;
    const source = parameterResources ?? loaded?.resources;
    if (!loaded || !current || !source) throw new Error('Aucune scène pour l’aperçu.');
    const check = () => {
      signal.throwIfAborted();
      if (this.#disposed || this.#loaded !== loaded || this.#current !== current
        || loaded.parameterResources !== parameterResources || (!parameterResources && loaded.resources !== source)) {
        throw new Error('La scène a changé pendant l’aperçu.');
      }
    };
    check();
    const sink: DiagnosticSink = diagnostic => {
      if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
      else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
    };
    const isolatedObject = materialPreviewResources(source, path);
    let shaderBall: GeometryResource | undefined;
    if (options.target === 'shaderball') {
      if (!this.#materialPreviewShaderBall) {
        this.#materialPreviewShaderBall = loadMaterialPreviewShaderBall(document.baseURI, sink);
      }
      const build = this.#materialPreviewShaderBall;
      try { shaderBall = await build; }
      catch (error) {
        if (this.#materialPreviewShaderBall === build) this.#materialPreviewShaderBall = undefined;
        throw error;
      }
      check();
    }
    let isolated = shaderBall ? materialPreviewResources(source, path, shaderBall) : isolatedObject;
    if (!parameterResources && shaderBall) {
      const key = isolated.instances[0]!.materialKey!;
      const material = isolated.materials.get(key)!;
      const displacement = material.displacement ?? (material.surfaceGraph && extractDisplacement(material.surfaceGraph));
      if (displacement && !material.displacement) {
        isolated = { ...isolated, materials: new Map(isolated.materials).set(key, { ...material, displacement }) };
      }
    }
    // Render resources already contain baked displacement; only a new shaderball needs it reapplied.
    const resources = parameterResources || shaderBall
      ? await applySceneDisplacement(isolated, loaded.mtlx.imageProvider, this.#device) : isolated;
    check();
    const exposure = this.#exposure ?? loaded.cameras[0]?.exposure ?? 0;
    const eye = this.#orbit.eye;
    const target = this.#orbit.target;
    const { camera, backgroundInvViewProj } = materialPreviewCamera(
      resources, [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]], exposure,
    );
    const candidate = { ...loaded, resources };
    delete candidate.compiled;
    const frame = buildSceneFrame(resources, {
      lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor,
      environment: { ...current.frame.environment }, frameCamera: camera,
    });
    let shaderErrors: readonly ShaderCompilationError[] = [];
    const size = 256;
    const offscreen = new InteractiveViewer({
      device: this.#device, width: size, height: size, outputFormat: 'rgba8unorm',
      onShaderErrors: errors => { shaderErrors = errors; },
    });
    offscreen.#backend = options.backend;
    offscreen.#rasterQuality = 'interactive';
    offscreen.#tonemap = this.#tonemap;
    try {
      const render = offscreen.#current = await offscreen.#buildSceneRender(candidate, frame, exposure, sink);
      check();
      render.applyCamera(camera.viewProj, camera.eye, backgroundInvViewProj);
      if (this.#pathTracingDepthOverride !== undefined) render.setPathTracingDepth(this.#pathTracingDepthOverride);
      return await captureRgba(this.#device, size, size, options.backend === 'pathtracing'
        ? { pathTrace: targetView => render.capturePathTrace(targetView, options.samples, check) }
        : { raster: render.renderRaster }, check);
    } catch (error) {
      check();
      if (shaderErrors.length) {
        const detail = shaderErrors.map(diagnostic => `${diagnostic.shader}: ${diagnostic.message}`).join('; ');
        throw new Error(`Compilation de l’aperçu : ${detail}`, { cause: error });
      }
      throw error;
    } finally {
      offscreen.dispose();
    }
  }

  #editableObjectMaterial(path: string): MaterialResource | undefined {
    const source = this.#loaded?.parameterResources;
    const key = source?.instances.find(instance => instance.primPath === path)?.materialKey;
    return key ? source?.materials.get(key) : undefined;
  }

  #materialVariantsFor(path: string, material: MaterialResource): Partial<Record<MaterialVariantSlot, MaterialResource>> {
    const cached = this.#materialVariants.get(path);
    if (cached) return cached;
    const variants: Partial<Record<MaterialVariantSlot, MaterialResource>> = {};
    const sceneEntry = this.#sceneEntry;
    const storage = globalThis.localStorage;
    if (sceneEntry && storage) {
      for (const slot of ['A', 'B'] as const) {
        const serialized = storage.getItem(materialVariantStorageKey(sceneEntry, path, material.unitKey, slot));
        if (serialized === null) continue;
        const parsed: unknown = JSON.parse(serialized);
        if (!isStoredMaterialVariant(parsed)) {
          throw new Error(`La variante ${slot} mémorisée pour ${path} est invalide.`);
        }
        const graph: ResolvedGraph = { ...parsed.graph, nodes: new Map(parsed.graph.nodes.map(node => [node.id, node])) };
        const surface: ResolvedSurface = { ...parsed.surface, inputs: new Map(parsed.surface.inputs) };
        variants[slot] = compileEditableMaterial({
          ...material, surfaceGraph: graph, resolvedSurface: surface, parameters: parsed.parameters,
        });
      }
    }
    this.#materialVariants.set(path, variants);
    return variants;
  }

  #writeMaterialVariant(path: string, slot: MaterialVariantSlot, material: MaterialResource): void {
    const sceneEntry = this.#sceneEntry;
    const surface = material.resolvedSurface;
    const graph = material.surfaceGraph;
    if (!sceneEntry || !surface || !graph || !material.parameters) {
      throw new Error('Impossible de mémoriser une variante sans scène et graphe éditable.');
    }
    const snapshot: StoredMaterialVariant = {
      version: 1,
      graph: { ...graph, nodes: [...graph.nodes.values()] },
      surface: { ...surface, inputs: [...surface.inputs] },
      parameters: material.parameters,
    };
    globalThis.localStorage?.setItem(materialVariantStorageKey(sceneEntry, path, material.unitKey, slot), JSON.stringify(snapshot));
  }

  canInsertObjectConstant(path: string, nodeId: string, input: string, kind: EditableInputNode = 'constant'): boolean {
    const material = this.#editableObjectMaterial(path);
    return !!material && canInsertMaterialInputNode(material, nodeId, input, kind);
  }

  async setObjectConstant(path: string, nodeId: string, input: string, insert: boolean, kind: EditableInputNode = 'constant'): Promise<void> {
    await this.#editObjectGraph(path, material => changeMaterialConstant(material, nodeId, input, insert, kind));
  }

  objectConstantSources(path: string, nodeId: string, input: string): string[] {
    const material = this.#editableObjectMaterial(path);
    return material ? materialConstantSources(material, nodeId, input) : [];
  }

  canUnlinkObjectConstant(path: string, nodeId: string, input: string): boolean {
    const material = this.#editableObjectMaterial(path);
    return material?.resolvedSurface?.nodeId === nodeId
      && !!material.parameters?.some(parameter => parameter.input === input && parameter.linkedSource !== undefined);
  }

  async setObjectConstantLink(path: string, nodeId: string, input: string, sourceId: string | null): Promise<void> {
    await this.#editObjectGraph(path, material => changeMaterialConstantLink(material, nodeId, input, sourceId));
  }

  objectNodeDefinitions(path: string): readonly ResolvedNodeDefRef[] {
    return this.#editableObjectMaterial(path) ? this.#loaded?.mtlx.nodeDefinitions ?? [] : [];
  }

  objectGraphOutputs(path: string, nodeId: string, input: string): MaterialGraphOutput[] {
    const material = this.#editableObjectMaterial(path);
    return material ? compatibleMaterialGraphOutputs(material, nodeId, input) : [];
  }

  canUnlinkObjectGraphInput(path: string, nodeId: string, inputName: string): boolean {
    const material = this.#editableObjectMaterial(path);
    const input = material?.surfaceGraph?.nodes.get(nodeId)?.inputs.find(candidate => candidate.name === inputName);
    return input?.editorOriginalSource !== undefined
      || !!material?.parameters?.some(parameter => parameter.linkedSource !== undefined
        && parameter.input === inputName && (parameter.nodeId === nodeId
          || nodeId === material.resolvedSurface?.nodeId && !parameter.nodeId));
  }

  async addObjectNode(
    path: string, targetId: string, inputName: string, definitionName: string, outputName: string,
  ): Promise<void> {
    const definitions = this.objectNodeDefinitions(path);
    await this.#editObjectGraph(path, material =>
      addMaterialNodeFromDefinition(material, targetId, inputName, definitionName, outputName, definitions));
  }

  /** Adds a node fed by `sourceId.outputName` through its input `inputName`. */
  async addObjectNodeDownstream(
    path: string, sourceId: string, outputName: string, definitionName: string, inputName: string,
  ): Promise<void> {
    const definitions = this.objectNodeDefinitions(path);
    await this.#editObjectGraph(path, material =>
      addMaterialNodeDownstream(material, sourceId, outputName, definitionName, inputName, definitions));
  }

  async setObjectGraphInputLink(
    path: string, targetId: string, inputName: string, sourceId: string | null, outputName = 'out',
  ): Promise<void> {
    await this.#editObjectGraph(path, material =>
      changeMaterialGraphInputLink(material, targetId, inputName, sourceId, outputName));
  }

  async setObjectGraphInputValue(path: string, targetId: string, inputName: string, value: string): Promise<void> {
    await this.#editObjectGraph(path, material =>
      changeMaterialGraphInputValue(material, targetId, inputName, value));
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
    const parameterResources = { ...source, materials };
    const bakedBefore = loaded.resources.materials.get(key);
    const hasVolume = [...source.materials.values()].some(candidate => candidate.volumeIr || candidate.volumeBoundary);
    if (!bakedBefore || hasVolume
      || JSON.stringify(material.displacement) !== JSON.stringify(updated.displacement)
      || material.volumeIr !== updated.volumeIr || material.volumeMedium !== updated.volumeMedium
      || material.volumeBoundary !== updated.volumeBoundary) {
      await this.#rebuildMaterialResources(loaded, parameterResources);
      return;
    }

    let baked = updated;
    if (updated.displacement && !bakedBefore.displacement) {
      const { displacement: _displacement, ...withoutDisplacement } = updated;
      baked = {
        ...withoutDisplacement,
        ...(updated.surfaceModule ? { sceneShader: assembleIrForwardShader(updated.surfaceModule) } : {}),
      };
    }
    const bakedMaterials = new Map(loaded.resources.materials);
    bakedMaterials.set(key, baked);
    const resources = { ...loaded.resources, materials: bakedMaterials };
    const current = this.#current;
    const frame = buildSceneFrame(resources, {
      lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor,
      environment: current.frame.environment, frameCamera: current.frame.camera,
    });
    const check = () => {
      if (this.#disposed || this.#loaded !== loaded || this.#current !== current || loaded.parameterResources !== source) {
        throw new Error('Scene changed during material update.');
      }
    };
    await current.updateTopology(key, baked, frame, check, () => {
      loaded.resources = resources;
      loaded.parameterResources = parameterResources;
      delete loaded.compiled;
    });
    this.#onCameraChanged();
    this.#emitStatus();
  }

  get isCompiledScene(): boolean {
    return this.#loaded?.precompiled === true;
  }

  async setObjectParameters(path: string, changes: ReadonlyMap<string, readonly number[]>): Promise<void> {
    await this.#setObjectParameters(path, changes, true);
  }

  async #setObjectParameters(path: string, changes: ReadonlyMap<string, readonly number[]>, resetAccumulation: boolean): Promise<void> {
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
      if (resetAccumulation) {
        this.#current.resetPathTrace();
        this.#emitStatus();
      }
      return;
    }
    await this.#rebuildMaterialResources(loaded, parameterResources);
  }

  async #rebuildMaterialResources(loaded: LoadedUsdScene, parameterResources: SceneResources): Promise<void> {
    const source = loaded.parameterResources;
    const current = this.#current;
    const check = () => {
      if (this.#disposed || this.#loaded !== loaded || this.#current !== current || loaded.parameterResources !== source) {
        throw new Error('Scene changed during material update.');
      }
    };
    const resources = await applySceneDisplacement(parameterResources, loaded.mtlx.imageProvider, this.#device);
    check();
    const candidate = { ...loaded, resources, parameterResources };
    delete candidate.compiled;
    await this.#replaceLoaded(loaded, candidate, 'Scene changed during material update.', check);
  }

  /** Swap the active scene state without reparsing USD (frame + GPU render set rebuilt from resources). */
  async #replaceLoaded(
    loaded: LoadedUsdScene, candidate: LoadedUsdScene, changedMessage: string, check?: () => void,
  ): Promise<void> {
    const current = this.#current;
    if (!current) throw new Error('No scene loaded.');
    const exposure = candidate.cameras[0]?.exposure ?? 0;
    const frame = buildSceneFrame(candidate.resources, {
      lights: candidate.lights, surfaceFor: candidate.mtlx.surfaceFor,
      environment: current.frame.environment,
      frameCamera: { viewProj: this.#orbit.viewProj(), eye: this.#orbit.eye, exposure },
    });
    const sink: DiagnosticSink = diagnostic => {
      if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
      else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
    };
    const render = await this.#buildSceneRender(candidate, frame, exposure, sink);
    if (this.#loaded !== loaded || this.#current !== current || this.#disposed) {
      render.dispose();
      throw new Error(changedMessage);
    }
    try { check?.(); } catch (error) { render.dispose(); throw error; }
    current.dispose();
    this.#current = render;
    if (this.#pathTracingDepthOverride !== undefined) render.setPathTracingDepth(this.#pathTracingDepthOverride);
    this.#loaded = candidate;
    this.#applyDynamicState(false);
    this.#onCameraChanged();
    this.#emitStatus();
  }

  async resetObjectParameters(path: string): Promise<void> {
    await this.setObjectParameters(path, new Map(this.objectParameters(path)
      .filter(parameter => parameter.value.some((value, i) => value !== parameter.initial[i]))
      .map(parameter => [parameter.id, parameter.initial])));
  }

  /**
   * Replace an object's material. On compiled scenes `compiledUrl` names a precompiled MaterialX
   * package; without one the document is compiled in the browser.
   */
  async setObjectMaterial(path: string, assetPath?: string, compiledUrl?: string): Promise<void> {
    if (!this.#sceneEntry || !this.#objects.some((object) => object.path === path)) {
      throw new Error(`Unknown object: ${path}`);
    }
    if (this.isCompiledScene) {
      const base = this.#compiledBase;
      if (!base) throw new Error('Compiled scene state is unavailable.');
      const overrides = new Map(this.#compiledOverrides);
      if (assetPath) {
        const material = compiledUrl
          ? await this.#compiledMaterial(compiledUrl)
          : await compileMaterialDocument(assetPath, await this.#materialName(assetPath), this.#diagnosticSink(), this.#loadOptions);
        overrides.set(path, { assetPath, material });
      } else {
        overrides.delete(path);
      }
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
    if (assetPath) overrides.set(path, { assetPath, materialName: await this.#materialName(assetPath) });
    else overrides.delete(path);
    await this.load(this.#sceneEntry, overrides, true, this.#loadOptions);
  }

  /** Name of the first `surfacematerial` of a MaterialX document. */
  async #materialName(assetPath: string): Promise<string> {
    const response = await fetch(assetPath);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${assetPath}`);
    const document = new DOMParser().parseFromString(await response.text(), 'application/xml');
    if (document.querySelector('parsererror')) throw new Error('Invalid MaterialX XML.');
    const materialName = document.getElementsByTagName('surfacematerial')[0]?.getAttribute('name');
    if (!materialName) throw new Error('No surfacematerial in this MaterialX document.');
    return materialName;
  }

  #diagnosticSink(): DiagnosticSink {
    return (diagnostic) => {
      if (this.#onDiagnostic) this.#onDiagnostic(diagnostic);
      else if (diagnostic.level === 'error') console.error(diagnostic.message, diagnostic.detail ?? '');
      else if (diagnostic.level === 'warning') console.warn(diagnostic.message, diagnostic.detail ?? '');
    };
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
    if (!references) return loadUsdScene(entry, sink, () => { }, overrides, sourceOptions, this.#device);
    if (overrides.size) {
      if (!references.source) throw new Error('Compiled scenes cannot import source material overrides.');
      return loadUsdScene(references.source, sink, () => { }, overrides, sourceOptions, this.#device);
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
      return loadUsdScene(references.source, sink, () => { }, overrides, sourceOptions, this.#device);
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
    if (this.#adaptiveCameraTimer !== undefined) clearTimeout(this.#adaptiveCameraTimer);
    this.#disposed = true;
    this.#detachControls();
    this.#current?.dispose();
    this.#current = null;
    this.#memory.dispose();
    this.#jsDenoiser.dispose();
    this.#loaded?.mtlx.documents?.delete();
    this.#loaded = undefined;
    this.#materialVariants.clear();
    this.#materialPreviewShaderBall = undefined;
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
    await this.#updateCameraAdaptiveSubdivision();
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
    this.#loading++;
    try {
      await this.#loadScene(entry, overrides, preserveCamera, options, sink, loadStarted);
    } finally {
      this.#loading--;
    }
    this.#budgetExceededReported = false;
    this.#scheduleBudgetCheck();
  }

  async #loadScene(
    entry: string, overrides: ReadonlyMap<string, ObjectMaterialOverride>, preserveCamera: boolean,
    options: SceneLoadOptions, sink: DiagnosticSink, loadStarted: number,
  ): Promise<void> {
    const preview: PreviewState | undefined = this.#streaming && this.#context && !/(?:^|\/)scene\.json(?:[?#]|$)/i.test(entry)
      ? {
        cancelled: false, building: undefined, shown: false, lastEnd: 0, lastCost: 0,
        images: undefined, firstFrame: undefined, preserveCamera, options, sink, loadStarted,
      }
      : undefined;
    const loadOptions: SceneLoadOptions = preview ? { ...options, progress: {
      wanted: ready => this.#previewWanted(preview, ready),
      partial: (scene, pending) => this.#showPreview(preview, scene, pending),
      // Geometry work blocks the thread: it waits until the first preview is on screen.
      pause: () => (preview.shown ? preview.firstFrame : preview.building),
      // So does the MaterialX runtime: it starts after the first preview, once the geometry is
      // complete (then it is the critical path), or after a short delay.
      // Cached geometry is fast: the MaterialX runtime becomes the critical path.
      geometryCached: () => preview.releaseMaterials?.(),

      materialsGate: () => (this.#backend === 'disney' ? Promise.resolve() : new Promise<void>(resolve => {
        preview.releaseMaterials = resolve;
        setTimeout(resolve, PREVIEW_MATERIALS_DELAY_MS);
      })),
    } } : options;
    let loaded: LoadedUsdScene;
    try {
      loaded = this.#withTextureLimits(await this.#loadEntry(entry, overrides, loadOptions, sink));
      if (preview) await this.#finishPreview(preview, loaded);
    } catch (error) {
      if (preview) {
        preview.cancelled = true;
        await preview.building;
        this.#loadingProgress = undefined;
        if (preview.shown) {
          this.#current?.dispose();
          this.#current = null;
        }
      }
      throw error;
    }
    const exposure = loaded.cameras[0]?.exposure ?? 0;
    let frame: SceneFramePlan;
    let render: SceneRender;
    try {
      if (this.#disposed) throw new Error('Viewer disposed during load.');
      if (overrides.size > 0 && loaded.resources.pendingMaterials.length > 0) {
        throw new Error('MaterialX compilation failed.');
      }
      frame = this.#planFrame(loaded, exposure);
      // Pipelines are only reclaimed by GC: drop the old set before compiling the new one
      // (a streaming preview stays on screen until the final set replaces it).
      if (!preview?.shown) {
        this.#current?.dispose();
        this.#current = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (this.#disposed) throw new Error('Viewer disposed during load.');
      const gpuBuildStarted = performance.now();
      render = await this.#buildSceneRender(loaded, frame, exposure, sink);
      performance.measure('viewer:raster-build', { start: gpuBuildStarted, end: performance.now(), detail: { entry } });
    } catch (error) {
      loaded.mtlx.documents?.delete();
      if (preview?.shown) {
        this.#current?.dispose();
        this.#current = null;
      }
      this.#loadingProgress = undefined;
      throw error;
    }
    if (this.#disposed) {
      render.dispose();
      loaded.mtlx.documents?.delete();
      throw new Error('Viewer disposed during load.');
    }
    this.#current?.dispose();
    this.#current = render;
    this.#loadingProgress = undefined;
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
    if (!preserveCamera) this.#placeCamera(loaded, frame, options);
    this.#detachControls();
    this.#detachControls = this.#bindOrbitControls();
    this.#baseTransforms = new Map(loaded.resources.instances.map(instance => [instance.id, instance.transform]));
    if (!this.#keepDynamicOverrides) {
      this.#transformOverrides.clear();
      this.#visibilityOverrides.clear();
      this.#lightOverrides.clear();
    }
    this.#time = loaded.animation?.time ?? 0;
    this.#sceneCameraKey = loaded.cameras[0] ? sceneCameraKey(loaded.cameras[0]) : undefined;
    this.#applyDynamicState(false);
    this.#onCameraChanged();
    this.#emitStatus();
    if (await this.#applyMaterialAnimation()) this.#applyDynamicState(false, true);
    await this.#applyTopologyChanges();
    await this.#updateCameraAdaptiveSubdivision();
  }

  #previewWanted(state: PreviewState, readyGeometries: number): boolean {
    if (state.cancelled || state.building || this.#disposed || this.#backend === 'disney') return false;
    if (!state.shown) return readyGeometries >= 1 && performance.now() - state.loadStarted >= PREVIEW_FIRST_DELAY_MS;
    return performance.now() - state.lastEnd >= Math.max(PREVIEW_MIN_INTERVAL_MS, PREVIEW_COST_FACTOR * state.lastCost);
  }

  /** Builds and shows a partial scene; superseded or failed previews are dropped. */
  #showPreview(state: PreviewState, partial: LoadedUsdScene, pendingGeometry: number): void {
    state.building = (async () => {
      const started = performance.now();
      // While geometry arrives, previews use neutral surfaces: one pipeline, cheap to rebuild.
      // Material pipelines depend on each draw's vertex layout, so they are compiled once the
      // geometry is complete, by the textures-stage preview or the final scene.
      const neutral = pendingGeometry > 0 && partial.resources.materials.size > 0;
      const snapshot = (state.images ?? new StreamingImages({ decode: () => undefined })).snapshot(PREVIEW_TEXTURE_SIZE);
      const candidate = this.#withTextureLimits({
        ...partial,
        ...(neutral ? { resources: {
          ...partial.resources, materials: new Map(),
          instances: partial.resources.instances.map(({ materialKey: _materialKey, ...instance }) => instance),
        } } : {}),
        mtlx: { ...partial.mtlx, imageProvider: snapshot, ...(neutral ? { surfaceFor: () => NEUTRAL_SURFACE } : {}) },
      }, false);
      const exposure = candidate.cameras[0]?.exposure ?? 0;
      const frame = this.#planFrame(candidate, exposure);
      if (!state.shown) {
        this.#current?.dispose();
        this.#current = null;
      }
      const render = await this.#buildSceneRender(candidate, frame, exposure, state.sink, true);
      if (state.cancelled || this.#disposed) {
        render.dispose();
        return;
      }
      this.#current?.dispose();
      this.#current = render;
      if (!state.shown) {
        state.shown = true;
        if (!state.preserveCamera) this.#placeCamera(candidate, frame, state.options);
        this.#firstPreviewStart = state.loadStarted;
        // A hidden page never presents: do not hold the load longer than the timeout.
        state.firstFrame = Promise.race([
          new Promise<void>(resolve => { this.#firstPreviewPresented = resolve; }),
          new Promise<void>(resolve => setTimeout(resolve, PREVIEW_FRAME_TIMEOUT_MS)),
        ]).then(() => {
          state.firstFrame = undefined;
          state.releaseMaterials?.();
        });
      }
      this.#loadingProgress = {
        stage: candidate.resources.materials.size === 0 ? 'geometry' : 'textures',
        pendingGeometry, pendingTextures: state.images?.progress.pending ?? 0,
      };
      this.#onCameraChanged();
      this.#emitStatus();
      state.lastCost = performance.now() - started;
      state.lastEnd = performance.now();
      performance.measure('viewer:preview-build', { start: started, end: state.lastEnd,
        detail: { stage: this.#loadingProgress.stage, pendingGeometry, sinceLoad: started - state.loadStarted } });
    })().catch((error: unknown) => {
      if (!state.cancelled && !this.#disposed) {
        state.sink({ level: 'warning', code: 'streaming-preview-failed',
          message: `Streaming preview failed: ${error instanceof Error ? error.message : String(error)}` });
      }
    }).finally(() => { state.building = undefined; });
  }

  /**
   * Geometry and materials are complete: textures start decoding (not earlier, so they do not
   * compete with geometry downloads). If some are still missing once a preview is built, the
   * complete scene is shown with the textures decoded so far (UDIM tiles one by one), then
   * refreshed as they arrive. The preview's pipelines are the final scene's.
   */
  async #finishPreview(state: PreviewState, loaded: LoadedUsdScene): Promise<void> {
    await state.building;
    const images = state.images = new StreamingImages(loaded.mtlx.imageProvider);
    images.prefetch(sceneTextureFiles(loaded.resources));
    await Promise.race([images.settled(), new Promise(resolve => setTimeout(resolve, PREVIEW_TEXTURE_WAIT_MS))]);
    // Disney has no previews.
    let first = this.#backend !== 'disney';
    while (images.progress.pending > 0 && !this.#disposed) {
      if (first || (this.#backend !== 'disney' && this.#previewWanted(state, Infinity))) {
        first = false;
        this.#showPreview(state, loaded, 0);
        await state.building;
      }
      await Promise.race([images.settled(), new Promise(resolve => setTimeout(resolve, 250))]);
    }
    state.cancelled = true;
    await state.building;
  }

  #planFrame(loaded: LoadedUsdScene, exposure: number): SceneFramePlan {
    const env = loaded.environment;
    const environment = env
      ? { radiance: env.averageRadiance, tint: env.tint, intensity: env.intensity, hasTexture: true, sh: env.sh }
      : { radiance: pathTraceSettings(loaded.scene).converted ? [0, 0, 0] as Vec3 : PREVIEW_ENV };
    Object.assign(environment, { enabled: this.#environmentEnabled });
    return buildSceneFrame(loaded.resources, {
      lights: loaded.lights,
      frameCamera: previewCamera(this.#width / this.#height, exposure),
      environment,
      surfaceFor: loaded.mtlx.surfaceFor,
    });
  }

  #placeCamera(loaded: LoadedUsdScene, frame: SceneFramePlan, options: SceneLoadOptions): void {
    const bounds = loaded.resources.tlas.bounds;
    const center: Vec3 = [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
    const camera = loaded.cameras[0];
    if (camera) {
      this.#orbitFromSceneCamera(camera, loaded, center);
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

  #orbitFromSceneCamera(camera: SceneCamera, loaded: LoadedUsdScene, center: Vec3): void {
    const transform = camera.transform;
    const eye: Vec3 = [transform[12]!, transform[13]!, transform[14]!];
    const distance = Math.hypot(eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]) || 1;
    const axisLength = Math.hypot(transform[8]!, transform[9]!, transform[10]!) || 1;
    const target: Vec3 = [
      eye[0] - transform[8]! * distance / axisLength,
      eye[1] - transform[9]! * distance / axisLength,
      eye[2] - transform[10]! * distance / axisLength,
    ];
    const near = this.#orbit.near, far = this.#orbit.far;
    this.#orbit = OrbitCamera.fromEyeTarget(eye, target, this.#width / this.#height, cameraFovY(camera, this.#width / this.#height) || 0.62);
    if (pathTraceSettings(loaded.scene).converted) this.#orbit.projection = camera.projection;
    if (this.#loaded === loaded) { this.#orbit.near = near; this.#orbit.far = far; }
  }

  #hasCameraAdaptivePlanes(loaded = this.#loaded): boolean {
    return !!loaded?.parameterResources && [...loaded.scene.prims.values()].some(prim => {
      const shape = primitiveShapeOf(prim);
      return shape?.kind === 'plane' && (shape.maxScreenEdgeLength ?? 0) > 0;
    });
  }

  #scheduleCameraAdaptiveSubdivision(): void {
    if (!this.#hasCameraAdaptivePlanes() || this.#disposed) return;
    if (this.#adaptiveCameraTimer !== undefined) clearTimeout(this.#adaptiveCameraTimer);
    this.#adaptiveCameraTimer = setTimeout(() => {
      this.#adaptiveCameraTimer = undefined;
      void this.#updateCameraAdaptiveSubdivision().catch(error => {
        this.#diagnosticSink()({
          level: 'error', code: 'camera-adaptive-subdivision-failed',
          message: 'Camera-adaptive plane subdivision failed.',
          detail: error instanceof Error ? error.message : String(error),
        });
      });
    }, 120);
  }

  async #updateCameraAdaptiveSubdivision(): Promise<void> {
    if (this.#adaptiveCameraTimer !== undefined) {
      clearTimeout(this.#adaptiveCameraTimer);
      this.#adaptiveCameraTimer = undefined;
    }
    if (this.#adaptiveCameraUpdating) {
      this.#adaptiveCameraPending = true;
      return;
    }
    if (!this.#hasCameraAdaptivePlanes()) return;

    this.#adaptiveCameraUpdating = true;
    try {
      do {
        this.#adaptiveCameraPending = false;
        const loaded = this.#loaded;
        const current = this.#current;
        const base = loaded?.parameterResources;
        if (!loaded || !current || !base) return;
        const camera = {
          viewProjection: this.#orbit.viewProj(),
          viewport: [this.#width, this.#height] as const,
        };
        const animatedTransforms = loaded.animation
          ? animateScene(loaded.animation.source, this.#time, base).transforms : undefined;
        const geometries = new Map(base.geometries);
        let changedGeometries = 0;
        let changedVertices = 0;
        for (const geometry of base.geometries.values()) {
          const prim = loaded.scene.prims.get(geometry.primPath);
          const shape = prim ? primitiveShapeOf(prim) : undefined;
          if (!prim || shape?.kind !== 'plane' || !(shape.maxScreenEdgeLength && shape.maxScreenEdgeLength > 0)) continue;
          const instances = base.instances.filter(instance => instance.prototypeId === geometry.prototypeId);
          if (instances.length === 0) continue;
          const modelTransforms = instances.map(instance =>
            this.#transformOverrides.get(instance.primPath) ?? this.#transformOverrides.get(instance.id)
            ?? animatedTransforms?.get(instance.id) ?? instance.transform);
          const raw = gprimToMesh(prim, { ...camera, modelTransforms });
          if (!raw) throw new Error(`Camera-adaptive plane mesh is unavailable: ${prim.path}`);
          const hasDisplacement = instances.some(instance =>
            instance.materialKey && base.materials.get(instance.materialKey)?.displacement);
          const prepared = prepareMesh(raw, { computeTangents: true, hasDisplacement });
          const oldPositions = geometry.streams.find(stream => stream.name === 'position')?.data;
          const samePositions = !!oldPositions && oldPositions.length === prepared.positions.length
            && oldPositions.every((value, index) => value === prepared.positions[index]);
          const sameIndices = geometry.indices.length === prepared.indices.length
            && geometry.indices.every((value, index) => value === prepared.indices[index]);
          if (samePositions && sameIndices) continue;
          geometries.set(geometry.prototypeId, buildGeometry(geometry.prototypeId, geometry.primPath, prepared));
          changedGeometries++;
          changedVertices += prepared.positions.length / 3;
        }
        if (changedGeometries === 0) continue;

        const started = performance.now();
        const parameterResources = { ...base, geometries };
        const resources = await applySceneDisplacement(parameterResources, loaded.mtlx.imageProvider, this.#device);
        const candidate = { ...loaded, resources, parameterResources };
        delete candidate.compiled;
        await this.#replaceLoaded(loaded, candidate, 'Scene changed during camera-adaptive subdivision.', () => {
          if (this.#loaded !== loaded || this.#current !== current) {
            throw new Error('Scene changed during camera-adaptive subdivision.');
          }
        });
        performance.measure('viewer:adaptive-subdivision', {
          start: started, end: performance.now(),
          detail: { mode: 'camera', geometries: changedGeometries, vertices: changedVertices },
        });
      } while (this.#adaptiveCameraPending && !this.#disposed);
    } finally {
      this.#adaptiveCameraUpdating = false;
    }
  }

  #onCameraChanged(resetAccumulation = true): void {
    if (!this.#current) return;
    this.#clearDenoiserComparison();
    if (resetAccumulation) this.#lastCameraChange = performance.now();
    this.#current.applyCamera(this.#orbit.viewProj(), this.#orbit.eye, inverse4(this.#orbit.backgroundViewProj()));
    this.#rasterDirty = true;
    this.#ptDisplayDirty = true;
    if (resetAccumulation && (this.#backend === 'pathtracing' || this.#backend === 'disney')) this.#current.resetPathTrace();
  }

  // --- Dynamic scenes -------------------------------------------------------

  /** Time range of an animated stage (time-sampled attributes or transforms). */
  get timeline(): SceneTimeline | undefined {
    const source = this.#loaded?.animation?.source;
    return source ? sceneTimeline(source) : undefined;
  }

  get time(): number { return this.#time; }

  /** Resolves every time-sampled transform, visibility, light, camera and point at `time`. */
  async setTime(time: number, options: { keepAccumulation?: boolean } = {}): Promise<void> {
    if (!Number.isFinite(time)) throw new RangeError('The time code must be finite.');
    if (!this.#loaded) throw new Error('No scene loaded.');
    this.#time = time;
    const materialsChanged = await this.#applyMaterialAnimation();
    if (this.#time !== time) return;
    this.#applyDynamicState(options.keepAccumulation ?? false, materialsChanged);
    await this.#applyTopologyChanges();
    await this.#updateCameraAdaptiveSubdivision();
  }

  /**
   * Material values driven by the time code: the hidden clock of `time`/`frame`
   * nodes and time-sampled UsdPreviewSurface inputs, by object path.
   */
  #animatedMaterialChanges(): Map<string, Map<string, readonly number[]>> {
    const loaded = this.#loaded;
    const resources = loaded?.parameterResources;
    const result = new Map<string, Map<string, readonly number[]>>();
    if (!loaded || !resources) return result;
    const time = this.#time;
    const sampled = new Map<string, Map<string, readonly number[]>>();
    const source = loaded.animation?.source;
    for (const { material, id, attribute } of source ? sampledShaderInputs(source) : []) {
      const value = sampleAt(attribute.typeName, attribute.timeSamples!, time);
      const numbers = typeof value === 'number' ? [value] : Array.isArray(value) ? value.map(Number) : undefined;
      if (!numbers?.every(Number.isFinite)) continue;
      const inputs = sampled.get(material) ?? new Map<string, readonly number[]>();
      inputs.set(id, numbers);
      sampled.set(material, inputs);
    }
    for (const instance of resources.instances) {
      const material = instance.materialKey ? resources.materials.get(instance.materialKey) : undefined;
      if (!material?.parameters) continue;
      const changes = new Map<string, readonly number[]>();
      const inputs = instance.materialPath ? sampled.get(instance.materialPath) : undefined;
      for (const parameter of material.parameters) {
        const value = parameter.clock ? [time] : inputs?.get(parameter.id);
        if (!value || value.length !== parameter.value.length) continue;
        if (value.some((component, i) => component !== parameter.value[i])) changes.set(parameter.id, value);
      }
      if (changes.size > 0) result.set(instance.primPath, changes);
    }
    return result;
  }

  #pendingTopology: Map<string, PreparedMesh> | undefined;
  #topologyBusy = false;

  /**
   * Meshes whose triangulation changed at the current time code: their geometry is
   * replaced and the render set rebuilt (shader and geometry caches keep it short).
   */
  async #applyTopologyChanges(): Promise<boolean> {
    if (this.#topologyBusy || !this.#pendingTopology) return false;
    this.#topologyBusy = true;
    try {
      while (this.#pendingTopology && !this.#disposed) {
        const pending = this.#pendingTopology;
        this.#pendingTopology = undefined;
        const loaded = this.#loaded;
        if (!loaded) break;
        const replace = (geometries: ReadonlyMap<string, GeometryResource>): Map<string, GeometryResource> => {
          const next = new Map(geometries);
          for (const [id, prepared] of pending) {
            const current = next.get(id);
            if (current) next.set(id, buildGeometry(id, current.primPath, prepared));
          }
          return next;
        };
        const candidate: LoadedUsdScene = {
          ...loaded, resources: { ...loaded.resources, geometries: replace(loaded.resources.geometries) },
          ...(loaded.parameterResources ? {
            parameterResources: { ...loaded.parameterResources, geometries: replace(loaded.parameterResources.geometries) },
          } : {}),
        };
        delete candidate.compiled;
        // Re-applies the dynamic state, which queues another change if the time moved on.
        await this.#replaceLoaded(loaded, candidate, 'Scene changed during a topology update.');
      }
    } finally {
      this.#topologyBusy = false;
    }
    return true;
  }

  #materialAnimationBusy = false;
  #materialAnimationPending = false;

  /** Applies #animatedMaterialChanges (uniform updates, or rebuilds when a lobe appears/disappears). */
  async #applyMaterialAnimation(): Promise<boolean> {
    if (this.#materialAnimationBusy) {
      this.#materialAnimationPending = true;
      return false;
    }
    this.#materialAnimationBusy = true;
    let changed = false;
    try {
      do {
        this.#materialAnimationPending = false;
        for (const [path, changes] of this.#animatedMaterialChanges()) {
          changed = true;
          await this.#setObjectParameters(path, changes, false);
        }
      } while (this.#materialAnimationPending && !this.#disposed);
    } finally {
      this.#materialAnimationBusy = false;
    }
    return changed;
  }

  /** Overrides an object's world transform (column-major 4x4); omit it to restore the scene's. */
  setObjectTransform(path: string, matrix?: readonly number[]): void {
    this.#requireInstance(path);
    if (matrix === undefined) this.#transformOverrides.delete(path);
    else {
      if (matrix.length !== 16 || !matrix.every(Number.isFinite)) throw new RangeError('A transform is 16 finite numbers.');
      this.#transformOverrides.set(path, [...matrix]);
    }
    this.#applyDynamicState(false);
    this.#scheduleCameraAdaptiveSubdivision();
  }

  /** Shows or hides an object; omit the flag to restore the scene's visibility. */
  setObjectVisible(path: string, visible?: boolean): void {
    this.#requireInstance(path);
    if (visible === undefined) this.#visibilityOverrides.delete(path);
    else this.#visibilityOverrides.set(path, visible);
    this.#applyDynamicState(false);
  }

  get lights(): ReadonlyArray<{ path: string; type: string }> {
    return (this.#loaded?.lights ?? []).map(light => ({ path: light.path, type: light.type }));
  }

  /** Changes a light; omit the changes to restore the scene's values. */
  setLight(path: string, changes?: LightChanges): void {
    if (!this.#loaded?.lights.some(light => light.path === path)) throw new Error(`Unknown light: ${path}`);
    if (changes?.transform && (changes.transform.length !== 16 || !changes.transform.every(Number.isFinite))) {
      throw new RangeError('A transform is 16 finite numbers.');
    }
    if (changes === undefined) this.#lightOverrides.delete(path);
    else this.#lightOverrides.set(path, { ...this.#lightOverrides.get(path), ...changes });
    this.#applyDynamicState(false);
  }

  /** Places the camera; field of view in radians (vertical). */
  async setCamera(camera: { eye: readonly number[]; target: readonly number[]; fovY?: number }): Promise<void> {
    const eye = camera.eye, target = camera.target;
    if (eye.length !== 3 || target.length !== 3 || ![...eye, ...target].every(Number.isFinite)
      || (camera.fovY !== undefined && !(camera.fovY > 0 && camera.fovY < Math.PI))) {
      throw new RangeError('The camera needs a finite eye, target and a field of view in (0, pi).');
    }
    const near = this.#orbit.near, far = this.#orbit.far, projection = this.#orbit.projection;
    this.#orbit = OrbitCamera.fromEyeTarget([eye[0]!, eye[1]!, eye[2]!], [target[0]!, target[1]!, target[2]!],
      this.#width / this.#height, camera.fovY ?? this.#orbit.fovY, near, far);
    this.#orbit.projection = projection;
    this.#detachControls();
    this.#detachControls = this.#bindOrbitControls();
    this.#onCameraChanged();
    await this.#updateCameraAdaptiveSubdivision();
  }

  /** Variant sets authored in the scene, by prim path. */
  get variantSets(): ReadonlyArray<{ path: string; set: string; variants: readonly string[]; selection?: string }> {
    const scene = this.#loaded?.scene;
    if (!scene) return [];
    return [...scene.prims.values()].flatMap(prim => [...prim.variantSets ?? []].map(([set, info]) => ({
      path: prim.path, set, variants: info.variants, ...(info.selection !== undefined ? { selection: info.selection } : {}),
    })));
  }

  /** Selects a variant: the stage is recomposed and reloaded, keeping the camera, time and overrides. */
  async setVariant(path: string, set: string, variant: string): Promise<void> {
    const entry = this.#sceneEntry;
    const info = this.variantSets.find(candidate => candidate.path === path && candidate.set === set);
    if (!entry || !info) throw new Error(`Unknown variant set '${set}' on ${path}.`);
    if (!info.variants.includes(variant)) throw new Error(`Unknown variant '${variant}' in set '${set}'.`);
    const selections = new Map([...this.#loadOptions.variantSelections ?? []].map(([prim, map]) => [prim, new Map(map)]));
    selections.set(path, new Map([...selections.get(path) ?? [], [set, variant]]));
    const time = this.#time;
    this.#keepDynamicOverrides = true;
    try {
      await this.load(entry, this.#materialOverrides, true, { ...this.#loadOptions, variantSelections: selections, time });
    } finally {
      this.#keepDynamicOverrides = false;
    }
  }

  get pathTracingTemporalHistory(): number { return this.#pathTracingTemporalHistory; }

  /** After a dynamic change, keep up to `samples` accumulated samples per pixel (0 restarts). */
  setPathTracingTemporalHistory(samples: number): void {
    if (!Number.isInteger(samples) || samples < 0) throw new RangeError('The temporal history is a non-negative integer.');
    this.#pathTracingTemporalHistory = samples;
  }

  #requireInstance(path: string): void {
    if (!this.#baseTransforms.has(path)) throw new Error(`Unknown object: ${path}`);
  }

  #applyDynamicState(keepAccumulation: boolean, materialsChanged = false): void {
    const loaded = this.#loaded;
    const render = this.#current;
    if (!loaded || !render) return;
    const sink = this.#diagnosticSink();
    const state = loaded.animation
      ? animateScene(loaded.animation.source, this.#time, loaded.resources, {
        sink, meshFor: (scene, primPath) => meshSourceFromScene(scene).meshFor(primPath),
      })
      : undefined;
    this.#pendingTopology = state?.retopologized.size ? state.retopologized : undefined;
    const transforms = new Map(state?.transforms ?? this.#baseTransforms);
    for (const [path, matrix] of this.#transformOverrides) transforms.set(path, matrix);
    const hidden = new Set(state?.hidden ?? loaded.resources.instances
      .filter(instance => isInvisible(loaded.scene, instance.primPath)).map(instance => instance.id));
    for (const [path, visible] of this.#visibilityOverrides) {
      if (visible) hidden.delete(path);
      else hidden.add(path);
    }
    const lights = (state?.lights ?? loaded.lights).map(light => {
      const changes = this.#lightOverrides.get(light.path);
      return changes ? { ...light, ...changes } : light;
    });
    const camera = state?.camera;
    const cameraKey = camera ? sceneCameraKey(camera) : undefined;
    const cameraChanged = camera !== undefined && cameraKey !== this.#sceneCameraKey;
    render.applyDynamics({ transforms, hidden, lights, geometry: state?.deformed ?? new Map(), keepAccumulation, cameraChanged, materialsChanged });
    if (!keepAccumulation) this.#lastCameraChange = performance.now();
    if (cameraChanged) {
      this.#sceneCameraKey = cameraKey;
      const bounds = loaded.resources.tlas.bounds;
      this.#orbitFromSceneCamera(camera, loaded, [(bounds.min[0] + bounds.max[0]) / 2, (bounds.min[1] + bounds.max[1]) / 2, (bounds.min[2] + bounds.max[2]) / 2]);
      // applyDynamics already aged or restarted the path tracer; Disney still restarts on camera moves.
      this.#onCameraChanged(!keepAccumulation && this.#backend === 'disney');
      this.#scheduleCameraAdaptiveSubdivision();
    }
  }

  #emitStatus(): void {
    if (!this.#onStatus || !this.#current) return;
    const convergence = this.#current.pathTraceConvergence();
    const convergenceError = this.#current.pathTraceConvergenceError();
    const progress = this.#current.pathTraceProgress();
    const fallback = this.#current.fallback();
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
      ...(fallback && fallback.from === this.#backend ? { fallback } : {}),
      ...(this.#loadingProgress ? { loading: this.#loadingProgress } : {}),
    });
  }

  #clearDenoiserComparison(): void {
    this.#pathTracingDenoiserComparison = false;
  }

  #bindOrbitControls(): () => void {
    return this.#orbitControls && this.#canvas
      ? attachOrbitControls(this.#canvas, this.#orbit, () => {
        this.#onCameraChanged();
        this.#scheduleCameraAdaptiveSubdivision();
      })
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

  /**
   * With a shutter interval, samples are spread over `steps` stratified, jittered
   * time codes (Monte Carlo motion blur of transforms, cameras, lights and points),
   * accumulated together; the scene is then restored to its current time.
   */
  async renderPathTraceTo(
    targetView: GPUTextureView, samples: number, shutter?: { open: number; close: number; steps?: number },
  ): Promise<void> {
    const current = this.#current;
    if (!current) throw new Error('A loaded scene is required.');
    // On a canvas, the interactive loop is suspended and its accumulation restarts afterwards.
    this.#capturing++;
    try {
      await this.#capturePathTrace(current, targetView, samples, shutter);
    } finally {
      this.#capturing--;
      if (this.#context && current === this.#current) {
        current.resetPathTrace();
        this.#ptDisplayDirty = true;
        this.#emitStatus();
      }
    }
  }

  async #capturePathTrace(
    current: SceneRender, targetView: GPUTextureView, samples: number, shutter?: { open: number; close: number; steps?: number },
  ): Promise<void> {
    if (!shutter) {
      await current.capturePathTrace(targetView, samples);
      return;
    }
    if (!Number.isFinite(shutter.open) || !Number.isFinite(shutter.close) || shutter.close < shutter.open) {
      throw new RangeError('The shutter needs finite open <= close time codes.');
    }
    const steps = Math.max(1, Math.min(samples, Math.floor(shutter.steps ?? 16)));
    const time = this.#time;
    try {
      for (let step = 0; step < steps; step++) {
        const share = Math.floor(samples * (step + 1) / steps) - Math.floor(samples * step / steps);
        this.#time = shutter.open + (step + Math.random()) / steps * (shutter.close - shutter.open);
        await this.#applyMaterialAnimation();
        this.#applyDynamicState(step > 0);
        if (share > 0) await current.capturePathTrace(step === steps - 1 ? targetView : undefined, share, undefined, { reset: step === 0 });
      }
    } finally {
      this.#time = time;
      await this.#applyMaterialAnimation();
      this.#applyDynamicState(true);
      await this.#applyTopologyChanges();
    }
  }

  #renderNextFrame = (): void => {
    const context = this.#context;
    if (this.#disposed || !context) return;
    const current = this.#current;
    if (current && !this.#framePending && this.#capturing === 0) {
      let submitted = false;
      const started = performance.now();
      // A backend that exceeds a GPU limit is drawn by raster (status.fallback).
      const backend = current.fallback()?.from === this.#backend ? 'raster' : this.#backend;
      const pathTracingFrame = backend === 'pathtracing' || backend === 'disney';
      const denoising = current.denoiserStatus().state === 'running';
      const stopped = current.pathTraceProgress()?.stopReason !== undefined;
        if (backend === 'pathtracing' && ((!this.#pathTracingPaused && !denoising && !stopped) || this.#ptDisplayDirty)) {
        const tiled = performance.now() - this.#lastCameraChange >= 200;
        current.renderPathTrace(context.getCurrentTexture().createView(), tiled, !this.#pathTracingPaused && !denoising && !stopped);
        this.#ptDisplayDirty = false;
        submitted = true;
        this.#emitStatus();
        } else if (backend === 'disney' && (this.#ptDisplayDirty ||
          (!this.#pathTracingPaused && (current.pathTracerState() === 'idle' || current.pathTracerState() === 'ready')))) {
          current.renderDisney(context.getCurrentTexture().createView(), !this.#pathTracingPaused);
          this.#ptDisplayDirty = false;
          submitted = true;
          this.#emitStatus();
      } else if (backend === 'raster' && this.#rasterDirty) {
        this.#rasterDirty = false;
        current.renderRaster(context.getCurrentTexture().createView());
        submitted = true;
        this.#emitStatus();
      }
      if (submitted) {
        const firstFrameStart = this.#firstFrameStart;
        this.#firstFrameStart = undefined;
        const firstPreviewStart = this.#firstPreviewStart;
        this.#firstPreviewStart = undefined;
        this.#framePending = true;
        void this.#device.queue.onSubmittedWorkDone().then(() => {
          if (firstPreviewStart !== undefined) {
            performance.measure('viewer:first-preview', { start: firstPreviewStart, end: performance.now(),
              detail: { entry: this.#sceneEntry, backend: this.#backend } });
            this.#firstPreviewPresented?.();
            this.#firstPreviewPresented = undefined;
          }
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
    preview = false,
  ): Promise<SceneRender> {
    const trash: Array<{ destroy(): void }> = [];
    try {
      return await this.#createSceneRender(loaded, frame, exposure, sink, trash, preview);
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
    preview: boolean,
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
    // Dynamic scene state (setTime, transforms, visibility, lights): see applyDynamics.
    const hiddenInstances = new Set<string>();
    const callInstance = new WeakMap<SceneDrawCall, string>();
    let currentLights: readonly SceneLight[] = loaded.lights;
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
    const release = (resource: { destroy(): void }): void => {
      const index = trash.indexOf(resource);
      if (index >= 0) trash.splice(index, 1);
      resource.destroy();
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
      const materialTextures = new Map<string, {
        textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler>; textures: GPUTexture[];
      }>();
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
        if (!file) throw new Error('Raster height-map displacement requires an image file.');
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
      type RasterDraw = {
        draw: SceneFramePlan['draws'][number];
        call: SceneDrawCall;
        frameUniform: typeof frameUniforms[number];
        materialUniform: GPUBuffer;
      };
      type RasterSet = { backend: RasterBackend; draws: Map<ScenePassKind, SceneDrawCall[]>; entries: RasterDraw[] };
      const rasterSets = new Map<RasterQuality, RasterSet>();
      let rasterOperation: Promise<void> = Promise.resolve();
      const serializeRaster = <T>(operation: () => Promise<T>): Promise<T> => {
        const result = rasterOperation.then(operation);
        rasterOperation = result.then(() => {}, () => {});
        return result;
      };
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
        const entries: RasterDraw[] = [];
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
          const frameEntry = { buffer: frameUniform, draw };
          frameUniforms.push(frameEntry);
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
          const call: SceneDrawCall = {
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
          };
          callInstance.set(call, draw.instanceId);
          list.push(call);
          entries.push({ draw, call, frameUniform: frameEntry, materialUniform });
          nextDraws.set(draw.pass, list);
        }
        rasterSets.set(quality, { backend: nextBackend, draws: nextDraws, entries });
        backend = nextBackend;
        drawsByPass = nextDraws;
      };
      await buildRasterQuality(rasterQuality);

      const updateRasterTopology = (
        key: string, material: MaterialResource, nextFrame: SceneFramePlan, check: () => void, commit: () => void,
      ): Promise<void> => serializeRaster(async () => {
        const previous = resources.materials.get(key);
        if (!previous || !material.surfaceModule || !material.sceneShader) {
          throw new Error(`Missing editable raster material: ${key}`);
        }
        const sameTextures = JSON.stringify([previous.surfaceModule?.textures, previous.surfaceModule?.samplers])
          === JSON.stringify([material.surfaceModule.textures, material.surfaceModule.samplers]);
        const staged: Array<{ destroy(): void }> = [];
        let nextTextures = sameTextures ? materialTextures.get(key) : undefined;
        let committed = false;
        try {
          if (!sameTextures && material.surfaceModule.textures.length > 0) {
            nextTextures = await uploadMaterialTextures(device, material, loaded.mtlx.imageProvider, imageCache);
            staged.push(...nextTextures.textures);
          }
          const replacements: Array<{ set: RasterSet; old: RasterDraw; next: RasterDraw; inverseData: Float32Array }> = [];
          for (const [quality, set] of rasterSets) {
            const affected = set.entries.filter(entry => entry.draw.materialKey === key);
            if (affected.length === 0) continue;
            const nextDraws = affected.map(entry => {
              const draw = nextFrame.draws.find(candidate => candidate.instanceId === entry.draw.instanceId);
              if (!draw || draw.materialKey !== key || draw.prototypeId !== entry.draw.prototypeId) {
                throw new Error(`Geometry changed during material update: ${entry.draw.instanceId}`);
              }
              return draw;
            });
            const shader = assembleIrForwardShader(material.surfaceModule, {
              displacement: material.displacement !== undefined, rasterQuality: quality,
              analyticLights: rasterLights !== undefined,
            });
            const passes = [...new Set(nextDraws.map(draw => draw.pass))];
            const missing = passes.filter(pass => !set.backend.sceneVariantPipeline(pass, material.variant.pipelineKey));
            if (missing.length > 0) {
              const [compiled] = await compileShaderBatch(device, [{
                label: `Raster ${quality}: ${material.materialName}`, code: () => shader.code,
              }]);
              if (!compiled) throw new Error(`Missing compiled raster shader: ${material.materialName}`);
              if (disposed) throw new Error('Viewer disposed during raster compilation.');
              if (compiled.errors.length > 0) {
                rasterErrors = compiled.errors;
                this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
                throw new Error(`WGSL: ${rasterErrors.length} erreur(s) de compilation.`);
              }
              for (const pass of missing) {
                await set.backend.createSceneVariantPipelineAsync(
                  pass, material.variant.pipelineKey, shader.code, compiled.module, !!material.resolvedSurface?.backNodeId,
                );
              }
            }
            await withGpuValidation(device, () => {
              for (let index = 0; index < affected.length; index++) {
                const old = affected[index]!;
                const draw = nextDraws[index]!;
                const pipeline = set.backend.sceneVariantPipeline(draw.pass, material.variant.pipelineKey);
                if (!pipeline) throw new Error(`Missing raster pipeline: ${material.materialName}`);
                const data = material.parameters ? materialUniformData(material) : buildSceneMaterialUniform(draw);
                const materialUniform = device.createBuffer({
                  size: Math.max(SCENE_MATERIAL_UNIFORM_SIZE, data.byteLength),
                  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
                });
                staged.push(materialUniform);
                device.queue.writeBuffer(materialUniform, 0, data);
                const displacement = materialDisplacement.get(key);
                const groups = createSceneBindGroups(device, { ...material, sceneShader: shader }, {
                  frame: old.frameUniform.buffer, material: materialUniform,
                  ...(rasterLights ? { analyticLights: rasterLights } : {}),
                  ...(nextTextures ? { textureViews: nextTextures.textureViews, samplers: nextTextures.samplers } : {}),
                  ...(displacement ? { displacement } : {}),
                  ...(envTextureView && envSampler && envCdfBuffer
                    ? { environment: { textureView: envTextureView, sampler: envSampler, cdf: envCdfBuffer } } : {}),
                }, group => pipeline.getBindGroupLayout(group));
                const textureBindGroups = new Map<number, GPUBindGroup>();
                for (const [group, bindGroup] of groups.byGroup) {
                  if (bindGroup !== groups.materialBindGroup && bindGroup !== groups.frameBindGroup) {
                    textureBindGroups.set(group, bindGroup);
                  }
                }
                const { textureBindGroups: _oldTextures, ...call } = old.call;
                replacements.push({
                  set, old, inverseData: buildSceneFrameUniform(nextFrame, draw).subarray(92), next: {
                    draw, frameUniform: old.frameUniform, materialUniform,
                    call: { ...call, materialBindGroup: groups.materialBindGroup, frameBindGroup: groups.frameBindGroup,
                      pipelineKey: material.variant.pipelineKey,
                      ...(textureBindGroups.size > 0 ? { textureBindGroups } : {}) },
                  },
                });
              }
            });
          }

          check();
          for (const replacement of replacements) {
            device.queue.writeBuffer(replacement.next.frameUniform.buffer, 92 * 4, replacement.inverseData);
          }
          for (const resource of staged) track(resource);
          for (const set of rasterSets.values()) {
            const byOld = new Map(replacements.filter(entry => entry.set === set).map(entry => [entry.old, entry.next]));
            if (byOld.size === 0) continue;
            set.entries = set.entries.map(entry => byOld.get(entry) ?? entry);
            set.draws = new Map();
            for (const entry of set.entries) {
              entry.frameUniform.draw = entry.draw;
              const draws = set.draws.get(entry.draw.pass) ?? [];
              draws.push(entry.call);
              set.draws.set(entry.draw.pass, draws);
            }
            if (backend === set.backend) drawsByPass = set.draws;
          }
          if (material.parameters) parameterBuffers.set(key, replacements.map(entry => entry.next.materialUniform));
          else parameterBuffers.delete(key);
          for (const entry of replacements) release(entry.old.materialUniform);
          if (!sameTextures) {
            const oldTextures = materialTextures.get(key);
            if (nextTextures) materialTextures.set(key, nextTextures);
            else materialTextures.delete(key);
            for (const texture of oldTextures?.textures ?? []) release(texture);
          }
          committed = true;
          commit();
          rasterErrors = [];
          this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
        } finally {
          if (!committed) for (const resource of staged) resource.destroy();
          for (const set of rasterSets.values()) {
            set.backend.trimSceneVariantPipelines(
              set.entries.map(entry => ({ pass: entry.draw.pass, pipelineKey: entry.call.pipelineKey })),
              RASTER_UNUSED_VARIANT_LIMIT,
            );
          }
        }
      });

      const resolveUniform = track(device.createBuffer({ size: RESOLVE_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      device.queue.writeBuffer(resolveUniform, 0, new Float32Array([currentExposure, tonemapIndex(currentTonemap)]));
      const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
      let volumePipeline: GPURenderPipeline | undefined;
      const volumeEntries: GPUBindGroupEntry[] = [];
      let volumeScene: PathTraceScene | undefined;
      const volumeBuffers = new Map<number, GPUBuffer>();
      if ([...resources.materials.values()].some(material => material.volumeIr)) {
        volumeScene = loaded.compiled?.pathTrace ?? await buildCachedPathTraceScene(resources, {
          lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor,
          frameCamera: { viewProj: cameraViewProj, eye: cameraEye, exposure },
          environment: frame.environment, settings: pathTraceSettings(loaded.scene),
        });
        const hasVolumeGrid = volumeScene.volumeData !== undefined;
        const [compiled] = await compileShaderBatch(device, [{
          label: 'Raster volume',
          code: () => rasterVolumeWgsl(hasVolumeGrid, rasterLights !== undefined),
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
          volumeBuffers.set(binding, buffer);
        }
        volumeUniform = track(device.createBuffer({ size: RASTER_VOLUME_UNIFORM_BYTES,usage: GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST }));
        volumeEntries.push({ binding: 5,resource: { buffer: volumeUniform } });
        if (rasterLights) volumeEntries.push({ binding: 9,resource: { buffer: rasterLights } });
      }
      // The volume pass traces its own copy of the scene: moves, hidden objects and
      // deformations are refitted into it like the path tracer's (volume domains stay as loaded).
      let volumeDynamics: PathTraceDynamics | undefined;
      let volumeRebuild: Promise<void> | undefined;
      const writeVolume = (binding: number, data: Float32Array | Uint32Array, stride: number, [first, end]: [number, number]): void => {
        const buffer = volumeBuffers.get(binding);
        if (buffer && end > first) device.queue.writeBuffer(buffer, first * stride * 4, data, first * stride, (end - first) * stride);
      };
      const updateVolume = (ids: ReadonlySet<string>): void => {
        const scene = volumeScene;
        if (!scene || ids.size === 0) return;
        const updates = ptUpdatesFor(ids, scene);
        if (updates.length === 0) return;
        const dynamics = volumeDynamics ??= new PathTraceDynamics(scene);
        const upload = dynamics.update(updates);
        if (upload.triangles) writeVolume(2, scene.triangles, PT_TRIANGLE_FLOATS, upload.triangles);
        const runs = upload.nodes.length > 256 ? [[upload.nodes[0]![0], upload.nodes[upload.nodes.length - 1]![1]] as [number, number]] : upload.nodes;
        for (const run of runs) writeVolume(1, scene.nodes, PT_NODE_FLOATS, run);
        if (volumeRebuild || !dynamics.needsRebuild) return;
        volumeRebuild = rebuildBvhInBackground(scene.triangles, scene.triangleCount, dynamics.inflation).then(result => {
          // Adopted only when it fits the bound node buffer (the bind group is not rebuilt).
          if (disposed || volumeDynamics !== dynamics || result.nodes.byteLength > (volumeBuffers.get(1)?.size ?? 0)) return;
          dynamics.adopt(result.nodes, result.nodeCount, result.triangleOrder);
          writeVolume(1, scene.nodes, PT_NODE_FLOATS, [0, scene.nodeCount]);
          writeVolume(3, scene.triangleOrder, 1, [0, scene.triangleCount]);
          this.#rasterDirty = true;
        }, () => undefined).finally(() => { volumeRebuild = undefined; });
      };
      updateVolume(hiddenInstances);
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
            const all = drawsByPass.get(pass) ?? [];
            const draws = hiddenInstances.size === 0 ? all : all.filter(call => !hiddenInstances.has(callInstance.get(call) ?? ''));
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
        setQuality: (quality: RasterQuality) => serializeRaster(() => buildRasterQuality(quality)),
        updateTopology: updateRasterTopology,
        updateGeometry: (prototypeId: string, positions: Float32Array, normals: Float32Array): void => {
          const buffers = uploaded.get(prototypeId);
          const position = buffers?.vertexBuffers.get('position');
          const normal = buffers?.vertexBuffers.get('normal');
          if (position) device.queue.writeBuffer(position, 0, positions);
          if (normal) device.queue.writeBuffer(normal, 0, normals);
        },
        updateLights: (data: Float32Array): void => {
          if (rasterLights && rasterLights.size === data.byteLength) device.queue.writeBuffer(rasterLights, 0, data);
        },
        updateVolume,
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

    let fallback: BackendFallback | undefined;
    const fallBack = (from: BackendFallback['from'], error: GpuLimitError): void => {
      fallback = { from, to: 'raster', reason: error.message };
      this.#rasterDirty = true;
      this.#diagnosticSink()({
        level: 'warning', code: 'backend-fallback',
        message: `${from === 'disney' ? 'Disney path tracing' : 'Path tracing'} exceeds a GPU limit for this scene; rendering with raster instead. ${error.message}`,
        detail: { backend: from, limit: error.limit, required: error.required, available: error.available },
      });
    };
    const drawRaster = (targetView: GPUTextureView): void => {
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
    };

    let pathTraceBuildRevision = 0;
    let preparedPathTraceScene: PathTraceScene | undefined;
    const ptVariantCache: PtMaterialVariantCache = new Map();
    const ptGeometryBuffers = new Map<PtBufferRole, { data: Float32Array | Uint32Array; buffer: GPUBuffer }>();
    const reusablePtRoles = new Set<PtBufferRole>(['nodes', 'triangles', 'triangleOrder', 'triangleUv', 'triangleTangent']);
    const trackScene = track;

    // --- path tracer (built on first use: its pipeline costs ~230 MB of driver memory on mobile) ---
    const buildPathTracer = async (ptTrash: Array<{ destroy(): void }>, revision: number) => {
      const checkBuild = (): void => {
        if (disposed || revision !== pathTraceBuildRevision) throw new Error('Path tracer preparation was superseded.');
      };
      await new Promise((resolve) => setTimeout(resolve, 0));
      checkBuild();
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
        : preparedPathTraceScene
          ? buildPathTraceScene(resources, ptOptions, undefined, undefined, preparedPathTraceScene)
          // Partial streaming scenes stay out of the persistent BVH cache.
          : preview ? buildPathTraceScene(resources, ptOptions) : await buildCachedPathTraceScene(resources, ptOptions);
      checkBuild();
      performance.measure('pathtracing:scene-build', {
        start: pathTraceBuildStarted,
        end: performance.now(),
        detail: { triangles: ptScene.triangleCount, nodes: ptScene.nodeCount },
      });
      ptScene.environment.textureRadianceScale = envRadianceScale;
      ptScene.camera.backgroundInvViewProj = backgroundInvViewProj;
      const sourceDispatch = loaded.compiled?.dispatch ?? buildMaterialDispatch(ptScene.variantSources, ptVariantCache);
      const sourceBindings = await buildPtDeviceBindings(sourceDispatch, ptScene, loaded.mtlx.imageProvider, { sink });
      checkBuild();
      const { dispatch, bindings } = packPtTextureArrays(sourceDispatch, sourceBindings, device.limits.maxTextureArrayLayers);
      const storageSlots = bindings.group0.filter(slot => slot.usage === 'storage').length;
      // The environment CDF (group 3) is one more storage buffer in the same stage.
      assertStorageBufferCount(device, storageSlots + (envAsset ? 1 : 0), 'Path tracing');
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
            media: pathTraceHasMedia(ptScene.materials),
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
      checkBuild();
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
      checkBuild();
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
      checkBuild();
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
      const storage = (data: Float32Array | Uint32Array, role: PtBufferRole): GPUBuffer => {
        assertSceneStorageSize(device, Math.max(data.byteLength, 4));
        return device.createBuffer({ label: `Path tracing ${role}`,
          size: Math.max(data.byteLength, 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      };
      const storageData = (data: Float32Array | Uint32Array, role: PtBufferRole): GPUBuffer => {
        const cached = reusablePtRoles.has(role) ? ptGeometryBuffers.get(role) : undefined;
        if (cached?.data === data) return cached.buffer;
        const safe = data.byteLength > 0 ? data : data instanceof Uint32Array ? new Uint32Array(1) : new Float32Array(1);
        const buf = reusablePtRoles.has(role) ? trackScene(storage(safe, role)) : track(storage(safe, role));
        device.queue.writeBuffer(buf, 0, safe);
        if (reusablePtRoles.has(role)) {
          if (cached) release(cached.buffer);
          ptGeometryBuffers.set(role, { data, buffer: buf });
        }
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

      let uploadParameters: (() => void) | undefined;
      const group0Entries: GPUBindGroupEntry[] = bindings.group0.map((slot) => {
        if (slot.role === 'uniform') return { binding: slot.binding, resource: { buffer: ptUniform } };
        if (slot.role === 'accum') return { binding: slot.binding, resource: { buffer: accumBuffer } };
        if (slot.role === 'mxUniforms') {
          const data = ptParameterData();
          const mx = track(device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
          uploadParameters = () => device.queue.writeBuffer(mx, 0, ptParameterData());
          uploadParameters();
          return { binding: slot.binding, resource: { buffer: mx } };
        }
        return { binding: slot.binding, resource: { buffer: storageData(slot.data ?? new Float32Array(1), slot.role) } };
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

      // Observed-visibility light guide (light-guide.ts): gathered and rebuilt after each batch.
      const guideLightCount = ptScene.analyticLights && lightGuideEnabled(ptScene.analyticLightCount ?? 0)
        ? ptScene.analyticLightCount! : 0;
      const guideLightsEntry = group0Entries.find(entry => bindings.group0.find(slot => slot.binding === entry.binding)?.role === 'analyticLights');
      const guideLightsBuffer = guideLightsEntry ? (guideLightsEntry.resource as GPUBufferBinding).buffer : undefined;
      let lightGuide: {
        gather: GPUComputePipeline; build: GPUComputePipeline; counts: GPUBuffer; values: GPUBuffer;
        settings: GPUBuffer; accum?: GPUBuffer; group?: GPUBindGroup;
      } | undefined;
      if (guideLightCount > 0 && guideLightsBuffer) {
        const module = device.createShaderModule({ label: 'Path tracing light guide', code: lightGuideUpdateWgsl() });
        const storage = (binding: number): GPUBindGroupLayoutEntry => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } });
        const layout = device.createPipelineLayout({ bindGroupLayouts: [device.createBindGroupLayout({ entries: [
          storage(0), storage(1), storage(2), { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ] })] });
        const [gather, build] = await Promise.all(['mx_light_guide_gather', 'mx_light_guide_build'].map(entryPoint =>
          device.createComputePipelineAsync({ layout, compute: { module, entryPoint } })));
        checkBuild();
        const values = PT_LIGHT_GUIDE_CELLS * guideLightCount;
        lightGuide = {
          gather: gather!, build: build!,
          counts: track(device.createBuffer({ size: values * 8, usage: GPUBufferUsage.STORAGE })),
          values: track(device.createBuffer({ size: values * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC })),
          settings: track(device.createBuffer({ size: PT_LIGHT_GUIDE_SETTINGS_BYTES, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST })),
        };
      }
      const updateLightGuide = (encoder: GPUCommandEncoder): void => {
        if (!lightGuide || !guideLightsBuffer) return;
        if (lightGuide.accum !== accumBuffer) {
          // One explicit layout serves both entry points.
          lightGuide.accum = accumBuffer;
          lightGuide.group = device.createBindGroup({
            layout: lightGuide.gather.getBindGroupLayout(0),
            entries: [
              { binding: 0, resource: { buffer: accumBuffer } },
              { binding: 1, resource: { buffer: lightGuide.counts } },
              { binding: 2, resource: { buffer: lightGuide.values } },
              { binding: 3, resource: { buffer: lightGuide.settings } },
            ],
          });
        }
        const pixels = ptWidth * ptHeight;
        const values = PT_LIGHT_GUIDE_CELLS * guideLightCount;
        device.queue.writeBuffer(lightGuide.settings, 0, new Uint32Array([pixels, guideLightCount, PT_LIGHT_GUIDE_CELLS, 0]));
        const pass = encoder.beginComputePass();
        pass.setBindGroup(0, lightGuide.group!);
        pass.setPipeline(lightGuide.gather);
        pass.dispatchWorkgroups(Math.ceil(pixels / 64));
        pass.setPipeline(lightGuide.build);
        pass.dispatchWorkgroups(Math.ceil(values / 64));
        pass.end();
        encoder.copyBufferToBuffer(lightGuide.values, 0, guideLightsBuffer, lightGuideValuesOffset(guideLightCount), values * 4);
      };

      // Dynamic updates (dynamic-geometry.ts): CPU records are rewritten and refitted,
      // then only the changed spans are uploaded into the bound storage buffers.
      const bufferFor = (role: PtBufferRole): GPUBuffer | undefined => {
        const slot = bindings.group0.find(candidate => candidate.role === role);
        const entry = slot && group0Entries.find(candidate => candidate.binding === slot.binding);
        return entry ? (entry.resource as GPUBufferBinding).buffer : undefined;
      };
      const objectTransforms = bindings.group0.find(slot => slot.role === 'triangleUv')?.data !== ptScene.triangleUv;
      let dynamics: PathTraceDynamics | undefined;
      let bvhRebuild: Promise<void> | undefined;
      const write = (role: PtBufferRole, data: Float32Array, stride: number, [first, end]: [number, number]): void => {
        const buffer = bufferFor(role);
        if (buffer && end > first) device.queue.writeBuffer(buffer, first * stride * 4, data, first * stride, (end - first) * stride);
      };
      const uploadNodes = (upload: DynamicUpload): void => {
        if (upload.topology) {
          // A rebuilt BVH may need a larger node buffer: rebind it (the old one is released).
          const nodesBuffer = bufferFor('nodes');
          if (!nodesBuffer || nodesBuffer.size < ptScene.nodes.byteLength) {
            const slot = bindings.group0.find(candidate => candidate.role === 'nodes');
            const entry = slot && group0Entries.find(candidate => candidate.binding === slot.binding);
            if (entry) entry.resource = { buffer: storageData(ptScene.nodes, 'nodes') };
            ptComputeGroups = computeGroups(accumBuffer);
          } else write('nodes', ptScene.nodes, PT_NODE_FLOATS, [0, ptScene.nodeCount]);
          const order = bufferFor('triangleOrder');
          if (order) device.queue.writeBuffer(order, 0, ptScene.triangleOrder);
          return;
        }
        const runs = upload.nodes.length > 256 ? [[upload.nodes[0]![0], upload.nodes[upload.nodes.length - 1]![1]] as [number, number]] : upload.nodes;
        for (const run of runs) write('nodes', ptScene.nodes, PT_NODE_FLOATS, run);
      };
      // Large motions degrade the refitted BVH; rebuild it in the background. The
      // geometry is unchanged, so the accumulation is kept.
      const scheduleBvhRebuild = (): void => {
        const current = dynamics;
        if (!current || bvhRebuild || !current.needsRebuild) return;
        const started = performance.now();
        const ratio = current.costRatio;
        bvhRebuild = rebuildBvhInBackground(ptScene.triangles, ptScene.triangleCount, current.inflation).then(result => {
          if (disposed || dynamics !== current || pathTracer?.scene !== ptScene) return;
          uploadNodes(current.adopt(result.nodes, result.nodeCount, result.triangleOrder));
          performance.measure('pathtracing:bvh-rebuild', { start: started, end: performance.now(),
            detail: { costRatio: ratio, nodes: result.nodeCount } });
          this.#ptDisplayDirty = true;
        }, (error: unknown) => {
          sink({ level: 'warning', message: `Path tracing BVH rebuild failed: ${error instanceof Error ? error.message : String(error)}` });
        }).finally(() => {
          bvhRebuild = undefined;
          if (!disposed && dynamics === current) scheduleBvhRebuild();
        });
      };
      const applyGeometry = (updates: ReadonlyArray<{ range: PathTraceTransformRange; source: DynamicInstanceSource }>): void => {
        if (updates.length === 0) return;
        const started = performance.now();
        dynamics ??= new PathTraceDynamics(ptScene);
        const upload = dynamics.update(updates);
        performance.measure('pathtracing:dynamic-update', { start: started, end: performance.now(),
          detail: { nodes: upload.nodes.reduce((sum, [first, end]) => sum + end - first, 0), costRatio: dynamics.costRatio } });
        if (upload.triangles) write('triangles', ptScene.triangles, PT_TRIANGLE_FLOATS, upload.triangles);
        if (upload.tangents) write('triangleTangent', ptScene.triangleTangent, 12, upload.tangents);
        uploadNodes(upload);
        scheduleBvhRebuild();
        const uvBuffer = bufferFor('triangleUv');
        if (objectTransforms && uvBuffer && ptScene.transformRanges) {
          // Instance matrices follow the UVs and range indices (device-bindings.ts packUvAndTransforms).
          for (const { range } of updates) {
            const index = ptScene.transformRanges.indexOf(range);
            const matrices = new Float32Array(32);
            matrices.set(range.model);
            matrices.set(inverse4(range.model), 16);
            device.queue.writeBuffer(uvBuffer, (ptScene.triangleCount * 7 + index * 32) * 4, matrices);
          }
        }
      };
      const writeLights = (data: Float32Array): void => {
        const buffer = bufferFor('analyticLights');
        if (buffer && ptScene.analyticLights && data.length === ptScene.analyticLights.length) {
          ptScene.analyticLights = data;
          device.queue.writeBuffer(buffer, 0, data);
        }
      };
      // Temporal accumulation: keep at most `history` samples per pixel so newer
      // frames dominate after a change, instead of restarting from zero.
      let ageModule: GPUComputePipeline | undefined;
      const ageUniform = track(device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST }));
      const ageAccumulation = (history: number): void => {
        ageModule ??= device.createComputePipeline({ layout: 'auto', compute: { entryPoint: 'main', module: device.createShaderModule({
          label: 'Path tracing temporal history', code: /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> accum: array<vec4f>;
@group(0) @binding(1) var<uniform> settings: vec4u;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  if (id.x >= settings.x) { return; }
  let count = accum[id.x * 2u].w;
  let history = f32(settings.y);
  if (count <= history) { return; }
  accum[id.x * 2u].w = history;
  accum[id.x * 2u + 1u].y *= history / count;
}` }) } });
        const pixels = ptWidth * ptHeight;
        device.queue.writeBuffer(ageUniform, 0, new Uint32Array([pixels, Math.max(1, Math.floor(history)), 0, 0]));
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(ageModule);
        pass.setBindGroup(0, device.createBindGroup({ layout: ageModule.getBindGroupLayout(0), entries: [
          { binding: 0, resource: { buffer: accumBuffer } }, { binding: 1, resource: { buffer: ageUniform } },
        ] }));
        pass.dispatchWorkgroups(Math.ceil(pixels / 64));
        pass.end();
        device.queue.submit([encoder.finish()]);
        stopping.reset();
        invalidateDenoise();
        invalidateConvergence();
      };

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
      // Tiles per submission on mobile GPUs, whose drivers lose the device when one submission
      // runs too long (Adreno at 4 tiles of 64x64 with the current kernel): they start at one
      // tile, then aim at PATH_TRACE_BATCH_TARGET_MS per batch from the measured time per tile,
      // which includes each submission's fixed fence overhead. Desktop batches stay at the maximum.
      const adaptiveTiles = isMobileGpu(device as { adapterInfo?: GPUAdapterInfo });
      let tileBudget = adaptiveTiles ? 1 : PATH_TRACE_MAX_TILES_PER_REFRESH;
      let tiledBatch = 0;
      const adaptTileBudget = (milliseconds: number, tiles: number): void => {
        if (!adaptiveTiles || tiles < tileBudget || !(milliseconds > 0)) return;
        const wanted = Math.floor(PATH_TRACE_BATCH_TARGET_MS * tiles / milliseconds);
        tileBudget = Math.max(1, Math.min(PATH_TRACE_MAX_TILES_PER_REFRESH, tileBudget * 2, wanted));
      };
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
          const tileCount = captureTiles ?? (tiled ? Math.min(tileBudget, PATH_TRACE_MAX_TILES_PER_REFRESH, Math.max(
            PATH_TRACE_TILES_PER_REFRESH,
            Math.ceil(pathTraceTileCount(ptWidth, ptHeight) / PATH_TRACE_TILES_PER_REFRESH),
          )) : 1);
          tiledBatch = tiled && !capturing ? tileCount : 0;
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
          updateLightGuide(encoder);
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
        if (tiledBatch > 0) {
          adaptTileBudget(milliseconds, tiledBatch);
          tiledBatch = 0;
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
        scene: ptScene, uploadParameters, renderPathTrace, reportFrameTime, resetPathTrace, invalidateDenoise,
        tileBudget: (): number => tileBudget, adaptTileBudget,
        applyGeometry, writeLights, ageAccumulation,
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

    // Dynamic changes are written in place (disney-dynamics.ts); a build in progress
    // catches up once ready. Deformed prototypes wait here until the next sync.
    const disneyProxyPaths = new Set(loaded.lights.map(light => `${light.path}_Geometry`));
    const disneyInstances = (): InstanceResource[] => resources.instances.filter(instance =>
      instance.hasGeometry && !disneyProxyPaths.has(instance.primPath));
    let disneyDirtyPrototypes = new Set<string>();
    let disneyMaterialsDirty = false;
    /** A dynamic change arrived while the backend was being built from an older snapshot. */
    let disneyStale = false;
    const syncDisney = (): void => {
      const backend = disneyBackend, data = disneySceneData;
      if (disneyState === 'compiling') disneyStale = true;
      if (!backend || !data || disneyState !== 'ready') return;
      disneyStale = false;
      try {
        backend.writeTexels([
          ...disneyGeometryWrites(data, disneyDirtyPrototypes),
          ...disneyInstanceWrites(data, disneyInstances(), hiddenInstances),
        ]);
        backend.writeLights(packDisneyLights(currentLights).data);
        if (disneyMaterialsDirty) {
          const materials = [...data.materials];
          for (const [key, index] of data.materialIndices ?? []) {
            materials[index] = convertDisneySceneMaterial(key, resources.materials.get(key)!, data.textures).material;
          }
          backend.writeMaterials(materials);
          Object.assign(data, { materials });
        }
        disneyDirtyPrototypes = new Set();
        disneyMaterialsDirty = false;
        resetDisneyPathTrace();
      } catch (error) {
        // Changes the layout cannot absorb (new texture layers...) rebuild the backend.
        console.warn(`Disney path tracer rebuilt: ${error instanceof Error ? error.message : String(error)}`);
        invalidateDisneyTracer();
        if (this.#backend === 'disney') startDisneyTracer();
      }
    };

    const resetDisneyPathTrace = (): void => {
      disneyFrameIndex = 0;
      disneySeedFrame = 1;
      disneyTileIndex = 0;
      disneyBackend?.reset();
    };

    const invalidateDisneyTracer = (): void => {
      disneyBuildRevision++;
      disneyBackend?.dispose();
      disneyBackend = undefined;
      disneySceneData = undefined;
      disneyErrorReadback = false;
      disneyState = 'idle';
      if (fallback?.from === 'disney') fallback = undefined;
      resetDisneyPathTrace();
      if (disneyErrors.length) {
        disneyErrors = [];
        this.#onShaderErrors?.([...rasterErrors, ...pathTraceErrors]);
      }
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
        const disneyResources = { ...resources, instances: disneyInstances() };
        disneyDirtyPrototypes = new Set();
        disneyMaterialsDirty = false;
        disneyStale = hiddenInstances.size > 0;
        const scene = prepareDisneyScene(loaded.scene, disneyResources);
        for (const warning of scene.warnings) {
          sink({ level: 'warning', message: warning.message, detail: warning.materialKey });
        }
        const lightData = packDisneyLights(currentLights);
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
        disneyState = 'ready';
        // Visibility and changes made while the backend was being built.
        if (disneyStale) syncDisney();
        this.#ptDisplayDirty = true;
        this.#emitStatus();
      })().catch(error => {
        if (revision !== disneyBuildRevision) return;
        if (error instanceof GpuLimitError && !disposed) fallBack('disney', error);
        setDisneyError(error, 'Disney path tracing - preparation / pipeline');
      });
    };

    const renderDisney = (targetView: GPUTextureView, accumulate: boolean): void => {
      if (disneyState === 'idle') startDisneyTracer();
      const backend = disneyBackend;
      if (!backend || disneyState !== 'ready') {
        if (fallback?.from === 'disney') drawRaster(targetView);
        else clearOutput(targetView);
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
    let pathTraceOwned: Array<{ destroy(): void }> = [];
    const startPathTracer = (): Promise<void> => {
      if (pathTraceBuild) return pathTraceBuild;
      ptState = 'compiling';
      const revision = ++pathTraceBuildRevision;
      const ptTrash: Array<{ destroy(): void }> = [];
      pathTraceBuild = buildPathTracer(ptTrash, revision).then((built) => {
        if (disposed || revision !== pathTraceBuildRevision) {
          for (const o of ptTrash) o.destroy();
          return;
        }
        pathTraceOwned = ptTrash;
        pathTracer = built;
        pathTraceScene = built.scene;
        if (hiddenInstances.size > 0) built.applyGeometry(ptUpdatesFor(hiddenInstances));
        uploadPtParameters = built.uploadParameters;
        applyCamera(cameraViewProj, cameraEye, backgroundInvViewProj);
        uploadPtParameters?.();
        ptState = 'ready';
        this.#ptDisplayDirty = true;
        this.#emitStatus();
      }).catch((error: unknown) => {
        for (const o of ptTrash) o.destroy();
        if (disposed || revision !== pathTraceBuildRevision) return;
        if (pathTraceOwned === ptTrash) pathTraceOwned = [];
        pathTracer = undefined;
        pathTraceScene = undefined;
        uploadPtParameters = undefined;
        ptState = 'error';
        pathTraceBuildError = error;
        if (error instanceof GpuLimitError) fallBack('pathtracing', error);
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

    const invalidatePathTracer = (): void => {
      pathTraceBuildRevision++;
      pathTracer?.resetPathTrace();
      if (pathTraceScene) preparedPathTraceScene = pathTraceScene;
      for (const resource of pathTraceOwned) resource.destroy();
      pathTraceOwned = [];
      pathTracer = undefined;
      pathTraceScene = undefined;
      uploadPtParameters = undefined;
      pathTraceBuild = undefined;
      pathTraceBuildError = undefined;
      if (fallback?.from === 'pathtracing') fallback = undefined;
      ptState = 'idle';
      const hadErrors = pathTraceErrors.length > 0;
      pathTraceErrors = [];
      if (hadErrors && !disposed) this.#onShaderErrors?.([...rasterErrors]);
    };

    const capturePathTrace = async (
      targetView: GPUTextureView | undefined, samples: number, check?: () => void, options: { reset?: boolean } = {},
    ): Promise<void> => {
      const build = startPathTracer();
      const revision = pathTraceBuildRevision;
      const checkCapture = (): void => {
        check?.();
        if (disposed || revision !== pathTraceBuildRevision) throw new Error('Scene changed during path-tracing capture.');
      };
      await build;
      checkCapture();
      if (!pathTracer) throw pathTraceBuildError ?? new Error('Path tracer preparation failed.');
      const { renderPathTrace, resetPathTrace, tileBudget, adaptTileBudget } = pathTracer;
      if (options.reset !== false) resetPathTrace();
      let remaining = samples * pathTraceTileCount(width, height);
      while (remaining > 0) {
        checkCapture();
        const tiles = Math.min(remaining, tileBudget());
        const started = performance.now();
        await withGpuValidation(device, () => renderPathTrace(undefined, true, true, tiles));
        await device.queue.onSubmittedWorkDone();
        adaptTileBudget(performance.now() - started, tiles);
        checkCapture();
        remaining -= tiles;
      }
      if (targetView) await withGpuValidation(device, () => renderPathTrace(targetView, true, false, 0));
      checkCapture();
    };

    const instanceIndex = new Map(resources.instances.map((instance, index) => [instance.id, index]));
    const instanceOf = (id: string): InstanceResource => resources.instances[instanceIndex.get(id)!]!;
    const ptUpdatesFor = (ids: ReadonlySet<string>, scene = pathTraceScene) => (scene?.transformRanges ?? [])
      .filter(range => ids.has(range.instanceId))
      .map(range => {
        const geometry = resources.geometries.get(range.prototypeId ?? '');
        const position = geometry?.streams.find(stream => stream.name === 'position');
        if (!geometry || !position) throw new Error(`Dynamic geometry unavailable for '${range.instanceId}' (precompiled scene?).`);
        const normal = geometry.streams.find(stream => stream.name === 'normal');
        const tangent = geometry.streams.find(stream => stream.name === 'tangent');
        const source: DynamicInstanceSource = {
          model: instanceOf(range.instanceId).transform, indices: geometry.indices, positions: position.data,
          ...(normal ? { normals: normal.data } : {}),
          ...(tangent ? { tangents: { data: tangent.data, components: tangent.components } } : {}),
          ...(hiddenInstances.has(range.instanceId) ? { hidden: true } : {}),
        };
        return { range, source };
      });
    const applyDynamics = (update: SceneDynamicUpdate): void => {
      const started = performance.now();
      const changed = new Set<string>();
      for (const [id, model] of update.transforms ?? []) {
        const index = instanceIndex.get(id);
        if (index === undefined) continue;
        const instance = resources.instances[index]!;
        if (instance.transform.length === model.length && instance.transform.every((v, i) => v === model[i])) continue;
        (resources.instances as InstanceResource[])[index] = { ...instance, transform: model };
        changed.add(id);
      }
      if (update.hidden) {
        for (const id of new Set([...hiddenInstances, ...update.hidden])) {
          if (hiddenInstances.has(id) !== update.hidden.has(id)) changed.add(id);
        }
        hiddenInstances.clear();
        for (const id of update.hidden) hiddenInstances.add(id);
      }
      for (const [prototypeId, deformed] of update.geometry ?? []) {
        const geometry = resources.geometries.get(prototypeId);
        if (!geometry || deformed.positions.length !== geometry.vertexCount * 3) continue;
        (geometry as { streams: GeometryResource['streams'] }).streams = geometry.streams.map(stream =>
          stream.name === 'position' ? { ...stream, data: deformed.positions }
            : stream.name === 'normal' ? { ...stream, data: deformed.normals } : stream);
        raster?.updateGeometry(prototypeId, deformed.positions, deformed.normals);
        disneyDirtyPrototypes.add(prototypeId);
        for (const instance of resources.instances) if (instance.prototypeId === prototypeId) changed.add(instance.id);
      }
      for (const draw of frame.draws) {
        if (changed.has(draw.instanceId)) (draw as { model: Mat4 }).model = instanceOf(draw.instanceId).transform;
      }
      for (const { buffer, draw } of frameUniforms) {
        if (!changed.has(draw.instanceId)) continue;
        device.queue.writeBuffer(buffer, 0, new Float32Array(draw.model));
        if (draw.needsInverse) device.queue.writeBuffer(buffer, 92 * 4, new Float32Array(inverse4(draw.model, true)));
      }
      let lightsChanged = false;
      if (update.lights && JSON.stringify(update.lights) !== JSON.stringify(currentLights)) {
        const emitters = (lights: readonly SceneLight[]) => lights.filter(light => light.type !== 'dome').length;
        if (emitters(update.lights) !== emitters(currentLights)) throw new Error('Adding or removing lights requires reloading the scene.');
        currentLights = update.lights;
        frame.light = directionalLightFrom(update.lights);
        if (frame.analyticLights) {
          frame.analyticLights = packAnalyticLights(update.lights);
          raster?.updateLights(frame.analyticLights!);
        }
        const light = new Float32Array([...frame.light.direction, 0, ...frame.light.color, frame.light.intensity]);
        for (const { buffer } of frameUniforms) device.queue.writeBuffer(buffer, 36 * 4, light);
        if (pathTraceScene) {
          pathTraceScene.light = frame.light;
          if (pathTraceScene.analyticLights) pathTracer?.writeLights(packAnalyticLights(update.lights));
        }
        applyCamera(cameraViewProj, cameraEye, backgroundInvViewProj);
        lightsChanged = true;
      }
      if (changed.size > 0) raster?.updateVolume(changed);
      let triangles = 0;
      if (changed.size > 0 && pathTracer) {
        const updates = ptUpdatesFor(changed);
        triangles = updates.reduce((sum, { range }) => sum + range.triangleCount, 0);
        pathTracer.applyGeometry(updates);
      }
      const sceneChanged = changed.size > 0 || lightsChanged || update.materialsChanged === true;
      if (!sceneChanged && !update.cameraChanged) return;
      if (sceneChanged) {
        performance.measure('viewer:dynamic-update', { start: started, end: performance.now(),
          detail: { instances: changed.size, triangles, lights: lightsChanged } });
        if (update.materialsChanged) disneyMaterialsDirty = true;
        syncDisney();
      }
      if (pathTracer && !update.keepAccumulation) {
        if (this.#pathTracingTemporalHistory > 0) pathTracer.ageAccumulation(this.#pathTracingTemporalHistory);
        else pathTracer.resetPathTrace();
      }
      this.#rasterDirty = true;
      this.#ptDisplayDirty = true;
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
        disneyMaterialsDirty = true;
        syncDisney();
      },
      updateTopology: async (key, material, nextFrame, check, commit) => {
        if (rasterBuild) await rasterBuild;
        const finalize = (): void => {
          resources.materials.set(key, material);
          frame.draws = nextFrame.draws;
          frame.passes = nextFrame.passes;
          frame.skipped = nextFrame.skipped;
          commit();
          invalidatePathTracer();
          invalidateDisneyTracer();
        };
        if (raster) await raster.updateTopology(key, material, nextFrame, check, finalize);
        else {
          check();
          finalize();
        }
      },
      frame,
      resize: async (w, h) => {
        pathTracer?.resize(w, h);
        raster?.resize(w, h);
        width = w;
        height = h;
        if (disneyBackend || disneyState === 'compiling') {
          invalidateDisneyTracer();
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
      renderRaster: drawRaster,
      renderPathTrace: (targetView, tiled, accumulate) => {
        if (pathTracer) pathTracer.renderPathTrace(targetView, tiled, accumulate);
        else if (fallback?.from === 'pathtracing') drawRaster(targetView);
        else {
          void startPathTracer();
          clearOutput(targetView);
        }
      },
      fallback: () => fallback,
      forceFallback: (from, reason) => {
        if (from === 'pathtracing') invalidatePathTracer();
        else invalidateDisneyTracer();
        fallback = { from, to: 'raster', reason };
      },
      capturePathTrace,
      applyDynamics,
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
        disneyBackend?.dispose();
        invalidatePathTracer();
        for (const o of trash) o.destroy();
      },
    };
  }
}

const shaderInputCache = new WeakMap<SceneAsset, ReadonlyArray<{ material: string; id: string; attribute: PrimAttribute }>>();

/** Time-sampled UsdPreviewSurface inputs, keyed by their material prim (the shader's parent). */
function sampledShaderInputs(scene: SceneAsset): ReadonlyArray<{ material: string; id: string; attribute: PrimAttribute }> {
  let inputs = shaderInputCache.get(scene);
  if (!inputs) {
    const found: Array<{ material: string; id: string; attribute: PrimAttribute }> = [];
    for (const shader of scene.prims.values()) {
      if (shader.attributes.get('info:id')?.value !== 'UsdPreviewSurface') continue;
      const material = shader.path.slice(0, shader.path.lastIndexOf('/'));
      for (const [name, attribute] of shader.attributes) {
        if (name.startsWith('inputs:') && !name.includes('.') && attribute.timeSamples?.length) {
          found.push({ material, id: `surface:${name.slice('inputs:'.length)}`, attribute });
        }
      }
    }
    inputs = found;
    shaderInputCache.set(scene, inputs);
  }
  return inputs;
}
