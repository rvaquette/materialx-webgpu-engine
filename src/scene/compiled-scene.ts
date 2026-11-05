import { buildEnvCdf } from '../assets/environment-cdf.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import { assembleIrForwardShader, type IrForwardShader, type RasterQuality } from '../render/raster/ir-forward.ts';
import { buildSceneFrame, type RasterSurface } from '../render/raster/scene-frame.ts';
import { buildCachedPathTraceScene, PT_MATERIAL_FLOATS, PT_NODE_FLOATS, PT_TRIANGLE_FLOATS, type PathTraceScene } from '../render/pathtracing/scene-buffers.ts';
import { SCENE_BUFFER_CACHE_VERSION, validatePreparedGeometry } from '../render/pathtracing/scene-buffer-cache.ts';
import { buildMaterialDispatch, type PtMaterialDispatch } from '../render/pathtracing/material-variant.ts';
import { pathTraceSettings } from '../render/pathtracing/scene-settings.ts';
import type { LoadedUsdScene } from '../render/usd-scene-assets.ts';
import type { SceneResources } from '../render/scene-resources.ts';
import {
  decodeCompiledScene, encodeCompiledScene, isRecord,
  type CompiledScenePackage,
} from './compiled-scene-codec.ts';

export interface CompiledSceneRuntime {
  pathTrace: PathTraceScene;
  dispatch: PtMaterialDispatch;
  rasterShaders: Map<string, IrForwardShader>;
  environmentCdf?: ReturnType<typeof buildEnvCdf>;
}

interface CompiledSceneData extends CompiledSceneRuntime {
  layout: { sceneBufferVersion: number; nodeFloats: number; triangleFloats: number; materialFloats: number };
  scene: LoadedUsdScene['scene'];
  resources: SceneResources;
  parameterResources?: SceneResources;
  lights: LoadedUsdScene['lights'];
  cameras: LoadedUsdScene['cameras'];
  environment?: LoadedUsdScene['environment'];
  surfaces: Map<string, RasterSurface>;
  images: Map<string, DecodedPixelImage>;
}

export function compiledRasterShaderKey(materialKey: string, quality: RasterQuality): string {
  return `${quality}:${materialKey}`;
}

/** Snapshot after import/displacement; material graphs are kept for explicit later edits. */
export async function exportCompiledScene(loaded: LoadedUsdScene): Promise<CompiledScenePackage> {
  if (loaded.resources.pendingGeometry.length || loaded.resources.pendingMaterials.length) {
    throw new Error('Cannot export a scene with missing geometry or materials.');
  }
  const surfaces = new Map([...loaded.resources.materials].map(([key, material]) => [key, loaded.mtlx.surfaceFor(material)]));
  const pathTrace = loaded.compiled?.pathTrace ?? await buildCachedPathTraceScene(loaded.resources, {
    lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor, settings: pathTraceSettings(loaded.scene),
  });
  const dispatch = loaded.compiled?.dispatch ?? buildMaterialDispatch(pathTrace.variantSources);
  const files = new Set(dispatch.textureRegistry.images.filter((file): file is string => file !== undefined));
  for (const resources of [loaded.resources, loaded.parameterResources]) {
    for (const material of resources?.materials.values() ?? []) {
      for (const texture of material.surfaceModule?.textures ?? []) {
        if (texture.fileRef !== undefined) files.add(texture.fileRef);
      }
      if (material.displacement) files.add(material.displacement.file);
    }
  }
  if (pathTrace.displacement) files.add(pathTrace.displacement.mapFile);
  const images = new Map<string, DecodedPixelImage>();
  for (const file of files) {
    const image = await loaded.mtlx.imageProvider.decode(file);
    if (!image) throw new Error(`Cannot export missing texture: ${file}`);
    images.set(file, image);
  }
  const rasterShaders = new Map<string, IrForwardShader>();
  const analyticLights = buildSceneFrame(loaded.resources, { lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor }).analyticLights !== undefined;
  for (const [key, material] of loaded.resources.materials) {
    if (!material.surfaceModule) continue;
    for (const quality of ['interactive', 'reference'] as const) {
      const shaderKey = compiledRasterShaderKey(key, quality);
      rasterShaders.set(shaderKey, loaded.compiled?.rasterShaders.get(shaderKey) ??
        assembleIrForwardShader(material.surfaceModule, {
          displacement: material.displacement !== undefined, rasterQuality: quality,
          analyticLights,
        }));
    }
  }
  const environmentCdf = loaded.environment
    ? loaded.compiled?.environmentCdf ?? buildEnvCdf(loaded.environment.image) : undefined;
  const data: CompiledSceneData = {
    layout: {
      sceneBufferVersion: SCENE_BUFFER_CACHE_VERSION, nodeFloats: PT_NODE_FLOATS,
      triangleFloats: PT_TRIANGLE_FLOATS, materialFloats: PT_MATERIAL_FLOATS,
    },
    scene: loaded.scene, resources: loaded.resources, lights: loaded.lights, cameras: loaded.cameras,
    pathTrace, dispatch, rasterShaders, surfaces, images,
    ...(loaded.parameterResources ? { parameterResources: loaded.parameterResources } : {}),
    ...(loaded.environment ? { environment: loaded.environment } : {}),
    ...(environmentCdf ? { environmentCdf } : {}),
  };
  validateData(data);
  return encodeCompiledScene(data, loaded.entry);
}

const finiteArray = (value: unknown, length?: number): boolean =>
  (Array.isArray(value) || value instanceof Float32Array || value instanceof Float64Array) &&
  (length === undefined || value.length === length) && Array.from(value).every(Number.isFinite);
const uint = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
function fail(detail: string): never {
  throw new Error(`Invalid compiled scene: ${detail}`);
}

function validateBounds(value: unknown): void {
  if (!isRecord(value) || !finiteArray(value.min, 3) || !finiteArray(value.max, 3)) fail('bounds');
}

function validateImage(value: unknown): void {
  if (!isRecord(value) || value.kind !== 'pixels' || !uint(value.width) || value.width < 1 ||
      !uint(value.height) || value.height < 1 || ![1, 2, 3, 4].includes(Number(value.channels)) ||
      typeof value.colorSpace !== 'string' || !value.colorSpace) fail('texture metadata');
  const types = { uint8: Uint8Array, uint16: Uint16Array, float16: Uint16Array, float32: Float32Array };
  if (typeof value.componentType !== 'string' || !Object.hasOwn(types, value.componentType)) fail('texture precision');
  const ctor = types[value.componentType as keyof typeof types];
  if (!(value.data instanceof ctor) || value.data.length !== Number(value.width) * Number(value.height) * Number(value.channels)) fail('texture pixels');
  if (value.udim !== undefined) {
    if (!Array.isArray(value.udim) || !value.udim.length) fail('UDIM tiles');
    const seen = new Set<number>();
    for (const tile of value.udim) {
      if (!isRecord(tile) || !uint(tile.tile) || tile.tile < 1001 || tile.tile > 2000 || seen.has(tile.tile)) fail('UDIM index');
      seen.add(tile.tile);
      validateImage(tile.image);
      if (!isRecord(tile.image) || tile.image.udim !== undefined ||
          tile.image.width !== value.width || tile.image.height !== value.height ||
          tile.image.colorSpace !== value.colorSpace || tile.image.componentType !== value.componentType ||
          tile.image.channels !== value.channels) fail('incompatible UDIM tile');
    }
  }
}

function validateResources(value: unknown): void {
  if (!isRecord(value) || !(value.geometries instanceof Map) || !(value.materials instanceof Map) ||
      !Array.isArray(value.instances) || !Array.isArray(value.pendingGeometry) || value.pendingGeometry.length ||
      !Array.isArray(value.pendingMaterials) || value.pendingMaterials.length || !Array.isArray(value.unboundGprims) ||
      !isRecord(value.tlas) || !(value.tlas.instanceOrder instanceof Uint32Array) || !Array.isArray(value.tlas.nodes)) fail('resources');
  validateBounds(value.tlas.bounds);
  for (const [key, mesh] of value.geometries) {
    if (typeof key !== 'string' || !isRecord(mesh) || mesh.prototypeId !== key || typeof mesh.primPath !== 'string' ||
        !uint(mesh.vertexCount) || !uint(mesh.triangleCount) || !(mesh.indices instanceof Uint32Array) ||
        mesh.indices.length !== mesh.triangleCount * 3 || !Array.isArray(mesh.streams) ||
        !isRecord(mesh.blas) || !Array.isArray(mesh.blas.nodes) || !(mesh.blas.triangleOrder instanceof Uint32Array) ||
        !Array.isArray(mesh.subsets) || !isRecord(mesh.subdivision) || !isRecord(mesh.displacement)) fail('geometry');
    validateBounds(mesh.bounds);
    validateBounds(mesh.blas.bounds);
    if (mesh.indices.some(index => index >= Number(mesh.vertexCount))) fail('geometry indices');
    for (const stream of mesh.streams) {
      if (!isRecord(stream) || typeof stream.name !== 'string' || !uint(stream.components) || stream.components < 1 ||
          stream.components > 4 || !(stream.data instanceof Float32Array) ||
          !finiteArray(stream.data, mesh.vertexCount * stream.components)) fail('vertex stream');
    }
  }
  for (const [key, material] of value.materials) {
    if (typeof key !== 'string' || !isRecord(material) || material.unitKey !== key ||
        typeof material.materialName !== 'string' || !isRecord(material.features) || !Array.isArray(material.features.passes) ||
        !isRecord(material.variant) || typeof material.variant.pipelineKey !== 'string' || !Array.isArray(material.boundPrims)) fail('material');
    if (material.surfaceModule !== undefined && (!isRecord(material.surfaceModule) ||
        !Array.isArray(material.surfaceModule.textures) || !Array.isArray(material.surfaceModule.samplers))) fail('material bindings');
  }
  const ids = new Set<string>();
  for (const instance of value.instances) {
    if (!isRecord(instance) || typeof instance.id !== 'string' || ids.has(instance.id) ||
        typeof instance.primPath !== 'string' || !finiteArray(instance.transform, 16) ||
        typeof instance.hasGeometry !== 'boolean' || typeof instance.prototypeId !== 'string' ||
        (instance.hasGeometry && !value.geometries.has(instance.prototypeId)) ||
        (instance.materialKey !== undefined && !value.materials.has(instance.materialKey))) fail('instance');
    ids.add(instance.id);
  }
  const instanceCount = value.instances.length;
  if (value.tlas.instanceOrder.some(index => index >= instanceCount)) fail('TLAS instance index');
}

/** Validate descriptors and packed traversal data before passing anything to WebGPU. */
function validateData(value: unknown): asserts value is CompiledSceneData {
  if (!isRecord(value) || !isRecord(value.layout) ||
      value.layout.sceneBufferVersion !== SCENE_BUFFER_CACHE_VERSION || value.layout.nodeFloats !== PT_NODE_FLOATS ||
      value.layout.triangleFloats !== PT_TRIANGLE_FLOATS || value.layout.materialFloats !== PT_MATERIAL_FLOATS) fail('buffer layout version');
  validateResources(value.resources);
  if (value.parameterResources !== undefined) validateResources(value.parameterResources);
  if (!isRecord(value.scene) || !(value.scene.prims instanceof Map) || !isRecord(value.scene.stage) ||
      !Array.isArray(value.scene.roots) || !Array.isArray(value.scene.materials) ||
      !Array.isArray(value.lights) || !Array.isArray(value.cameras) || !(value.surfaces instanceof Map) ||
      !(value.images instanceof Map) || !(value.rasterShaders instanceof Map)) fail('scene metadata');
  if (!isRecord(value.pathTrace) || !(value.pathTrace.nodes instanceof Float32Array) ||
      !(value.pathTrace.triangles instanceof Float32Array) || !(value.pathTrace.triangleOrder instanceof Uint32Array) ||
      !(value.pathTrace.triangleUv instanceof Float32Array) || !(value.pathTrace.triangleTangent instanceof Float32Array) ||
      !uint(value.pathTrace.nodeCount) || !uint(value.pathTrace.triangleCount) ||
      !(value.pathTrace.materials instanceof Float32Array) || !uint(value.pathTrace.materialCount) ||
      value.pathTrace.materials.length !== value.pathTrace.materialCount * PT_MATERIAL_FLOATS ||
      !Array.isArray(value.pathTrace.materialKeys) || value.pathTrace.materialKeys.length !== value.pathTrace.materialCount ||
      !Array.isArray(value.pathTrace.variantSources)) fail('path tracing buffers');
  validateBounds(value.pathTrace.bounds);
  const bounds = value.pathTrace.bounds;
  // Bounds have been checked above; build the strongly typed view for the shared validator.
  if (!isRecord(bounds) || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) fail('path tracing bounds');
  validatePreparedGeometry({
    nodes: value.pathTrace.nodes, triangles: value.pathTrace.triangles, triangleOrder: value.pathTrace.triangleOrder,
    triangleUv: value.pathTrace.triangleUv, triangleTangent: value.pathTrace.triangleTangent,
    nodeCount: value.pathTrace.nodeCount, triangleCount: value.pathTrace.triangleCount,
    bounds: { min: [bounds.min[0], bounds.min[1], bounds.min[2]], max: [bounds.max[0], bounds.max[1], bounds.max[2]] },
  }, value.pathTrace.materialCount);
  if (!isRecord(value.dispatch) || typeof value.dispatch.dispatcherWgsl !== 'string' ||
      typeof value.dispatch.opacityDispatcherWgsl !== 'string' || !Array.isArray(value.dispatch.variants) ||
      !Array.isArray(value.dispatch.textures) || !Array.isArray(value.dispatch.samplers) ||
      !Array.isArray(value.dispatch.uniforms) || !Array.isArray(value.dispatch.preludes) ||
      !(value.dispatch.primvarFields instanceof Map) || !(value.dispatch.extraInputs instanceof Map) ||
      !isRecord(value.dispatch.textureRegistry) || !Array.isArray(value.dispatch.textureRegistry.images)) fail('WGSL dispatch');
  for (const [file, image] of value.images) {
    if (typeof file !== 'string') fail('texture reference');
    validateImage(image);
  }
  const images = value.images;
  const requireImage = (file: unknown): void => {
    if (file !== undefined && (typeof file !== 'string' || !images.has(file))) fail(`missing texture ${String(file)}`);
  };
  for (const file of value.dispatch.textureRegistry.images) requireImage(file);
  const resources = value.resources;
  if (!isRecord(resources) || !(resources.materials instanceof Map)) fail('materials');
  for (const [key, material] of resources.materials) {
    if (!isRecord(material)) fail('material');
    if (!value.surfaces.has(key)) fail('material surface');
    if (isRecord(material.surfaceModule)) {
      for (const quality of ['interactive', 'reference'] as const) {
        const shader = value.rasterShaders.get(compiledRasterShaderKey(key, quality));
        if (!isRecord(shader) || typeof shader.code !== 'string') fail('raster WGSL');
      }
      if (!Array.isArray(material.surfaceModule.textures)) fail('textures');
      for (const texture of material.surfaceModule.textures) {
        if (!isRecord(texture)) fail('texture binding');
        requireImage(texture.fileRef);
      }
    }
  }
  if (value.environment !== undefined) {
    if (!isRecord(value.environment) || !isRecord(value.environment.image) ||
        !uint(value.environment.image.width) || value.environment.image.width < 1 ||
        !uint(value.environment.image.height) || value.environment.image.height < 1 ||
        !(value.environment.image.data instanceof Float32Array) ||
        value.environment.image.data.length !== value.environment.image.width * value.environment.image.height * 3 ||
        !isRecord(value.environmentCdf) || !(value.environmentCdf.cdf instanceof Float32Array) ||
        value.environmentCdf.width !== value.environment.image.width || value.environmentCdf.height !== value.environment.image.height ||
        value.environmentCdf.cdf.length !== value.environment.image.width * value.environment.image.height ||
        typeof value.environmentCdf.totalSum !== 'number' || !Number.isFinite(value.environmentCdf.totalSum)) fail('environment');
  }
}

export async function loadCompiledScene(
  entry: string,
  sink: DiagnosticSink,
  fetchResource: typeof fetch = fetch,
): Promise<LoadedUsdScene> {
  try {
    const response = await fetchResource(entry);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry}`);
    const manifest: unknown = await response.json();
    const data = await decodeCompiledScene(manifest, async path => {
      const url = new URL(path, response.url || entry).href;
      const resource = await fetchResource(url);
      if (!resource.ok) throw new Error(`HTTP ${resource.status}: ${url}`);
      return new Uint8Array(await resource.arrayBuffer());
    });
    validateData(data);
    const { images, surfaces } = data;
    return {
      entry, scene: data.scene, resources: data.resources, lights: data.lights, cameras: data.cameras,
      mtlx: {
        imageProvider: { decode: file => {
          const image = images.get(file);
          if (!image) throw new Error(`Texture absent from compiled scene: ${file}`);
          return image;
        } },
        surfaceFor: material => {
          const surface = surfaces.get(material.unitKey);
          if (!surface) throw new Error(`Surface absent from compiled scene: ${material.unitKey}`);
          return surface;
        },
      },
      compiled: data, precompiled: true,
      ...(data.parameterResources ? { parameterResources: data.parameterResources } : {}),
      ...(data.environment ? { environment: data.environment } : {}),
    };
  } catch (error) {
    sink({ level: 'error', message: `Failed to load compiled scene: ${entry}`, detail: String(error) });
    throw error;
  }
}
