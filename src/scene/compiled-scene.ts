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
import type { SceneResources } from '../render/scene-resources.ts';
import {
  decodeCompiledScene, encodeCompiledScene, isRecord,
  type CompiledScenePackage, type CompiledSceneEncodeOptions,
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
  for (const [file, image] of value.images) {
    if (typeof file !== 'string') fail('texture reference');
    if (!isRecord(image) || image.kind !== 'external' || !Array.isArray(image.urls) ||
        !image.urls.length || image.urls.some(url => typeof url !== 'string' || !url ||
          (!url.startsWith('/') && !/^https?:\/\//i.test(url)))) fail('external texture URL');
    if (image.tiles !== undefined && (!Array.isArray(image.tiles) || !image.tiles.length ||
        image.tiles.some(tile => !uint(tile) || tile < 1001 || tile > 1999) ||
        new Set(image.tiles).size !== image.tiles.length)) fail('external UDIM tiles');
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
    if (data.environmentSource) {
      const { url, ...parameters } = data.environmentSource;
      const dome = data.lights.find(light => light.type === 'dome');
      if (!dome) throw new Error('Missing dome light for external environment.');
      const imageUrl = new URL(url, response.url || entry).href;
      const environmentLight = { ...dome, textureFile: imageUrl, textureSourceLayer: imageUrl };
      delete environmentLight.irradianceFile;
      const environment = await loadEnvironment([environmentLight], imageUrl, sink, fetchResource);
      if (!environment) throw new Error(`Missing external environment: ${imageUrl}`);
      data.environment = { ...parameters, image: environment.image };
      data.environmentCdf = buildEnvCdf(environment.image);
    }
    const { images, surfaces } = data;
    const decodedImages = new Map<string, Promise<DecodedPixelImage>>();
    const decodeExternal = async (image: ExternalImage): Promise<DecodedPixelImage> => {
      const base = response.url || entry;
      const decode = async (url: string): Promise<DecodedPixelImage | undefined> => {
        const resource = await fetchResource(url);
        if (resource.status === 404) return undefined;
        if (!resource.ok) throw new Error(`HTTP ${resource.status}: ${url}`);
        return decodeBrowserImage(await resource.blob(), url);
      };
      for (const reference of image.urls) {
        const url = new URL(reference, base).href;
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
    return {
      entry, scene: data.scene, resources: data.resources, lights: data.lights, cameras: data.cameras,
      mtlx: {
        imageProvider: { decode: file => {
          const image = images.get(file);
          if (!image) throw new Error(`Texture absent from compiled scene: ${file}`);
          let decoded = decodedImages.get(file);
          if (!decoded) {
            decoded = decodeExternal(image).catch(error => { decodedImages.delete(file); throw error; });
            decodedImages.set(file, decoded);
          }
          return decoded;
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
