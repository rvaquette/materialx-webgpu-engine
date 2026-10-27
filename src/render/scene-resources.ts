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
import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import { buildBvh, buildTlas, type Aabb, type Bvh, type Tlas } from '../geometry/bvh.ts';
import { openPreparedGeometryCache, preparedGeometryCacheKey, type PreparedGeometryCache } from '../geometry/cache.ts';
import { prepareMesh, type PrepareMeshOptions, type PreparedMesh, type PreparedSubset, type RawMesh, type DisplacementPlan, type SubdivisionPlan } from '../geometry/prepare.ts';
import { createMaterialVariant, type MaterialVariant } from '../materials/instance.ts';
import { assembleIrForwardShader, IR_FORWARD_FRAME_GROUP, type IrForwardShader } from './raster/ir-forward.ts';
import { buildSceneInstances, type Mat4 } from '../scene/instances.ts';
import { transformPoint } from '../scene/transforms.ts';
import type { SceneAsset, ScenePrim } from '../scene/types.ts';
import { resolveSceneMaterials, type MaterialCompileUnit } from '../usd/materials.ts';

/** Supplies the geometry cage for a prototype prim (crate payload bridge). */
export interface MeshSource {
  meshFor(prototypePrimPath: string): RawMesh | undefined;
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
  /** Height-map displacement extracted from the displacementshader terminal: a
   *  scalar texture sampled along the shading normal, scaled by `scale`. Absent
   *  when the material has no displacement or only a constant (map-less) one. */
  displacement?: { file: string; scale: number };
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
}

export interface MaterialResource {
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
  displacement?: { file: string; scale: number };
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
}

export interface BuildSceneResourcesOptions {
  meshSource: MeshSource;
  materialCompiler: MaterialCompiler;
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

function unitKey(assetPath: string, referencedPrimPath: string): string {
  return `${assetPath}::${referencedPrimPath}`;
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
function transformBounds(bounds: Aabb, transform: Mat4): Aabb {
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

function buildGeometry(prototypeId: string, primPath: string, mesh: PreparedMesh): GeometryResource {
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
  for (const proto of sceneInstances.prototypes) {
    const raw = options.meshSource.meshFor(proto.primPath);
    if (!raw) {
      pendingGeometry.push(proto.id);
      emit({ level: 'warning', message: `Geometry pending: no mesh source for prototype ${proto.primPath}`, detail: { prim: proto.primPath } });
      continue;
    }
    const canCache = cacheable && !hasPendingSubdivision(raw);
    const key = canCache && geometryCache ? await preparedGeometryCacheKey(raw, prepareOptions) : undefined;
    if (canCache && geometryCache && !key && !geometryCacheUnavailable) {
      geometryCacheUnavailable = true;
      emit({ level: 'warning', message: 'Web Crypto unavailable; prepared geometry will not be cached.' });
    }
    let prepared: PreparedMesh | undefined;
    if (key && geometryCache) {
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
          await geometryCache.set(key, prepared);
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

  // Materials per unique unit via the injected MaterialX chain.
  const materials = new Map<string, MaterialResource>();
  const pendingMaterials: string[] = [];
  for (const unit of sceneMaterials.units) {
    const key = unitKey(unit.assetPath, unit.referencedPrimPath);
    const build = await options.materialCompiler.compile(unit);
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
      ...(sceneShader ? { sceneShader } : {}),
      ...(build.layered ? { surfaceModule: build.layered } : {}),
      ...(build.graph ? { surfaceGraph: build.graph } : {}),
      ...(build.surface ? { resolvedSurface: build.surface } : {}),
      ...(build.displacement ? { displacement: build.displacement } : {}),
    });
  }

  // Instances + TLAS.
  const instances: InstanceResource[] = [];
  const tlasBounds: Aabb[] = [];
  for (const inst of sceneInstances.instances) {
    const geometry = geometries.get(inst.prototypeId);
    const binding = sceneMaterials.bindings.get(inst.primPath) ?? sceneMaterials.bindings.get(inst.prototypeId);
    const materialKey = binding?.materialX
      ? unitKey(binding.materialX.assetPath, binding.materialX.referencedPrimPath)
      : undefined;
    instances.push({
      id: inst.id,
      prototypeId: inst.prototypeId,
      primPath: inst.primPath,
      transform: inst.transform,
      hasGeometry: geometry !== undefined,
      ...(materialKey !== undefined && materials.has(materialKey) ? { materialKey } : {}),
      ...(inst.materialPath !== undefined ? { materialPath: inst.materialPath } : {}),
    });
    tlasBounds.push(geometry ? transformBounds(geometry.bounds, inst.transform) : pointBounds(inst.transform));
  }

  const tlas = buildTlas(tlasBounds);
  return {
    geometries,
    materials,
    instances,
    tlas,
    pendingGeometry,
    pendingMaterials,
    unboundGprims: sceneMaterials.unbound,
  };
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
