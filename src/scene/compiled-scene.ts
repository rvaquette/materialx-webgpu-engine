import { buildEnvCdf } from '../assets/environment-cdf.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
import { decodeBrowserImage } from '../assets/browser-image.ts';
import { decodeUdimImage } from '../assets/udim.ts';
import { AssetResolver } from '../assets/resolver.ts';
import type { DiagnosticSink } from '../core/diagnostics.ts';
import { assembleIrForwardShader, type IrForwardShader, type RasterQuality } from '../render/raster/ir-forward.ts';
import { buildSceneFrame, type RasterSurface } from '../render/raster/scene-frame.ts';
import { buildCachedPathTraceScene, PT_MATERIAL_FLOATS, PT_NODE_FLOATS, PT_TRIANGLE_FLOATS, type PathTraceScene } from '../render/pathtracing/scene-buffers.ts';
import { SCENE_BUFFER_CACHE_VERSION, validatePreparedGeometry } from '../render/pathtracing/scene-buffer-cache.ts';
import { buildMaterialDispatch, type PtMaterialDispatch } from '../render/pathtracing/material-variant.ts';
import { pathTraceSettings } from '../render/pathtracing/scene-settings.ts';
import type { LoadedUsdScene } from '../render/usd-scene-assets.ts';
import { loadEnvironment } from '../render/usd-scene-assets.ts';
import type { MaterialResource, SceneResources } from '../render/scene-resources.ts';
import type { PtImageProvider } from '../render/pathtracing/device-bindings.ts';
import { applySceneDisplacement } from '../render/displacement.ts';
import {
  decodeCompiledScene, encodeCompiledScene, isRecord,
  type ByteRange, type CompiledScenePackage, type CompiledSceneEncodeOptions,
} from './compiled-scene-codec.ts';

export interface CompiledSceneRuntime {
  pathTrace: PathTraceScene;
  dispatch: PtMaterialDispatch;
  rasterShaders: Map<string, IrForwardShader>;
  environmentCdf?: ReturnType<typeof buildEnvCdf>;
}

interface ExternalImage {
  kind: 'external';
  urls: string[];
  tiles?: number[];
}

interface CompiledSceneData extends CompiledSceneRuntime {
  layout: { sceneBufferVersion: number; nodeFloats: number; triangleFloats: number; materialFloats: number };
  scene: LoadedUsdScene['scene'];
  resources: SceneResources;
  parameterResources?: SceneResources;
  lights: LoadedUsdScene['lights'];
  cameras: LoadedUsdScene['cameras'];
  environment?: LoadedUsdScene['environment'];
  environmentSource?: Omit<NonNullable<LoadedUsdScene['environment']>, 'image'> & { url: string };
  surfaces: Map<string, RasterSurface>;
  images: Map<string, ExternalImage>;
}

export function compiledRasterShaderKey(materialKey: string, quality: RasterQuality): string {
  return `${quality}:${materialKey}`;
}

export function compiledSceneAssetUrl(
  reference: string, manifestUrl: string, appBase: string, documentBase: string,
): string {
  if (reference.startsWith('/')) {
    return new URL(`${appBase}${reference.slice(1)}`, documentBase).href;
  }
  return new URL(reference, manifestUrl).href;
}

/** Snapshot after import/displacement; material graphs are kept for explicit later edits. */
export async function exportCompiledScene(
  loaded: LoadedUsdScene, options: CompiledSceneEncodeOptions = {},
): Promise<CompiledScenePackage> {
  if (loaded.resources.pendingGeometry.length || loaded.resources.pendingMaterials.length) {
    throw new Error('Cannot export a scene with missing geometry or materials.');
  }
  const surfaces = new Map([...loaded.resources.materials].map(([key, material]) => [key, loaded.mtlx.surfaceFor(material)]));
  options.onProgress?.('Preparing path tracing buffers and BVH...');
  const pathTrace = loaded.compiled?.pathTrace ?? await buildCachedPathTraceScene(loaded.resources, {
    lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor, settings: pathTraceSettings(loaded.scene),
  });
  options.onProgress?.(`Path tracing ready: ${pathTrace.triangleCount} triangles, ${pathTrace.nodeCount} BVH nodes.`);
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
  const sourceEntry = new URL(loaded.entry, typeof document === 'undefined' ? undefined : document.baseURI);
  const portableUrl = (url: URL): string => url.origin === sourceEntry.origin
    ? `${url.pathname}${url.search}${url.hash}` : url.href;
  const images = await collectExternalImages(loaded, files);
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
  let environmentSource: CompiledSceneData['environmentSource'];
  if (loaded.environment) {
    const dome = loaded.lights.find(light => light.type === 'dome' && light.textureFile);
    if (!dome?.textureFile) throw new Error('Cannot export environment without its original image reference.');
    environmentSource = {
      url: portableUrl(new URL(dome.textureFile, new URL(dome.textureSourceLayer ?? sourceEntry.href, sourceEntry))),
      sh: loaded.environment.sh, averageRadiance: loaded.environment.averageRadiance,
      tint: loaded.environment.tint, intensity: loaded.environment.intensity,
    };
  }
  const data: CompiledSceneData = {
    layout: {
      sceneBufferVersion: SCENE_BUFFER_CACHE_VERSION, nodeFloats: PT_NODE_FLOATS,
      triangleFloats: PT_TRIANGLE_FLOATS, materialFloats: PT_MATERIAL_FLOATS,
    },
    scene: loaded.scene, resources: loaded.resources, lights: loaded.lights, cameras: loaded.cameras,
    pathTrace, dispatch, rasterShaders, surfaces, images,
    ...(loaded.parameterResources ? { parameterResources: loaded.parameterResources } : {}),
    ...(environmentSource ? { environmentSource } : {}),
  };
  options.onProgress?.('Validating prepared scene...');
  validateData(data);
  options.onProgress?.('Encoding and compressing prepared scene...');
  return encodeCompiledScene(data, loaded.entry, options);
}

/** Texture files keep their opaque compile-time keys; URLs are portable relative to the app. */
async function collectExternalImages(loaded: LoadedUsdScene, files: Iterable<string>): Promise<Map<string, ExternalImage>> {
  const sourceEntry = new URL(loaded.entry, typeof document === 'undefined' ? undefined : document.baseURI);
  const portableUrl = (url: URL): string => url.origin === sourceEntry.origin
    ? `${url.pathname}${url.search}${url.hash}` : url.href;
  const materialDirectories = [...new Set(loaded.scene.materials.map(ref =>
    new URL('.', new URL(ref.assetPath, new URL(ref.authoringLayer ?? loaded.entry, sourceEntry))).href))];
  if (!materialDirectories.length) materialDirectories.push(new URL('.', sourceEntry).href);
  const images = new Map<string, ExternalImage>();
  for (const file of files) {
    const image = await loaded.mtlx.imageProvider.decode(file);
    if (!image) throw new Error(`Cannot export missing texture: ${file}`);
    images.set(file, {
      kind: 'external',
      urls: [...new Set(materialDirectories.map(dir => portableUrl(new URL(AssetResolver.normalizeUdim(file), dir))))],
      ...(image.udim ? { tiles: image.udim.map(tile => tile.tile) } : {}),
    });
  }
  return images;
}

interface CompiledMaterialData {
  kind: 'material';
  material: MaterialResource;
  surface: RasterSurface;
  images: Map<string, ExternalImage>;
}

export interface CompiledMaterial {
  url: string;
  material: MaterialResource;
  surface: RasterSurface;
  imageProvider: PtImageProvider;
}

/** Precompiled MaterialX material (graph, WGSL, parameters), applied to compiled scenes without MaterialX. */
export async function exportCompiledMaterial(
  loaded: LoadedUsdScene, primPath: string, options: CompiledSceneEncodeOptions = {},
): Promise<CompiledScenePackage> {
  if (loaded.resources.pendingMaterials.length) throw new Error('Cannot export a material that failed to compile.');
  const source = loaded.parameterResources ?? loaded.resources;
  const key = source.instances.find(instance => instance.primPath === primPath)?.materialKey;
  const material = key ? source.materials.get(key) : undefined;
  if (!material) throw new Error(`No compiled material bound to ${primPath}.`);
  const pathTrace = await buildCachedPathTraceScene(loaded.resources, {
    lights: loaded.lights, surfaceFor: loaded.mtlx.surfaceFor, settings: pathTraceSettings(loaded.scene),
  });
  const files = new Set(buildMaterialDispatch(pathTrace.variantSources).textureRegistry.images
    .filter((file): file is string => file !== undefined));
  for (const candidate of [material, loaded.resources.materials.get(key!)]) {
    for (const texture of candidate?.surfaceModule?.textures ?? []) if (texture.fileRef !== undefined) files.add(texture.fileRef);
    if (candidate?.displacement) files.add(candidate.displacement.file);
  }
  const data: CompiledMaterialData = {
    kind: 'material',
    material: { ...material, boundPrims: [] },
    surface: loaded.mtlx.surfaceFor(material),
    images: await collectExternalImages(loaded, files),
  };
  validateMaterialData(data);
  return encodeCompiledScene(data, loaded.entry, options);
}

export async function loadCompiledMaterial(url: string, fetchResource: typeof fetch = fetch): Promise<CompiledMaterial> {
  const response = await fetchResource(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const base = response.url || url;
  const manifest: unknown = await response.json();
  const data = await decodeCompiledScene(manifest, packageReader(manifest, base, fetchResource));
  validateMaterialData(data);
  return {
    url, material: data.material, surface: data.surface,
    imageProvider: externalImageProvider(data.images, base, fetchResource, 'compiled material'),
  };
}

/** Bind precompiled materials to objects of a compiled scene; geometry and GPU buffers are rebuilt from its data. */
export async function applyCompiledMaterials(
  base: LoadedUsdScene, overrides: ReadonlyMap<string, CompiledMaterial>,
): Promise<LoadedUsdScene> {
  const source = base.parameterResources ?? base.resources;
  const materials = new Map(source.materials);
  const surfaces = new Map<string, RasterSurface>();
  const providers: PtImageProvider[] = [];
  const unknown = new Set(overrides.keys());
  const instances = source.instances.map(instance => {
    const override = overrides.get(instance.primPath);
    if (!override || !instance.hasGeometry) return instance;
    unknown.delete(instance.primPath);
    const key = `${override.material.unitKey}::override::${instance.primPath}`;
    materials.set(key, { ...override.material, unitKey: key, boundPrims: [instance.primPath] });
    surfaces.set(key, override.surface);
    if (!providers.includes(override.imageProvider)) providers.push(override.imageProvider);
    return { ...instance, materialKey: key };
  });
  if (unknown.size) throw new Error(`Unknown object: ${[...unknown].join(', ')}`);
  const used = new Set(instances.map(instance => instance.materialKey));
  for (const key of materials.keys()) if (!used.has(key)) materials.delete(key);
  const parameterResources: SceneResources = { ...source, instances, materials };
  const fallback = base.mtlx.imageProvider;
  const mtlx = {
    ...base.mtlx,
    surfaceFor: (material: MaterialResource) => surfaces.get(material.unitKey) ?? base.mtlx.surfaceFor(material),
    imageProvider: { decode: async (file: string) => {
      for (const provider of providers) {
        try {
          const image = await provider.decode(file);
          if (image) return image;
        } catch (error) {
          if (!(error instanceof MissingCompiledImageError)) throw error;
        }
      }
      return fallback.decode(file);
    } },
  };
  const resources = await applySceneDisplacement(parameterResources, mtlx.imageProvider);
  const result: LoadedUsdScene = { ...base, resources, parameterResources, mtlx };
  delete result.compiled;
  return result;
}

export interface CompiledLayerReferences {
  scene: string;
  shaders?: string;
  buffers?: string;
  source?: string;
}

export const COMPILED_LAYER_KEYS = {
  scene: 'materialx:compiledScene',
  shaders: 'materialx:compiledShaders',
  buffers: 'materialx:compiledBuffers',
  source: 'materialx:source',
} as const;

/** Compiled binaries referenced by a USDA layer's customLayerData, resolved against the layer URL. */
export function parseCompiledLayerReferences(text: string, layerUrl: string): CompiledLayerReferences | undefined {
  const header = /^#usda[^\n]*\r?\n\s*\(([\s\S]*?)\r?\n\)/.exec(text)?.[1];
  const data = header && /customLayerData\s*=\s*\{([\s\S]*?)\}/.exec(header)?.[1];
  if (!data) return undefined;
  const values = new Map<string, string>();
  for (const match of data.matchAll(/(?:string|asset)\s+"([^"]+)"\s*=\s*(?:"([^"]*)"|@([^@]*)@)/g)) {
    values.set(match[1]!, match[2] ?? match[3]!);
  }
  const scene = values.get(COMPILED_LAYER_KEYS.scene);
  if (!scene) return undefined;
  const shaders = values.get(COMPILED_LAYER_KEYS.shaders);
  const buffers = values.get(COMPILED_LAYER_KEYS.buffers);
  const source = values.get(COMPILED_LAYER_KEYS.source);
  return {
    scene: new URL(scene, layerUrl).href,
    ...(shaders ? { shaders: new URL(shaders, layerUrl).href } : {}),
    ...(buffers ? { buffers: new URL(buffers, layerUrl).href } : {}),
    ...(source ? { source: new URL(source, layerUrl).href } : {}),
  };
}

/** Reads only the layer header, so plain USDA sources are not downloaded twice. */
export async function readCompiledLayerReferences(
  entry: string, fetchResource: typeof fetch = fetch,
): Promise<CompiledLayerReferences | undefined> {
  const response = await fetchResource(entry);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry}`);
  const reader = response.body?.getReader();
  if (!reader) return parseCompiledLayerReferences(await response.text(), response.url || entry);
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < 65536 && !/\r?\n\)/.test(text)) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return parseCompiledLayerReferences(text, response.url || entry);
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
      value.pathTrace.materials.length !== Math.max(value.pathTrace.materialCount, 1) * PT_MATERIAL_FLOATS ||
      !Array.isArray(value.pathTrace.materialKeys) || value.pathTrace.materialKeys.length !== value.pathTrace.materialCount ||
      !Array.isArray(value.pathTrace.variantSources)) fail('path tracing buffers');
  const atlas = value.pathTrace.volumeData;
  if (atlas !== undefined && (!(atlas instanceof Float32Array) || !atlas.length || !finiteArray(atlas))) fail('volume atlas');
  for (let index = 0; index < value.pathTrace.materialCount; index++) {
    const b = index*PT_MATERIAL_FLOATS;
    const records = value.pathTrace.materials;
    const size = records[b+41]!;
    if (size === 0) continue;
    const offset = records[b+42]!, majorant = records[b+49]!;
    if (!(atlas instanceof Float32Array) || !uint(size) || size < 2 || !uint(offset) ||
        offset+size**3*10 > atlas.length || !Number.isFinite(majorant) || majorant < 0 ||
        [46,47,48].some(slot => !(records[b+slot]! > 0))) fail('volume grid layout');
    for (let voxel = offset; voxel < offset+size**3*10; voxel += 10) {
      for (let c=0;c<3;c++) {
        if (atlas[voxel+c]! < 0 || atlas[voxel+3+c]! < 0 || atlas[voxel+7+c]! < 0 ||
            atlas[voxel+c]!+atlas[voxel+3+c]! > majorant*(1+1e-5)) fail('volume coefficients or majorant');
      }
      if (Math.abs(atlas[voxel+6]!) >= 1) fail('volume anisotropy');
    }
  }
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
  validateExternalImages(value.images);
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
  if (value.environment !== undefined || value.environmentCdf !== undefined) fail('embedded environment is unsupported');
        if (value.environmentSource !== undefined) {
          const source = value.environmentSource;
          if (!isRecord(source) || typeof source.url !== 'string' ||
          (!source.url.startsWith('/') && !/^https?:\/\//i.test(source.url)) ||
          !finiteArray(source.averageRadiance, 3) || !finiteArray(source.tint, 3) ||
          !(source.sh instanceof Float32Array) || !finiteArray(source.sh, 27) ||
          typeof source.intensity !== 'number' || !Number.isFinite(source.intensity)) fail('external environment');
        }
}

function validateMaterialData(value: unknown): asserts value is CompiledMaterialData {
  if (!isRecord(value) || value.kind !== 'material' || !isRecord(value.material) || !isRecord(value.surface) ||
      !(value.images instanceof Map)) fail('material package');
  const material = value.material;
  validateResources({
    geometries: new Map(), materials: new Map([[material.unitKey, material]]), instances: [], pendingGeometry: [],
    pendingMaterials: [], unboundGprims: [], tlas: { instanceOrder: new Uint32Array(), nodes: [], bounds: { min: [0, 0, 0], max: [0, 0, 0] } },
  });
  validateExternalImages(value.images);
  for (const texture of isRecord(material.surfaceModule) && Array.isArray(material.surfaceModule.textures)
    ? material.surfaceModule.textures : []) {
    if (!isRecord(texture) || (texture.fileRef !== undefined && (typeof texture.fileRef !== 'string' ||
        !value.images.has(texture.fileRef)))) fail('material texture');
  }
  if (isRecord(material.displacement) && !value.images.has(String(material.displacement.file))) fail('displacement texture');
}

function validateExternalImages(images: Map<unknown, unknown>): void {
  for (const [file, image] of images) {
    if (typeof file !== 'string') fail('texture reference');
    if (!isRecord(image) || image.kind !== 'external' || !Array.isArray(image.urls) ||
        !image.urls.length || image.urls.some(url => typeof url !== 'string' || !url ||
          (!url.startsWith('/') && !/^https?:\/\//i.test(url)))) fail('external texture URL');
    if (image.tiles !== undefined && (!Array.isArray(image.tiles) || !image.tiles.length ||
        image.tiles.some(tile => !uint(tile) || tile < 1001 || tile > 1999) ||
        new Set(image.tiles).size !== image.tiles.length)) fail('external UDIM tiles');
  }
}

class MissingCompiledImageError extends Error {}

async function fetchBytes(url: string, fetchResource: typeof fetch): Promise<Uint8Array> {
  const resource = await fetchResource(url);
  if (!resource.ok) throw new Error(`HTTP ${resource.status}: ${url}`);
  return new Uint8Array(await resource.arrayBuffer());
}

/**
 * Resolves a package's packed files: explicit overrides (USDA references), then shared-pack
 * `location`s, then siblings of the manifest. Ranged reads fall back to slicing the whole file
 * when the server ignores `Range`.
 */
function packageReader(
  manifest: unknown, base: string, fetchResource: typeof fetch, overrides: Readonly<Record<string, string | undefined>> = {},
): (path: string, range?: ByteRange) => Promise<Uint8Array<ArrayBuffer>> {
  const files = isRecord(manifest) && Array.isArray(manifest.files) ? manifest.files : [];
  const urlOf = (path: string): string => {
    const override = overrides[path];
    if (override) return override;
    const location = files.find(file => isRecord(file) && file.path === path && typeof file.location === 'string')?.location;
    return new URL(typeof location === 'string' ? location : path, base).href;
  };
  const whole = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
  return async (path, range) => {
    const url = urlOf(path);
    if (!range) return fetchBytes(url, fetchResource) as Promise<Uint8Array<ArrayBuffer>>;
    let full = whole.get(url);
    if (!full) {
      const response = await fetchResource(url, { headers: { Range: `bytes=${range.offset}-${range.offset + range.length - 1}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (response.status === 206) return bytes;
      full = Promise.resolve(bytes);
      whole.set(url, full);
    }
    return (await full).slice(range.offset, range.offset + range.length);
  };
}

const appBaseUrl = (): string => typeof document === 'undefined' ? '/' : import.meta.env.BASE_URL;
const documentBaseUrl = (fallback: string): string => typeof document === 'undefined' ? fallback : document.baseURI;

/** Lazily fetches and caches exported texture references (app-relative or absolute URLs). */
function externalImageProvider(
  images: ReadonlyMap<string, ExternalImage>, base: string, fetchResource: typeof fetch, label: string,
): PtImageProvider {
  const appBase = appBaseUrl();
  const documentBase = documentBaseUrl(base);
  const decodedImages = new Map<string, Promise<DecodedPixelImage>>();
  const decodeExternal = async (image: ExternalImage): Promise<DecodedPixelImage> => {
    const decode = async (url: string): Promise<DecodedPixelImage | undefined> => {
      const resource = await fetchResource(url);
      if (resource.status === 404) return undefined;
      if (!resource.ok) throw new Error(`HTTP ${resource.status}: ${url}`);
      return decodeBrowserImage(await resource.blob(), url);
    };
    for (const reference of image.urls) {
      const url = compiledSceneAssetUrl(reference, base, appBase, documentBase);
      if (image.tiles) {
        const first = await decode(AssetResolver.expandUdim(url, image.tiles[0]!));
        if (!first) continue;
        return decodeUdimImage(url, image.tiles, tile => tile === AssetResolver.expandUdim(url, image.tiles![0]!)
          ? Promise.resolve(first) : decode(tile));
      }
      const decoded = await decode(url);
      if (decoded) return decoded;
    }
    throw new Error(`Missing external texture: ${image.urls.join(', ')}`);
  };
  return { decode: file => {
    const image = images.get(file);
    if (!image) throw new MissingCompiledImageError(`Texture absent from ${label}: ${file}`);
    let decoded = decodedImages.get(file);
    if (!decoded) {
      decoded = decodeExternal(image).catch(error => { decodedImages.delete(file); throw error; });
      decodedImages.set(file, decoded);
    }
    return decoded;
  } };
}

export interface CompiledSceneLoadOptions {
  /** Overrides the location of the grouped WGSL payload (from a USDA `materialx:compiledShaders` reference). */
  shaders?: string;
  /** Overrides the location of the (possibly shared) buffer pack (from a USDA `materialx:compiledBuffers` reference). */
  buffers?: string;
}

export async function loadCompiledScene(
  entry: string,
  sink: DiagnosticSink,
  fetchResource: typeof fetch = fetch,
  options: CompiledSceneLoadOptions = {},
): Promise<LoadedUsdScene> {
  try {
    const response = await fetchResource(entry);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${entry}`);
    const manifest: unknown = await response.json();
    const data = await decodeCompiledScene(manifest, packageReader(manifest, response.url || entry, fetchResource, {
      'shaders.wgsl.zst': options.shaders, 'buffers.bin.zst': options.buffers,
    }));
    validateData(data);
    const appBase = appBaseUrl();
    const documentBase = documentBaseUrl(response.url || entry);
    if (data.environmentSource) {
      const { url, ...parameters } = data.environmentSource;
      const dome = data.lights.find(light => light.type === 'dome');
      if (!dome) throw new Error('Missing dome light for external environment.');
      const imageUrl = compiledSceneAssetUrl(url, response.url || entry, appBase, documentBase);
      const environmentLight = { ...dome, textureFile: imageUrl, textureSourceLayer: imageUrl };
      delete environmentLight.irradianceFile;
      const environment = await loadEnvironment([environmentLight], imageUrl, sink, fetchResource);
      if (!environment) throw new Error(`Missing external environment: ${imageUrl}`);
      data.environment = { ...parameters, image: environment.image };
      data.environmentCdf = buildEnvCdf(environment.image);
    }
    const { images, surfaces } = data;
    return {
      entry, scene: data.scene, resources: data.resources, lights: data.lights, cameras: data.cameras,
      mtlx: {
        imageProvider: externalImageProvider(images, response.url || entry, fetchResource, 'compiled scene'),
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
