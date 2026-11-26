import { applyDefaultVolumeMaterials, loadSceneVolumes, volumeBoxMesh, type SceneVolume } from './scene-volumes.ts';
import { curvesToMesh, pointsToMesh } from '../scene/procedural-geometry.ts';
import { IMPLICIT_GPRIMS, isMeshPrim } from '../scene/types.ts';
import { applyDefaultGprimMaterials, gprimToMesh } from '../scene/primitives.ts';
// Shared USD -> GPU asset loading used by both the offscreen capture harness
// (tests/render/usd-scene.harness.ts) and the interactive viewer (src/render/
// viewer.ts). It fetches a .usda stage plus its referenced .mtlx layers over HTTP,
// imports the composed stage, loads the MaterialX Core WASM + standard libraries,
// compiles every material through the shared graph path, and exposes the texture
// image provider + raster surface resolver both backends consume. Keeping this in
// one place means the live app and the capture harness shade identical materials.

import {
  NEUTRAL_SURFACE,
  type RasterSurface,
} from './raster/scene-frame.ts';
import {
  buildSceneResources,
  requireCompiledMaterials,
  type MaterialResource,
  type MeshSource,
  type SceneResources,
} from './scene-resources.ts';
import { createGraphMaterialCompiler } from './graph-material-compiler.ts';
import { loadMaterialXDocuments } from '../materialx/document-source.ts';
import { loadMaterialXCore } from '../materialx/wasm.ts';
import { loadSharedMaterialXLibraries, defaultLibrarySources } from '../materialx/libraries.ts';
import type { ResolvedNodeDefRef } from '../materialx/graph.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
import { DecodedImageCache } from '../assets/decoded-image-cache.ts';
import { AsyncResourceCache } from '../assets/cache.ts';
import { decodeBrowserImage } from '../assets/browser-image.ts';
import { imageSamplerDescriptor } from '../assets/samplers.ts';
import { decodeHdr, type HdrImage } from '../assets/hdr.ts';
import { projectIrradianceSH, averageRadiance, type IrradianceSH } from './env/irradiance.ts';
import type { Vec3 } from '../scene/transforms.ts';
import {
  parseSurfaceInputsFromMtlx,
  parsedSurfaceToCanonical,
} from '../materialx/surface-from-inputs.ts';
import type { PtImageProvider } from './pathtracing/device-bindings.ts';
import { importCameras, type SceneCamera } from '../usd/cameras.ts';
import { importLights, type SceneLight } from '../usd/lights.ts';
import type { UsdLayerReader } from '../usd/importer.ts';
import { importUsdStage } from '../usd/importer.ts';
import { lowerPreviewSurfaceMaterials } from '../usd/preview-surface.ts';
import type { RawMesh, Primvar, PrimvarInterpolation } from '../geometry/prepare.ts';
import type { MaterialXReference, SceneAsset, ScenePrim } from '../scene/types.ts';
import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import { loadExternalMeshSource } from '../geometry/external-mesh.ts';
import { composeStage } from '../usd/compose.ts';
import { loadBrowserOpenUsd } from '../usd/browser-loader.ts';
import { AssetResolver } from '../assets/resolver.ts';
import { withUdimImages } from '../assets/udim.ts';
import { sceneUdimIndex, sceneUdimTiles } from '../assets/scene-udim.ts';
import { uploadMaterialImage } from '../gpu/material-texture.ts';
import type { OpenUsdModule } from '../usd/crate.ts';
import { FloatType } from 'three';
import { applySceneDisplacement } from './displacement.ts';
import { editableSceneMaterials, uniformSceneMaterials } from './material-parameters.ts';
import { evaluateSceneAt, sceneTimeline } from '../scene/time.ts';
import type { CompiledSceneRuntime } from '../scene/compiled-scene.ts';
import type { RuntimeAssetUrls } from '../assets/runtime.ts';

/** App-relative paths also work when dist/ is served below the workspace root. */
const MATERIALX_ROOT = `${import.meta.env.BASE_URL}materialx/`;
const MATERIALX_LIBRARIES_ROOT = `${MATERIALX_ROOT}libraries`;
const appAssetUrl = (path: string): string => new URL(path, document.baseURI).href;
const decodedTextureCache = new DecodedImageCache();
const decodedEnvironmentCache = new AsyncResourceCache<HdrImage>({
  maxBytes: 128 * 1024 * 1024,
  onDiagnostic: (diagnostic) => console.warn(diagnostic.message),
});

class MissingTextureError extends Error {
  override readonly name = 'MissingTextureError';
}

/** Directory portion of a URL-ish path, keeping the trailing slash. */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

/** Resolves a relative layer uri against a base directory (no .. handling needed). */
export function joinUrl(baseDir: string, rel: string): string {
  if (rel.startsWith('/') || /^[a-z][a-z0-9+.-]*:/i.test(rel)) return rel;
  return baseDir + rel.replace(/^\.\//, '');
}

/** Reads USD layers over HTTP, resolving relative sublayers against the entry dir. */
export function httpReader(entry: string): UsdLayerReader {
  const baseDir = dirOf(entry);
  return {
    async read(uri: string): Promise<string> {
      const url = uri.startsWith('/') || /^https?:/.test(uri) ? uri : joinUrl(baseDir, uri);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res.text();
    },
  };
}

/** Flat numeric attribute array (point3f[]/int[] flatten to number[]). */
function numArray(prim: ScenePrim, name: string): number[] {
  const value = prim.attributes.get(name)?.value;
  return Array.isArray(value) ? (value as readonly unknown[]).map((v) => Number(v)) : [];
}

/** Supplies inline USDA mesh geometry per prototype prim path. */
export function meshSourceFromScene(scene: SceneAsset, volumes?: ReadonlyMap<string, SceneVolume>): MeshSource {
  return {
    meshFor(primPath: string): RawMesh | undefined {
      const prim = scene.prims.get(primPath);
      if (!prim) return undefined;
      if (prim.typeName === 'Volume') {
        const volume = volumes?.get(primPath);
        return volume ? volumeBoxMesh(volume) : undefined;
      }
      if (prim.typeName === 'BasisCurves') return curvesToMesh(prim);
      if (prim.typeName === 'Points') return pointsToMesh(prim);
      if (IMPLICIT_GPRIMS.has(prim.typeName ?? '')) return gprimToMesh(prim);
      const points = numArray(prim, 'points');
      const faceVertexCounts = numArray(prim, 'faceVertexCounts');
      const faceVertexIndices = numArray(prim, 'faceVertexIndices');
      if (points.length === 0 || faceVertexCounts.length === 0 || faceVertexIndices.length === 0) {
        return undefined;
      }
      const orientation = prim.attributes.get('orientation')?.value;
      const leftHanded = orientation === 'leftHanded';
      const normalValues = numArray(prim, 'normals');
      const normalInterp = prim.attributes.get('normals')?.interpolation as PrimvarInterpolation | undefined;
      const normals: Primvar | undefined =
        normalValues.length > 0
          ? { name: 'normals', interpolation: normalInterp ?? 'faceVarying', values: normalValues, elementSize: 3,
            ...(prim.attributes.has('normals:indices') ? { indices: numArray(prim, 'normals:indices') } : {}) }
          : undefined;
      const stValues = numArray(prim, 'primvars:st');
      const stInterp = prim.attributes.get('primvars:st')?.interpolation as PrimvarInterpolation | undefined;
      const st: Primvar | undefined =
        stValues.length > 0
          ? { name: 'st', interpolation: stInterp ?? 'faceVarying', values: stValues, elementSize: 2,
            ...(prim.attributes.has('primvars:st:indices') ? { indices: numArray(prim, 'primvars:st:indices') } : {}) }
          : undefined;
      return {
        points,
        faceVertexCounts,
        faceVertexIndices,
        ...(leftHanded ? { leftHanded: true } : {}),
        ...(normals ? { normals } : {}),
        ...(st ? { primvars: [st] } : {}),
      };
    },
  };
}

/** Resolve a .mtlx surface to the canonical raster surface via the shared bridge. */
export function surfaceFromMtlx(text: string): RasterSurface {
  const spec = parseSurfaceInputsFromMtlx(text);
  if (!spec) return { ...NEUTRAL_SURFACE, baseColor: [...NEUTRAL_SURFACE.baseColor] };
  const c = parsedSurfaceToCanonical(spec);
  return {
    baseColor: [c.baseColor[0], c.baseColor[1], c.baseColor[2]],
    metalness: c.metalness,
    roughness: c.roughness,
    transmission: c.transmission,
    subsurface: c.subsurface,
    ior: c.ior,
    specular: c.specular,
  };
}

export interface MtlxSceneContext {
  documents?: Awaited<ReturnType<typeof loadMaterialXDocuments>>;
  nodeDefinitions?: readonly ResolvedNodeDefRef[];
  imageProvider: PtImageProvider;
  surfaceFor: (material: MaterialResource) => RasterSurface;
}

export function resolveMaterialTextureUrl(file: string, directory: string, textureRoot?: string, filePrefix = ''): string {
  const absolute = /^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(file);
  return new URL(absolute ? file : filePrefix + file, textureRoot ?? directory).href;
}

export function resolveMaterialImageUrls(text: string, directory: string, textureRoot?: string): string {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Invalid MaterialX XML.');
  for (const input of document.querySelectorAll('[type="filename"][value]')) {
    const file = input.getAttribute('value');
    if (!file) continue;
    let scope: Element | null = input;
    while (scope && !scope.hasAttribute('fileprefix')) scope = scope.parentElement;
    const filePrefix = scope?.getAttribute('fileprefix') ?? '';
    input.setAttribute('value', resolveMaterialTextureUrl(file, new URL(directory, window.location.href).href, textureRoot, filePrefix));
  }
  // Filenames are now absolute; Core must not apply the inherited prefix again.
  for (const scope of document.querySelectorAll('[fileprefix]')) scope.removeAttribute('fileprefix');
  return new XMLSerializer().serializeToString(document);
}

/** Load the MaterialX Core WASM + standard libraries, read every referenced .mtlx
 *  into a document source, and return the graph-compiler document set plus an image
 *  provider that decodes texture files off a 2D canvas. */
export async function loadMtlxSceneContext(
  scene: SceneAsset,
  entry: string,
  sink: DiagnosticSink,
  line: (m: string) => void = () => {},
  textureRoot?: string,
  materialTexts?: ReadonlyMap<string, string>,
  runtimeAssets?: RuntimeAssetUrls,
  prelowered?: PreviewSurfaceLowering,
): Promise<MtlxSceneContext & { documents: Awaited<ReturnType<typeof loadMaterialXDocuments>> }> {
  const baseDir = dirOf(entry);
  const surfaces = new Map<string, RasterSurface>();
  const texts = new Map<string, string>();
  const materialDirs: string[] = [];
  const { authored, lowered } = prelowered ?? lowerScenePreviewSurfaces(scene, sink);
  for (const ref of authored) {
    const url = new URL(ref.assetPath, new URL(ref.authoringLayer ?? entry, document.baseURI)).href;
    const dir = dirOf(url);
    if (!materialDirs.includes(dir)) materialDirs.push(dir);
    try {
      let xml = materialTexts?.get(ref.assetPath);
      if (xml === undefined) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
        xml = await response.text();
      }
      const text = resolveMaterialImageUrls(xml, dir, ref.authoringLayer ? textureRoot : undefined);
      texts.set(ref.assetPath, text);
      surfaces.set(ref.materialName, surfaceFromMtlx(text));
    } catch (error) {
      sink({ level: 'error', message: `Failed to load MaterialX: ${url}`, detail: String(error) });
      throw error;
    }
  }
  if (lowered.length > 0 && !materialDirs.includes(baseDir)) materialDirs.push(baseDir);
  for (const material of lowered) {
    texts.set(material.reference.assetPath, resolveMaterialImageUrls(material.xml, baseDir));
    surfaces.set(material.reference.materialName, surfaceFromMtlx(material.xml));
  }
  const coreRoot = runtimeAssets?.materialxCore ?? appAssetUrl(MATERIALX_ROOT);
  const core = await loadMaterialXCore({
    moduleUrl: new URL('JsMaterialXCore.js', coreRoot).href,
    locateFile: (path) => new URL(path, coreRoot).href,
    onDiagnostic: sink,
  });
  const libraries = await loadSharedMaterialXLibraries(core, {
    sources: defaultLibrarySources(runtimeAssets?.materialxLibraries ?? appAssetUrl(MATERIALX_LIBRARIES_ROOT)),
    fetchText: async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return response.text();
    },
    onDiagnostic: sink,
  });
  const documents = await loadMaterialXDocuments({ core, libraries, texts, sink });
  const singleImageProvider: PtImageProvider = {
    async decode(fileRef: string): Promise<DecodedPixelImage | undefined> {
      for (const dir of materialDirs) {
        const url = joinUrl(dir, fileRef);
        try {
          return await decodedTextureCache.get(url, async (signal) => {
            const resp = await fetch(url, { signal });
            if (resp.status === 404) throw new MissingTextureError(`Texture not found: ${url}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status} for texture ${url}`);
            try {
              return await decodeBrowserImage(await resp.blob(), url);
            } catch (error) {
              sink({ level: 'error', message: `Texture decode failed: ${url}`, detail: { error: String(error) } });
              throw error;
            }
          });
        } catch (error) {
          if (error instanceof MissingTextureError) continue;
          throw error;
        }
      }
      line(`Texture introuvable: ${fileRef}`);
      return undefined;
    },
  };
  const imageProvider: PtImageProvider = {
    decode: withUdimImages(async file => singleImageProvider.decode(file),
      () => sceneUdimIndex(document.baseURI), new URL(baseDir, document.baseURI).href, sink),
    exportSource(fileRef) {
      const urls = [...new Set(materialDirs.map(dir => new URL(fileRef, new URL(dir, document.baseURI)).href))];
      if (AssetResolver.hasUdim(fileRef)) {
        for (const url of urls) {
          const tiles = sceneUdimTiles(url, document.baseURI);
          if (tiles.length) return { urls: [url], tiles };
        }
      }
      return { urls };
    },
  };
  const surfaceFor = (material: MaterialResource): RasterSurface => surfaces.get(material.materialName) ?? NEUTRAL_SURFACE;
  return { documents, nodeDefinitions: documents.nodeDefinitions?.() ?? [], imageProvider, surfaceFor };
}

/** Decode + upload every texture a compiled surface module samples and key the GPU
 *  views/samplers by the module binding name so createSceneBindGroups can wire them. */
export async function uploadMaterialTextures(
  device: GPUDevice,
  material: MaterialResource,
  imageProvider: PtImageProvider,
  cache: Map<string, DecodedPixelImage | undefined>,
): Promise<{ textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler>; textures: GPUTexture[] }> {
  const textureViews = new Map<string, GPUTextureView>();
  const samplers = new Map<string, GPUSampler>();
  const textures: GPUTexture[] = [];
  const module = material.surfaceModule;
  if (!module) return { textureViews, samplers, textures };
  try {
    for (const t of module.textures) {
      const fileRef = t.fileRef;
      if (fileRef === undefined) continue;
      let image = cache.get(fileRef);
      if (!cache.has(fileRef)) {
        image = (await imageProvider.decode(fileRef)) ?? undefined;
        cache.set(fileRef, image);
      }
      const gpuTex = uploadMaterialImage(device, image,
        t.colorSpace === 'srgb_texture' ? 'rgba8unorm-srgb' : 'rgba8unorm', t.textureKind);
      textures.push(gpuTex);
      textureViews.set(t.name, gpuTex.createView(t.textureKind === 'udim' ? { dimension: '2d-array' } : {}));
    }
    for (const s of module.samplers) {
      samplers.set(s.name, device.createSampler(imageSamplerDescriptor(s.sampler ?? {})));
    }
    return { textureViews, samplers, textures };
  } catch (error) {
    for (const texture of textures) texture.destroy();
    throw error;
  }
}

/** A loaded dome environment: the decoded equirect map plus derived lighting. */
export interface LoadedEnvironment {
  /** Equirectangular radiance map (envmap) for background + path-traced IBL. */
  image: HdrImage;
  /** Diffuse SH9 radiance coefficients (from the irradiance map when supplied). */
  sh: IrradianceSH;
  /** Flat ambient radiance used by the analytic raster forward shader. */
  averageRadiance: Vec3;
  /** Dome tint (inputs:color), defaults to white. */
  tint: Vec3;
  /** Dome intensity * 2^exposure. */
  intensity: number;
}

/** Load a UsdLuxDomeLight's envmap (inputs:texture:file) and derive its irradiance.
 *  When inputs:texture:irradianceFile is given, the SH are projected from that
 *  pre-convolved map; otherwise they are computed from the envmap itself. */
export async function loadEnvironment(
  lights: readonly SceneLight[],
  entry: string,
  sink: DiagnosticSink,
  fetchResource: typeof fetch = fetch,
): Promise<LoadedEnvironment | undefined> {
  const dome = lights.find((l) => l.type === 'dome' && l.textureFile);
  if (!dome?.textureFile) return undefined;
  const sourceLayer = new URL(dome.textureSourceLayer ?? entry, document.baseURI).href;
  const fetchHdr = async (ref: string): Promise<HdrImage | undefined> => {
    const url = new URL(ref, sourceLayer).href;
    const cacheHit = decodedEnvironmentCache.has(url);
    const started = performance.now();
    try {
      const image = await decodedEnvironmentCache.get(url, async (signal) => {
        const res = await fetchResource(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        let decoded: HdrImage;
        if (/\.exr(?:[?#]|$)/i.test(url)) {
          const { EXRLoader } = await import('three/addons/loaders/EXRLoader.js');
          const parsed = new EXRLoader().setDataType(FloatType).parse(bytes);
          if (parsed.width === undefined || parsed.height === undefined ||
            !(parsed.data instanceof Float32Array) || parsed.data.length !== parsed.width * parsed.height * 4) {
            throw new Error(`Invalid RGBA float EXR environment: ${url}`);
          }
          const data = new Float32Array(parsed.width * parsed.height * 3);
          // EXRLoader returns bottom-up rows; HdrImage uses top-down rows.
          for (let y = 0; y < parsed.height; y++) {
            for (let x = 0; x < parsed.width; x++) {
              const src = ((parsed.height - 1 - y) * parsed.width + x) * 4;
              data.set(parsed.data.subarray(src, src + 3), (y * parsed.width + x) * 3);
            }
          }
          decoded = { width: parsed.width, height: parsed.height, data };
        } else {
          decoded = decodeHdr(new Uint8Array(bytes));
        }
        return { value: decoded, size: decoded.data.byteLength };
      });
      performance.measure('assets:environment-cache', {
        start: started,
        end: performance.now(),
        detail: { hit: cacheHit, url, bytes: image.data.byteLength },
      });
      return image;
    } catch (e) {
      sink({ level: 'warning', message: `Failed to load envmap ${url}`, detail: String((e as Error)?.message ?? e) });
      return undefined;
    }
  };
  const [image, irradianceImage] = await Promise.all([
    fetchHdr(dome.textureFile),
    dome.irradianceFile ? fetchHdr(dome.irradianceFile) : undefined,
  ]);
  if (!image) return undefined;
  const sh = projectIrradianceSH(irradianceImage ?? image);
  return {
    image,
    sh,
    averageRadiance: averageRadiance(irradianceImage ?? image),
    tint: [...dome.color],
    intensity: dome.intensity * Math.pow(2, dome.exposure),
  };
}

export interface LoadedUsdScene {
  /** Prepared buffers and generated WGSL; absent after an explicit material edit. */
  compiled?: CompiledSceneRuntime;
  /** Compiled entries have no source-document dependency for material replacement. */
  precompiled?: boolean;
  /** Original positions plus editable material state, before displacement baking. */
  parameterResources?: SceneResources;
  entry: string;
  scene: SceneAsset;
  resources: SceneResources;
  lights: readonly SceneLight[];
  cameras: readonly SceneCamera[];
  mtlx: MtlxSceneContext;
  /** Dome environment when the stage declares a textured UsdLuxDomeLight. */
  environment?: LoadedEnvironment;
  /** Composed stage with its time samples, when animated; `scene` is resolved at `time`. */
  animation?: { source: SceneAsset; time: number };
  /** A partial scene shown while a streaming load continues. */
  preview?: boolean;
}

export interface PreviewSurfaceLowering {
  authored: readonly MaterialXReference[];
  lowered: ReturnType<typeof lowerPreviewSurfaceMaterials>;
}

/**
 * Lowers UsdPreviewSurface materials to MaterialX and adds them to the scene, so material
 * bindings resolve before (and independently of) the MaterialX runtime.
 */
export function lowerScenePreviewSurfaces(scene: SceneAsset, sink: DiagnosticSink): PreviewSurfaceLowering {
  const authored = [...scene.materials];
  const lowered = lowerPreviewSurfaceMaterials(scene, sink);
  for (const material of lowered) (scene.materials as MaterialXReference[]).push(material.reference);
  return { authored, lowered };
}

/** Fetch + import a USD stage and compile its materials into GPU-neutral resources. */
export interface ObjectMaterialOverride {
  assetPath: string;
  materialName: string;
}

export function applyObjectMaterialOverrides(
  scene: SceneAsset,
  overrides: ReadonlyMap<string, ObjectMaterialOverride>,
): SceneAsset {
  const prims = new Map(scene.prims);
  const materials = [...scene.materials];
  for (const [path, material] of overrides) {
    const prim = prims.get(path);
    if (!prim || !isMeshPrim(prim)) throw new Error(`Unknown mesh: ${path}`);
    const materialPath = `${path}/__MaterialOverride`;
    prims.set(path, { ...prim, materialBinding: { target: materialPath } });
    materials.push({ primPath: materialPath, ...material, referencedPrimPath: `/${material.materialName}` });
  }
  return { ...scene, prims, materials };
}

export interface SceneLoadOptions {
  editableParameters?: boolean;
  runtimeAssets?: RuntimeAssetUrls;
  /** `uniform`: material literals live in a parameter buffer so value-only variants share one pipeline. */
  parameterMode?: 'literal' | 'uniform';
  /** Explicit root for scene-authored MaterialX texture paths, not runtime overrides. */
  textureRoot?: string;
  /** Variant selections by authored prim path, stronger than the stage's own selections. */
  variantSelections?: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** Time code at which an animated stage is loaded (default: its start time code). */
  time?: number;
  loadCrateModule?: () => Promise<OpenUsdModule>;
  /** Streaming: partial scenes (geometry so far, materials once compiled) while the scene loads. */
  progress?: {
    wanted(readyGeometries: number): boolean;
    partial(scene: LoadedUsdScene, pendingGeometries: number): void;
    pause?(): Promise<void> | undefined;
    /** The MaterialX runtime starts loading when this resolves (its synchronous work would delay the first preview). */
    materialsGate?(): Promise<void>;
    geometryCached?(): void;
  };
  /** In-memory scene import, sharing the USD material compiler and GPU resource path. */
  imported?: {
    scene: SceneAsset;
    meshSource: MeshSource;
    materialTexts: ReadonlyMap<string, string>;
  };
}

/**
 * In-memory scene import of a single USDA layer (e.g. the scene of a script's primitives) and of
 * the MaterialX documents it references, keyed by their authored asset path.
 */
export async function importUsdaLayer(
  entry: string, usda: string, materialTexts: ReadonlyMap<string, string>, sink?: DiagnosticSink,
): Promise<NonNullable<SceneLoadOptions['imported']>> {
  const scene = await importUsdStage(entry, {
    reader: { read: async uri => {
      if (uri !== entry) throw new Error(`Layer not available in memory: ${uri}`);
      return usda;
    } },
    ...(sink ? { sink } : {}),
  });
  return { scene, meshSource: meshSourceFromScene(scene), materialTexts };
}

export async function loadUsdScene(
  entry: string,
  sink: DiagnosticSink,
  line: (m: string) => void = () => {},
  overrides: ReadonlyMap<string, ObjectMaterialOverride> = new Map(),
  options: SceneLoadOptions = {},
  displacementDevice?: GPUDevice,
): Promise<LoadedUsdScene> {
  const started = performance.now();
  let failedComposition = false;
  let compositionCause: unknown;
  const sceneSink: DiagnosticSink = diagnostic => {
    if (diagnostic.level === 'error') failedComposition = true;
    if (diagnostic.message.startsWith('Arc layer unavailable (')) {
      failedComposition = true;
      compositionCause ??= diagnostic.detail;
    }
    sink(diagnostic);
  };
  const composed = options.imported?.scene ?? await composeStage(entry, {
    resolver: new AssetResolver({ rootUrl: dirOf(entry), onDiagnostic: sceneSink }),
    source: { fetchBytes: async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    } },
    loadCrateModule: options.loadCrateModule ?? (() => loadBrowserOpenUsd(options.runtimeAssets?.openUsd)),
    sink: sceneSink,
    ...(options.variantSelections ? { variantSelections: options.variantSelections } : {}),
  });
  if (failedComposition) {
    if (compositionCause instanceof Error) throw compositionCause;
    throw new Error('USD composition failed. See scene diagnostics.');
  }
  const source = applyObjectMaterialOverrides(composed, overrides);
  const timeline = sceneTimeline(source);
  const time = options.time ?? timeline.start;
  const evaluated = timeline.animated ? evaluateSceneAt(source, time) : source;
  const volumes = await loadSceneVolumes(evaluated, sink);
  const defaults = applyDefaultVolumeMaterials(evaluated, volumes);
  const gprimDefaults = applyDefaultGprimMaterials(defaults.scene);
  const scene = gprimDefaults.scene;
  const defaultTexts = new Map([...defaults.texts, ...gprimDefaults.texts]);
  const composedAt = performance.now();
  performance.measure('usd:composition', { start: started, end: composedAt, detail: { entry, prims: scene.prims.size } });
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });
  const materialTexts = defaultTexts.size
    ? new Map([...options.imported?.materialTexts ?? [], ...defaultTexts]) : options.imported?.materialTexts;
  // MaterialX, the environment and geometry load concurrently; geometry does not wait for the runtime.
  const lowering = lowerScenePreviewSurfaces(scene, sink);
  const gate = options.progress?.materialsGate?.();
  const loadMtlx = () => loadMtlxSceneContext(scene, entry, sink, line, options.textureRoot, materialTexts, options.runtimeAssets, lowering);
  const mtlxLoad = gate ? gate.then(loadMtlx) : loadMtlx();
  let mtlxReady: Awaited<typeof mtlxLoad> | undefined;
  const materialsLoaded = mtlxLoad.then(mtlx => {
    mtlxReady = mtlx;
    performance.measure('usd:materials', { start: composedAt, end: performance.now(), detail: { entry, documents: scene.materials.length } });
    return mtlx;
  });
  materialsLoaded.catch(() => undefined);
  let environmentReady: LoadedEnvironment | undefined;
  const environmentLoad = loadEnvironment(lights, entry, sink).then(environment => (environmentReady = environment));
  environmentLoad.catch(() => undefined);
  const progress = options.progress;
  // Partial scenes use the final material form, so their pipelines are reused by the complete scene.
  const partialScene = (built: SceneResources): LoadedUsdScene => ({
    entry, scene, lights,
    resources: built.materials.size === 0 ? built : options.editableParameters ? editableSceneMaterials(built)
      : options.parameterMode === 'uniform' ? uniformSceneMaterials(built) : built, cameras, mtlx: mtlxReady ?? previewMtlxContext(), preview: true,
    ...(environmentReady ? { environment: environmentReady } : {}),
  });
  try {
    const built = await buildSceneResources(scene, {
      meshSource: options.imported?.meshSource ?? await loadExternalMeshSource(scene, meshSourceFromScene(scene, volumes), sink, undefined,
        // With a persistent prepared-geometry cache, parse files only on cache misses.
        { lazy: globalThis.indexedDB !== undefined }),
      materialCompiler: materialsLoaded.then(mtlx => createGraphMaterialCompiler({ documents: mtlx.documents, sink })),
      sink,
      ...(progress ? { progress: {
        wanted: (ready: number) => progress.wanted(ready),
        partial: (resources: SceneResources, pending: number) => progress.partial(partialScene(resources), pending),
        pause: () => progress.pause?.(),
        geometryCached: () => progress.geometryCached?.(),
      } } : {}),
    });
    const mtlx = await materialsLoaded;
    const materialsAt = performance.now();
    requireCompiledMaterials(built);
    if (volumes.size) Object.assign(built, { volumes });
    const parameterResources = options.editableParameters ? editableSceneMaterials(built) : undefined;
    const baseResources = parameterResources ?? (options.parameterMode === 'uniform' ? uniformSceneMaterials(built) : built);
    const resources = await applySceneDisplacement(baseResources, mtlx.imageProvider, displacementDevice);
    const environment = await environmentLoad;
    performance.measure('usd:resources', { start: materialsAt, end: performance.now(), detail: {
      entry, geometries: resources.geometries.size, materials: resources.materials.size,
      pendingMaterials: resources.pendingMaterials.length,
      triangles: [...resources.geometries.values()].reduce((sum, mesh) => sum + mesh.indices.length / 3, 0),
      lights: lights.length, cameras: cameras.length, environment: environment !== undefined,
    } });
    return {
      entry, scene, resources, lights, cameras, mtlx, ...(parameterResources ? { parameterResources } : {}), ...(environment ? { environment } : {}),
      ...(timeline.animated ? { animation: { source, time } } : {}),
    };
  } catch (error) {
    void materialsLoaded.then(mtlx => mtlx.documents.delete(), () => undefined);
    throw error;
  }
}

/** Material context of a partial scene loaded before the MaterialX runtime: neutral surfaces, no images. */
function previewMtlxContext(): LoadedUsdScene['mtlx'] {
  return {
    documents: { delete() {} } as unknown as NonNullable<LoadedUsdScene['mtlx']['documents']>,
    nodeDefinitions: [],
    imageProvider: { decode: () => undefined },
    surfaceFor: () => NEUTRAL_SURFACE,
  };
}

export type { Diagnostic };
