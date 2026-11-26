// SceneAsset -> GPU resource bridge (plan sections 8, 10, T050). Turns a composed
// SceneAsset into renderer-neutral GPU resources: prepared geometry uploaded as
// vertex/index streams with a per-prototype BLAS, an instance list with world
// transforms and a TLAS over instance bounds, and -- for every scene material
// binding -- a compiled MaterialX variant (graph -> IR -> WGSL -> pipeline key /
// instance). Geometry bytes live in the crate payloads (T048) and the MaterialX
// graph->IR lowering live outside this module, so both are injected: a MeshSource
// supplies a RawMesh per prototype and a MaterialCompiler supplies the shader IR /
// WGSL per unit. Missing geometry or materials are reported as pending rather than
// silently dropped (REQ-013). The pure plan is device-free and Node-testable;
// uploadGeometry performs the actual GPUBuffer writes in the browser.

import { hashString, computePipelineKey, type PipelineKeyParts } from '../compiler/cache.ts';
import { extractFeatures, type ShaderFeatures } from '../compiler/features.ts';
import { typeToString, type ShaderIr } from '../compiler/ir.ts';
import type { WgslModule } from '../compiler/wgsl.ts';
import type { LayeredSurfaceModule } from '../compiler/surface-wgsl.ts';
import type { ResolvedGraph } from '../materialx/graph.ts';
import type { ResolvedSurface } from '../materialx/surface-graph.ts';
import type { ResolvedVolume } from '../materialx/volume-graph.ts';
import { evaluateVolumeIr, isSpatialVolumeIr, type VolumeMedium } from '../compiler/volume-ir.ts';
import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import { buildBvh, buildTlas, type Aabb, type Bvh, type Tlas } from '../geometry/bvh.ts';
import { openPreparedGeometryCache, preparedGeometryCacheKey, type PreparedGeometryCache } from '../geometry/cache.ts';
import { prepareMesh, type PrepareMeshOptions, type PreparedMesh, type PreparedSubset, type RawMesh, type DisplacementPlan, type SubdivisionPlan } from '../geometry/prepare.ts';
import { createMaterialVariant, type MaterialVariant } from '../materials/instance.ts';
import { assembleIrForwardShader, IR_FORWARD_FRAME_GROUP, type IrForwardShader } from './raster/ir-forward.ts';
import { buildSceneInstances, type Mat4 } from '../scene/instances.ts';
import { transformPoint } from '../scene/transforms.ts';
import type { SceneAsset, ScenePrim } from '../scene/types.ts';
import { materialUnitKey, resolveSceneMaterials, type MaterialCompileUnit } from '../usd/materials.ts';

/** Supplies the geometry cage for a prototype prim (crate payload bridge). */
export interface MeshSource {
  meshFor(prototypePrimPath: string): RawMesh | undefined;
  /** Identity of the source content (e.g. file digest and object name). A prepared
   *  geometry cache hit on it skips loading and parsing the mesh altogether. */
  contentKey?(prototypePrimPath: string): string | undefined | Promise<string | undefined>;
  /** Cheap bounds (no mesh preparation) for streaming placeholders. */
  quickBounds?(prototypePrimPath: string): Aabb | undefined | Promise<Aabb | undefined>;
  /** Lazily parses the mesh; preferred over meshFor when present. */
  loadMesh?(prototypePrimPath: string): Promise<RawMesh | undefined>;
  /** Warnings raised while parsing this mesh, replayed on a content-keyed cache hit. */
  diagnosticsFor?(prototypePrimPath: string): readonly Diagnostic[];
}

/** Output of the MaterialX graph -> IR -> WGSL chain for one material unit. */
export interface MaterialBuild {
  ir: ShaderIr;
  module: WgslModule;
  /** The compiled layered surface module (emitLayeredSurface, T055d): the shared
   *  shading source the IR scene-forward shader is assembled from (T058b/T058d).
   *  Absent for legacy mx_shade-only builds, which keep the hand-written pass. */
  layered?: LayeredSurfaceModule;
  /** The resolved surface graph + per-family surface the layered module was
   *  lowered from (T057i1): retained so the path tracer can rebuild a megakernel
   *  variant for materials with a procedural/textured graph. Absent for
   *  constant-only or legacy builds, which keep the packed constant record. */
  graph?: ResolvedGraph;
  surface?: ResolvedSurface;
  /** The resolved volume shader (volumeshader terminal): contains VDF closure
   *  and volumetric parameters for participating media. Absent for non-volumetric
   *  materials. */
  volume?: ResolvedVolume;
  /** Displacementshader program or legacy height map, baked before rendering. */
  displacement?: MaterialDisplacement;
}

/** Runs the MaterialX chain for a unique material unit (dedup already applied). */
export interface MaterialCompiler {
  compile(unit: MaterialCompileUnit): MaterialBuild | undefined | Promise<MaterialBuild | undefined>;
}

/** A single interleaved-free vertex stream ready for upload. */
export interface VertexStream {
  name: string;
  data: Float32Array;
  /** Scalar components per vertex (position/normal -> 3, uv -> 2). */
  components: number;
}

export interface GeometryResource {
  prototypeId: string;
  primPath: string;
  streams: readonly VertexStream[];
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  bounds: Aabb;
  blas: Bvh;
  subsets: readonly PreparedSubset[];
  subdivision: SubdivisionPlan;
  displacement: DisplacementPlan;
  /** Source USD point of each vertex, for time-sampled point deformation. */
  sourcePoints?: Uint32Array;
}

export interface MaterialDisplacement {
  file?: string;
  scale: number;
  uvScale?: readonly [number, number];
  uvOffset?: readonly [number, number];
  program?: {
    ir: ShaderIr;
    displacementRef: import('../compiler/ir.ts').IrRef;
    scaleRef: import('../compiler/ir.ts').IrRef;
    mode: 'scalar' | 'vector';
  };
}

export interface MaterialResource {
  volumeIr?: ShaderIr;
  volumeMedium?: VolumeMedium;
  volumeBoundary?: boolean;
  parameters?: readonly import('./material-parameters.ts').MaterialParameter[];
  unitKey: string;
  materialName: string;
  features: ShaderFeatures;
  variant: MaterialVariant;
  boundPrims: readonly string[];
  /** The scene-forward WGSL assembled from the layered surface module (T058b),
   *  present iff the build produced a layered module. backend.createSceneVariant
   *  Pipeline compiles it, keyed by variant.pipelineKey. */
  sceneShader?: IrForwardShader;
  /** The compiled layered surface module backing sceneShader: retained so the
   *  scene bind groups can resolve its texture/sampler group/binding slots. */
  surfaceModule?: LayeredSurfaceModule;
  /** The resolved surface graph + surface the material was lowered from (T057i1):
   *  threaded from the build so the path tracer can classify this material as a
   *  megakernel variant source. Present iff the build exposed them. */
  surfaceGraph?: ResolvedGraph;
  resolvedSurface?: ResolvedSurface;
  /** Height-map displacement threaded from the build for the GPU displace pass. */
  displacement?: MaterialDisplacement;
}

export interface InstanceResource {
  id: string;
  prototypeId: string;
  primPath: string;
  transform: Mat4;
  /** True when the prototype has an uploaded GeometryResource. */
  hasGeometry: boolean;
  /** Compiled material unit key, when a material is bound and compiled. */
  materialKey?: string;
  materialPath?: string;
  /** Placed by the PointInstancer at `primPath` (see scene/instances.ts). */
  instancer?: { index: number; relative: Mat4 };
}

export interface SceneResources {
  /** Geometry by prototype id. */
  geometries: ReadonlyMap<string, GeometryResource>;
  /** Compiled material by unit key. */
  materials: ReadonlyMap<string, MaterialResource>;
  instances: readonly InstanceResource[];
  tlas: Tlas;
  /** Prototype ids whose mesh source was unavailable. */
  pendingGeometry: readonly string[];
  /** Material unit keys whose compilation returned no build. */
  pendingMaterials: readonly string[];
  /** Gprims with no effective material binding. */
  unboundGprims: readonly string[];
  /** Fields of USD Volume prims, by prototype id (scene-volumes.ts). */
  volumes?: ReadonlyMap<string, import('./scene-volumes.ts').SceneVolume>;
}

export interface SceneResourcesProgress {
  /** Asked before each prototype is prepared; return true to receive a partial scene now. */
  wanted(readyGeometries: number): boolean;
  /** A self-contained scene with the geometry prepared so far (and the materials once compiled). */
  partial(resources: SceneResources, pendingGeometries: number): void;
  /** Awaited before each prototype: lets a partial scene finish building before geometry work resumes. */
  pause?(): Promise<void> | undefined;
  /** The first prototype came from the prepared-geometry cache: geometry will be fast. */
  geometryCached?(): void;
}

export interface BuildSceneResourcesOptions {
  meshSource: MeshSource;
  /** A pending compiler lets geometry preparation start before MaterialX is loaded. */
  materialCompiler: MaterialCompiler | Promise<MaterialCompiler>;
  progress?: SceneResourcesProgress;
  sink?: DiagnosticSink;
  prepareOptions?: PrepareMeshOptions;
  isRenderable?: (prim: ScenePrim) => boolean;
  /** Pipeline-key fields describing the render target (defaults to a raster pass). */
  backend?: string;
  compilerVersion?: string;
  colorFormats?: readonly string[];
  depthFormat?: string;
  sampleCount?: number;
  /** Override persistent prepared-geometry storage (primarily for tests/embedders). */
  geometryCache?: PreparedGeometryCache;
}

export function requireCompiledMaterials(resources: Pick<SceneResources, 'pendingMaterials'>): void {
  if (resources.pendingMaterials.length > 0) {
    throw new Error(`Material compilation failed: ${resources.pendingMaterials.join(', ')}`);
  }
}

function pipelineKeyFor(
  features: ShaderFeatures,
  module: WgslModule,
  options: BuildSceneResourcesOptions,
  sceneCode?: string,
): string {
  // Graph materials share one neutral mx_shade module; the real shading rides on
  // the assembled scene-forward WGSL, so fold it in to keep pipeline keys distinct.
  const parts: PipelineKeyParts = {
    shaderHash: hashString(sceneCode !== undefined ? `${module.code}\n${sceneCode}` : module.code),
    compilerVersion: options.compilerVersion ?? '0',
    backend: options.backend ?? 'raster',
    pass: features.passes.map((p) => p.kind).sort().join('+') || 'opaque',
    layouts: [features.variantKey],
    vertexAttributes: features.attributes.map((a) => `${a.semantic}:${a.name}:${typeToString(a.type)}`),
    colorFormats: options.colorFormats ?? ['rgba16float'],
    ...(options.depthFormat !== undefined ? { depthFormat: options.depthFormat } : {}),
    sampleCount: options.sampleCount ?? 1,
  };
  return computePipelineKey(parts);
}

function cornersOf(bounds: Aabb): [number, number, number][] {
  const { min, max } = bounds;
  const corners: [number, number, number][] = [];
  for (let i = 0; i < 8; i++) {
    corners.push([
      (i & 1) ? max[0] : min[0],
      (i & 2) ? max[1] : min[1],
      (i & 4) ? max[2] : min[2],
    ]);
  }
  return corners;
}

/** World-space AABB of a local AABB transformed by a column-major matrix. */
export function transformBounds(bounds: Aabb, transform: Mat4): Aabb {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const corner of cornersOf(bounds)) {
    const p = transformPoint(transform, corner);
    for (let k = 0; k < 3; k++) {
      if (p[k]! < min[k]!) min[k] = p[k]!;
      if (p[k]! > max[k]!) max[k] = p[k]!;
    }
  }
  return { min, max };
}

function pointBounds(transform: Mat4): Aabb {
  const p = transformPoint(transform, [0, 0, 0]);
  return { min: [p[0], p[1], p[2]], max: [p[0], p[1], p[2]] };
}

/** Closed box with outward faces. */
function boxMesh({ min, max }: Aabb): RawMesh {
  const points: number[] = [];
  for (let corner = 0; corner < 8; corner++) {
    points.push(corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2]);
  }
  return {
    points, faceVertexCounts: [4, 4, 4, 4, 4, 4],
    faceVertexIndices: [0, 2, 3, 1, 4, 5, 7, 6, 0, 1, 5, 4, 2, 6, 7, 3, 0, 4, 6, 2, 1, 3, 7, 5],
  };
}

export function buildGeometry(prototypeId: string, primPath: string, mesh: PreparedMesh): GeometryResource {
  const streams: VertexStream[] = [
    { name: 'position', data: mesh.positions, components: 3 },
    { name: 'normal', data: mesh.normals, components: 3 },
  ];
  if (mesh.uvs) streams.push({ name: 'uv', data: mesh.uvs, components: 2 });
  if (mesh.tangents) streams.push({ name: 'tangent', data: mesh.tangents, components: 4 });
  for (const [name, attr] of mesh.attributes) {
    streams.push({ name, data: attr.values, components: attr.elementSize });
  }
  let blas: Bvh | undefined;
  const bounds: { min: [number, number, number]; max: [number, number, number] } = {
    min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity],
  };
  for (const index of mesh.indices) {
    for (let axis = 0; axis < 3; axis++) {
      const value = mesh.positions[index * 3 + axis]!;
      bounds.min[axis] = Math.min(bounds.min[axis]!, value);
      bounds.max[axis] = Math.max(bounds.max[axis]!, value);
    }
  }
  if (mesh.indices.length === 0) {
    bounds.min = [0, 0, 0];
    bounds.max = [0, 0, 0];
  }
  return {
    prototypeId,
    primPath,
    streams,
    indices: mesh.indices,
    vertexCount: mesh.positions.length / 3,
    triangleCount: mesh.indices.length / 3,
    bounds,
    get blas() { return blas ??= buildBvh(mesh.positions, mesh.indices); },
    subsets: mesh.subsets,
    subdivision: mesh.subdivision,
    displacement: mesh.displacement,
    ...(mesh.sourcePoints ? { sourcePoints: mesh.sourcePoints } : {}),
  };
}

/**
 * Build the complete GPU resource plan for a scene: geometry + BLAS per prototype,
 * instances + TLAS, and a compiled MaterialX variant per bound material.
 */
export async function buildSceneResources(
  scene: SceneAsset,
  options: BuildSceneResourcesOptions,
): Promise<SceneResources> {
  const emit: (d: Diagnostic) => void = options.sink ?? (() => undefined);
  const sceneMaterials = resolveSceneMaterials(scene, {
    ...(options.sink ? { sink: options.sink } : {}),
    ...(options.isRenderable ? { isRenderable: options.isRenderable } : {}),
  });
  const sceneInstances = buildSceneInstances(scene, {
    ...(options.sink ? { sink: options.sink } : {}),
    materials: sceneMaterials,
    ...(options.isRenderable ? { isRenderable: options.isRenderable } : {}),
  });

  // Geometry per prototype.
  const geometries = new Map<string, GeometryResource>();
  const pendingGeometry: string[] = [];
  let geometryCacheHits = 0;
  let geometryCacheMisses = 0;
  let geometryCacheBypasses = 0;
  let geometryCacheUnavailable = false;
  const prepareOptions = options.prepareOptions ?? {};
  const hasPendingSubdivision = (raw: RawMesh): boolean =>
    ['catmullClark', 'loop', 'bilinear'].includes(raw.subdivisionScheme ?? 'none') &&
    (raw.refinementLevel ?? 0) > 0;
  const geometryStarted = performance.now();
  let geometryCache = options.geometryCache;
  const cacheable = prepareOptions.subdivider === undefined;
  if (!geometryCache && cacheable && globalThis.indexedDB) {
    try {
      geometryCache = await openPreparedGeometryCache();
    } catch (error) {
      geometryCacheUnavailable = true;
      emit({ level: 'warning', message: 'Prepared geometry cache unavailable; preparing meshes without persistent caching.', detail: String(error) });
    }
  }
  // Materials per unique unit via the injected MaterialX chain.
  const materials = new Map<string, MaterialResource>();
  const pendingMaterials: string[] = [];
  let materialsCompiled = false;
  const compileMaterials = async (compiler: MaterialCompiler): Promise<void> => {
    materialsCompiled = true;
    for (const unit of sceneMaterials.units) {
      const key = materialUnitKey(unit);
      const build = await compiler.compile(unit);
      if (!build) {
        pendingMaterials.push(key);
        emit({ level: 'warning', message: `Material pending: compiler produced no build for ${unit.materialName}`, detail: { material: key } });
        continue;
      }
      const features = extractFeatures(build.ir);
      const sceneShader = build.layered
        ? assembleIrForwardShader(build.layered, { displacement: build.displacement !== undefined })
        : undefined;
      const variant = createMaterialVariant(build.module, pipelineKeyFor(features, build.module, options, sceneShader?.code));
      materials.set(key, {
        unitKey: key,
        materialName: unit.materialName,
        features,
        variant,
        boundPrims: unit.boundPrims,
        ...(build.volume ? {
          volumeIr: build.ir, volumeBoundary: !build.surface,
          ...(!isSpatialVolumeIr(build.ir) ? { volumeMedium: evaluateVolumeIr(build.ir) } : {}),
        } : {}),
        ...(sceneShader ? { sceneShader } : {}),
        ...(build.layered ? { surfaceModule: build.layered } : {}),
        ...(build.graph ? { surfaceGraph: build.graph } : {}),
        ...(build.surface ? { resolvedSurface: build.surface } : {}),
        ...(build.displacement ? { displacement: build.displacement } : {}),
      });
    }
  };

  // Instances + TLAS over the geometry and materials available so far.
  const assemble = (placeholders = false): SceneResources => {
    const instances: InstanceResource[] = [];
    const tlasBounds: Aabb[] = [];
    const partialGeometries = new Map(geometries);
    if (placeholders) {
      for (const proto of sceneInstances.prototypes) {
        const bounds = placeholderBounds.get(proto.id);
        if (!partialGeometries.has(proto.id) && bounds) partialGeometries.set(proto.id, buildGeometry(proto.id, proto.primPath, prepareMesh(boxMesh(bounds))));
      }
    }
    for (const inst of sceneInstances.instances) {
      const geometry = partialGeometries.get(inst.prototypeId);
      const binding = sceneMaterials.bindings.get(inst.primPath) ?? sceneMaterials.bindings.get(inst.prototypeId);
      const materialKey = binding?.materialX
        ? materialUnitKey(binding.materialX)
        : undefined;
      instances.push({
        id: inst.id,
        prototypeId: inst.prototypeId,
        primPath: inst.primPath,
        transform: inst.transform,
        hasGeometry: geometry !== undefined,
        ...(materialKey !== undefined && materials.has(materialKey) ? { materialKey } : {}),
        ...(inst.materialPath !== undefined ? { materialPath: inst.materialPath } : {}),
        ...(inst.instancer ? { instancer: inst.instancer } : {}),
      });
      tlasBounds.push(geometry ? transformBounds(geometry.bounds, inst.transform) : pointBounds(inst.transform));
    }
    return {
      geometries: partialGeometries,
      materials: new Map(materials),
      instances,
      tlas: buildTlas(tlasBounds),
      pendingGeometry: [...pendingGeometry],
      pendingMaterials: [...pendingMaterials],
      unboundGprims: sceneMaterials.unbound,
    };
  };

  // Streaming placeholders: boxes for prototypes whose bounds are known before they are prepared.
  const placeholderBounds = new Map<string, Aabb>();
  const placeholderJobs = new Map<string, Promise<void>>();
  if (options.progress) {
    for (const proto of sceneInstances.prototypes) {
      placeholderJobs.set(proto.id, Promise.resolve(options.meshSource.quickBounds?.(proto.primPath)).then(bounds => {
        if (!bounds || !bounds.min.every((value, axis) => Number.isFinite(value) && value <= bounds.max[axis]!)) return;
        placeholderBounds.set(proto.id, bounds);
        if (options.progress?.wanted(geometries.size + placeholderBounds.size)) {
          options.progress.partial(assemble(true), sceneInstances.prototypes.length - geometries.size);
        }
      }, () => undefined));
    }
  }

  // A ready compiler compiles first; a pending one joins as soon as it resolves.
  let readyCompiler: MaterialCompiler | undefined;
  let compilerSettled = false;
  const compilerPromise = Promise.resolve(options.materialCompiler);
  void compilerPromise.then(compiler => { readyCompiler = compiler; }, () => undefined).finally(() => { compilerSettled = true; });
  if (!(options.materialCompiler instanceof Promise)) await compileMaterials(options.materialCompiler);

  const replayed = new Set<string>();
  let remainingPrototypes = sceneInstances.prototypes.length;
  for (const proto of sceneInstances.prototypes) {
    if (!materialsCompiled && readyCompiler) await compileMaterials(readyCompiler);
    if (options.progress?.wanted(geometries.size + placeholderBounds.size)) options.progress.partial(assemble(true), remainingPrototypes);
    await options.progress?.pause?.();
    remainingPrototypes--;
    const source = options.meshSource;
    const contentKey = cacheable && geometryCache ? await source.contentKey?.(proto.primPath) : undefined;
    let key = contentKey ? await preparedGeometryCacheKey({ contentKey }, prepareOptions) : undefined;
    let prepared: PreparedMesh | undefined;
    if (key && geometryCache) {
      try {
        prepared = await geometryCache.get(key);
      } catch (error) {
        geometryCacheUnavailable = true;
        geometryCache = undefined;
        emit({ level: 'warning', message: 'Failed to read prepared geometry cache; preparing meshes without persistent caching.', detail: String(error) });
      }
      for (const diagnostic of (prepared as { sourceDiagnostics?: Diagnostic[] } | undefined)?.sourceDiagnostics ?? []) {
        if (replayed.has(diagnostic.message)) continue;
        replayed.add(diagnostic.message);
        emit(diagnostic);
      }
    }
    if (prepared) {
      if (geometryCacheHits + geometryCacheMisses + geometryCacheBypasses === 0) options.progress?.geometryCached?.();
      geometryCacheHits++;
      geometries.set(proto.id, buildGeometry(proto.id, proto.primPath, prepared));
      continue;
    }
    // Parsing and preparation block the thread: let this mesh's placeholder and a pending
    // first preview reach the screen first.
    await placeholderJobs.get(proto.id);
    await options.progress?.pause?.();
    const raw = source.loadMesh ? await source.loadMesh(proto.primPath) : source.meshFor(proto.primPath);
    if (!raw) {
      pendingGeometry.push(proto.id);
      emit({ level: 'warning', message: `Geometry pending: no mesh source for prototype ${proto.primPath}`, detail: { prim: proto.primPath } });
      continue;
    }
    const canCache = cacheable && !hasPendingSubdivision(raw);
    if (!canCache) key = undefined;
    else if (!key && geometryCache) key = await preparedGeometryCacheKey(raw, prepareOptions);
    if (canCache && geometryCache && !key && !geometryCacheUnavailable) {
      geometryCacheUnavailable = true;
      emit({ level: 'warning', message: 'Web Crypto unavailable; prepared geometry will not be cached.' });
    }
    if (key && geometryCache && !contentKey) {
      try {
        prepared = await geometryCache.get(key);
      } catch (error) {
        geometryCacheUnavailable = true;
        geometryCache = undefined;
        emit({ level: 'warning', message: 'Failed to read prepared geometry cache; preparing meshes without persistent caching.', detail: String(error) });
      }
    }
    if (prepared) {
      geometryCacheHits++;
    } else {
      if (key && geometryCache) geometryCacheMisses++;
      else geometryCacheBypasses++;
      prepared = prepareMesh(raw, prepareOptions);
      if (key && geometryCache) {
        try {
          const diagnostics = contentKey ? source.diagnosticsFor?.(proto.primPath) ?? [] : [];
          await geometryCache.set(key, diagnostics.length ? { ...prepared, sourceDiagnostics: [...diagnostics] } as PreparedMesh : prepared);
        } catch (error) {
          geometryCacheUnavailable = true;
          geometryCache = undefined;
          emit({ level: 'warning', message: 'Failed to persist prepared geometry.', detail: String(error) });
        }
      }
    }
    geometries.set(proto.id, buildGeometry(proto.id, proto.primPath, prepared));
  }
  const geometryFinished = performance.now();
  performance.measure('usd:geometry', {
    start: geometryStarted,
    end: geometryFinished,
    detail: {
      geometries: geometries.size,
      cacheHits: geometryCacheHits,
      cacheMisses: geometryCacheMisses,
      cacheBypasses: geometryCacheBypasses,
      cacheUnavailable: geometryCacheUnavailable,
      triangles: [...geometries.values()].reduce((sum, mesh) => sum + mesh.triangleCount, 0),
    },
  });

  // Geometry is complete but MaterialX is still loading: keep offering partial scenes meanwhile.
  while (options.progress && !materialsCompiled && !compilerSettled) {
    if (options.progress.wanted(geometries.size)) options.progress.partial(assemble(), 0);
    await Promise.race([compilerPromise.catch(() => undefined), new Promise(resolve => setTimeout(resolve, 100))]);
  }
  if (!materialsCompiled) await compileMaterials(await compilerPromise);
  const resources = assemble();
  return { ...resources, geometries, materials };
}

export interface GeometryGpuBuffers {
  vertexBuffers: Map<string, GPUBuffer>;
  indexBuffer: GPUBuffer;
  indexCount: number;
}

/** Upload a prepared geometry's streams and index buffer to the GPU. */
export function uploadGeometry(device: GPUDevice, resource: GeometryResource, label?: string): GeometryGpuBuffers {
  const vertexBuffers = new Map<string, GPUBuffer>();
  for (const stream of resource.streams) {
    const buffer = device.createBuffer({
      size: stream.data.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      ...(label ? { label: `${label}:${stream.name}` } : {}),
    });
    device.queue.writeBuffer(buffer, 0, stream.data);
    vertexBuffers.set(stream.name, buffer);
  }
  const indexBuffer = device.createBuffer({
    size: resource.indices.byteLength,
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    ...(label ? { label: `${label}:index` } : {}),
  });
  device.queue.writeBuffer(indexBuffer, 0, resource.indices);
  return { vertexBuffers, indexBuffer, indexCount: resource.indices.length };
}

/** Per-draw GPU buffers the scene bind groups bind for one instance. */
export interface SceneDrawBuffers {
  /** Per-frame uniform (model + camera + light + environment), bound at the
   *  frame bind group, binding 0. */
  frame: GPUBuffer;
  /** Material MxUniforms buffer, bound at group 0 binding 0. */
  material: GPUBuffer;
  /** Resolved texture views by MaterialX texture handle name. */
  textureViews?: ReadonlyMap<string, GPUTextureView>;
  /** Resolved samplers by MaterialX sampler handle name. */
  samplers?: ReadonlyMap<string, GPUSampler>;
  environment?: { textureView: GPUTextureView; sampler: GPUSampler; cdf: GPUBuffer };
  analyticLights?: GPUBuffer;
  /** Vertex-displacement resources (VTF), bound at the scene shader's displacement
   *  group: a MxDisp uniform (scale, midpoint), the height map and its sampler.
   *  Present only for a material whose sceneShader declares displacementGroup. */
  displacement?: { group: number; params: GPUBuffer; textureView: GPUTextureView; sampler: GPUSampler };
}

export interface SceneBindGroups {
  materialBindGroup: GPUBindGroup;
  frameBindGroup: GPUBindGroup;
  /** Every bind group built, keyed by its group index (includes texture/sampler
   *  groups when the surface module declares them). */
  byGroup: ReadonlyMap<number, GPUBindGroup>;
}

const fallbackEnvironments = new WeakMap<GPUDevice, NonNullable<SceneDrawBuffers['environment']>>();

/** Invalidate cached bindings before a host releases all per-scene GPU resources. */
export function clearFallbackEnvironment(device: GPUDevice): void {
  fallbackEnvironments.delete(device);
}

function fallbackEnvironment(device: GPUDevice) {
  let environment = fallbackEnvironments.get(device);
  if (!environment) {
    const texture = device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING });
    environment = {
      textureView: texture.createView(), sampler: device.createSampler(),
      cdf: device.createBuffer({ size: 16, usage: GPUBufferUsage.STORAGE }),
    };
    fallbackEnvironments.set(device, environment);
  }
  return environment;
}

/**
 * Build the scene-forward bind groups for one material draw (T058d): the material
 * MxUniforms at group 0, the per-frame uniform at the IR frame bind group, and a
 * bind group per texture/sampler group the compiled surface module declares.
 * `layout` resolves each group's layout from the variant pipeline. Pure device
 * calls -- no validation under Node (served to the GPU like uploadGeometry).
 */
export function createSceneBindGroups(
  device: GPUDevice,
  material: MaterialResource,
  buffers: SceneDrawBuffers,
  layout: (group: number) => GPUBindGroupLayout,
): SceneBindGroups {
  const module = material.surfaceModule;
  const frameGroup = material.sceneShader?.frameGroup ?? IR_FORWARD_FRAME_GROUP;
  const entriesByGroup = new Map<number, GPUBindGroupEntry[]>();
  const push = (group: number, entry: GPUBindGroupEntry): void => {
    const list = entriesByGroup.get(group) ?? [];
    list.push(entry);
    entriesByGroup.set(group, list);
  };
  // Material MxUniforms at group 0 binding 0 (only when the module declares them).
  if (!module || module.uniforms.length > 0) push(0, { binding: 0, resource: { buffer: buffers.material } });
  // Textures and samplers at their module-declared group/binding slots.
  if (module) {
    for (const t of module.textures) {
      const view = buffers.textureViews?.get(t.name);
      if (view) push(t.group, { binding: t.binding, resource: view });
    }
    for (const s of module.samplers) {
      const sampler = buffers.samplers?.get(s.name);
      if (sampler) push(s.group, { binding: s.binding, resource: sampler });
    }
  }
  // Per-frame uniform at the dedicated frame bind group, binding 0.
  push(frameGroup, { binding: 0, resource: { buffer: buffers.frame } });
  const environment = buffers.environment ?? fallbackEnvironment(device);
  push(frameGroup, { binding: 4, resource: environment.textureView });
  push(frameGroup, { binding: 5, resource: environment.sampler });
  if (material.sceneShader?.rasterQuality !== 'interactive') {
    push(frameGroup, { binding: 6, resource: { buffer: environment.cdf } });
  }
  if (material.sceneShader?.analyticLights) {
    if (!buffers.analyticLights) throw new Error('Missing raster analytic light buffer.');
    push(frameGroup, { binding: 7, resource: { buffer: buffers.analyticLights } });
  }

  // Optional vertex-displacement (VTF): the height map, its sampler and the MxDisp
  // params share the frame group at bindings 1, 2 and 3 (the device guarantees only
  // 4 bind groups, so displacement cannot claim a group of its own).
  if (buffers.displacement) {
    const d = buffers.displacement;
    push(d.group, { binding: 1, resource: d.textureView });
    push(d.group, { binding: 2, resource: d.sampler });
    push(d.group, { binding: 3, resource: { buffer: d.params } });
  }

  const byGroup = new Map<number, GPUBindGroup>();
  for (const [group, entries] of entriesByGroup) {
    byGroup.set(group, device.createBindGroup({ layout: layout(group), entries }));
  }
  // Group 0 (material) always exists in the pipeline layout: bind an empty group
  // when the surface folds every input to a constant (no MxUniforms).
  if (!byGroup.has(0)) byGroup.set(0, device.createBindGroup({ layout: layout(0), entries: [] }));
  const materialBindGroup = byGroup.get(0)!;
  const frameBindGroup = byGroup.get(frameGroup)!;
  return { materialBindGroup, frameBindGroup, byGroup };
}
