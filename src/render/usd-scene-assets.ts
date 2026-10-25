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
  type MaterialResource,
  type MeshSource,
  type SceneResources,
} from './scene-resources.ts';
import { createGraphMaterialCompiler } from './graph-material-compiler.ts';
import { loadMaterialXDocuments } from '../materialx/document-source.ts';
import { loadMaterialXCore } from '../materialx/wasm.ts';
import { MaterialXLibraries, defaultLibrarySources } from '../materialx/libraries.ts';
import type { DecodedPixelImage } from '../assets/images.ts';
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
import { importUsdStage, type UsdLayerReader } from '../usd/importer.ts';
import { lowerPreviewSurfaceMaterials } from '../usd/preview-surface.ts';
import type { RawMesh, Primvar, PrimvarInterpolation } from '../geometry/prepare.ts';
import type { MaterialXReference, SceneAsset, ScenePrim } from '../scene/types.ts';
import type { Diagnostic, DiagnosticSink } from '../core/diagnostics.ts';
import { loadExternalMeshSource } from '../geometry/external-mesh.ts';

/** App-relative paths also work when dist/ is served below the workspace root. */
const MATERIALX_ROOT = `${import.meta.env.BASE_URL}materialx/`;
const MATERIALX_CORE_URL = `${MATERIALX_ROOT}JsMaterialXCore.js`;
const MATERIALX_WASM_DIR = MATERIALX_ROOT;
const MATERIALX_LIBRARIES_ROOT = `${MATERIALX_ROOT}libraries`;
const appAssetUrl = (path: string): string => new URL(path, document.baseURI).href;

/** Directory portion of a URL-ish path, keeping the trailing slash. */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

/** Resolves a relative layer uri against a base directory (no .. handling needed). */
export function joinUrl(baseDir: string, rel: string): string {
  if (rel.startsWith('/') || /^https?:/.test(rel)) return rel;
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
export function meshSourceFromScene(scene: SceneAsset): MeshSource {
  return {
    meshFor(primPath: string): RawMesh | undefined {
      const prim = scene.prims.get(primPath);
      if (!prim) return undefined;
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
          ? { name: 'normals', interpolation: normalInterp ?? 'faceVarying', values: normalValues, elementSize: 3 }
          : undefined;
      const stValues = numArray(prim, 'primvars:st');
      const stInterp = prim.attributes.get('primvars:st')?.interpolation as PrimvarInterpolation | undefined;
      const st: Primvar | undefined =
        stValues.length > 0
          ? { name: 'st', interpolation: stInterp ?? 'faceVarying', values: stValues, elementSize: 2 }
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
  documents: Awaited<ReturnType<typeof loadMaterialXDocuments>>;
  imageProvider: PtImageProvider;
  surfaceFor: (material: MaterialResource) => RasterSurface;
}

function resolveMaterialImageUrls(text: string, directory: string): string {
  const document = new DOMParser().parseFromString(text, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('Invalid MaterialX XML.');
  for (const input of document.querySelectorAll('[type="filename"][value]')) {
    const file = input.getAttribute('value');
    if (file) input.setAttribute('value', new URL(file, new URL(directory, window.location.href)).href);
  }
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
): Promise<MtlxSceneContext> {
  const baseDir = dirOf(entry);
  const surfaces = new Map<string, RasterSurface>();
  const texts = new Map<string, string>();
  const materialDirs: string[] = [];
  for (const ref of scene.materials) {
    const url = joinUrl(baseDir, ref.assetPath);
    const dir = dirOf(url);
    if (!materialDirs.includes(dir)) materialDirs.push(dir);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const text = resolveMaterialImageUrls(await response.text(), dir);
      texts.set(ref.assetPath, text);
      surfaces.set(ref.materialName, surfaceFromMtlx(text));
    } catch {
      line(`MaterialX introuvable: ${ref.assetPath}`);
    }
  }
  const lowered = lowerPreviewSurfaceMaterials(scene, sink);
  if (lowered.length > 0 && !materialDirs.includes(baseDir)) materialDirs.push(baseDir);
  for (const material of lowered) {
    texts.set(material.reference.assetPath, resolveMaterialImageUrls(material.xml, baseDir));
    (scene.materials as MaterialXReference[]).push(material.reference);
    surfaces.set(material.reference.materialName, surfaceFromMtlx(material.xml));
  }
  const core = await loadMaterialXCore({
    moduleUrl: appAssetUrl(MATERIALX_CORE_URL),
    locateFile: (path) => appAssetUrl(MATERIALX_WASM_DIR + path),
    onDiagnostic: sink,
  });
  const libraries = new MaterialXLibraries(core);
  await libraries.load({
    sources: defaultLibrarySources(MATERIALX_LIBRARIES_ROOT),
    fetchText: async (url) => (await fetch(url)).text(),
    onDiagnostic: sink,
  });
  const documents = await loadMaterialXDocuments({ core, libraries, texts, sink });
  const imageProvider: PtImageProvider = {
    async decode(fileRef: string): Promise<DecodedPixelImage | undefined> {
      for (const dir of materialDirs) {
        const url = joinUrl(dir, fileRef);
        const resp = await fetch(url);
        if (resp.status === 404) continue;
        if (!resp.ok) throw new Error(`HTTP ${resp.status} for texture ${url}`);
        try {
          return await decodeBrowserImage(await resp.blob(), url);
        } catch (error) {
          sink({ level: 'error', message: `Texture decode failed: ${url}`, detail: { error: String(error) } });
          throw error;
        }
      }
      line(`Texture introuvable: ${fileRef}`);
      return undefined;
    },
  };
  const surfaceFor = (material: MaterialResource): RasterSurface => surfaces.get(material.materialName) ?? NEUTRAL_SURFACE;
  return { documents, imageProvider, surfaceFor };
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
  for (const t of module.textures) {
    const fileRef = t.fileRef;
    if (fileRef === undefined) continue;
    let image = cache.get(fileRef);
    if (!cache.has(fileRef)) {
      image = (await imageProvider.decode(fileRef)) ?? undefined;
      cache.set(fileRef, image);
    }
    const width = image?.width ?? 1;
    const height = image?.height ?? 1;
    const gpuTex = device.createTexture({
      size: [width, height],
      format: t.colorSpace === 'srgb_texture' ? 'rgba8unorm-srgb' : 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    textures.push(gpuTex);
    if (image && image.componentType === 'uint8' && image.channels === 4) {
      device.queue.writeTexture({ texture: gpuTex }, image.data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]);
    }
    textureViews.set(t.name, gpuTex.createView());
  }
  for (const s of module.samplers) {
    samplers.set(s.name, device.createSampler(imageSamplerDescriptor(s.sampler ?? {})));
  }
  return { textureViews, samplers, textures };
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
): Promise<LoadedEnvironment | undefined> {
  const dome = lights.find((l) => l.type === 'dome' && l.textureFile);
  if (!dome?.textureFile) return undefined;
  const baseDir = dirOf(entry);
  const fetchHdr = async (ref: string): Promise<HdrImage | undefined> => {
    const url = joinUrl(baseDir, ref);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeHdr(new Uint8Array(await res.arrayBuffer()));
    } catch (e) {
      sink({ level: 'warning', message: `Failed to load envmap ${url}`, detail: String((e as Error)?.message ?? e) });
      return undefined;
    }
  };
  const image = await fetchHdr(dome.textureFile);
  if (!image) return undefined;
  const irradianceImage = dome.irradianceFile ? await fetchHdr(dome.irradianceFile) : undefined;
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
  entry: string;
  scene: SceneAsset;
  resources: SceneResources;
  lights: readonly SceneLight[];
  cameras: readonly SceneCamera[];
  mtlx: MtlxSceneContext;
  /** Dome environment when the stage declares a textured UsdLuxDomeLight. */
  environment?: LoadedEnvironment;
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
    if (!prim || (prim.typeName !== 'Mesh' && !prim.mesh)) throw new Error(`Unknown mesh: ${path}`);
    const materialPath = `${path}/__MaterialOverride`;
    prims.set(path, { ...prim, materialBinding: { target: materialPath } });
    materials.push({ primPath: materialPath, ...material, referencedPrimPath: `/${material.materialName}` });
  }
  return { ...scene, prims, materials };
}

export async function loadUsdScene(
  entry: string,
  sink: DiagnosticSink,
  line: (m: string) => void = () => {},
  overrides: ReadonlyMap<string, ObjectMaterialOverride> = new Map(),
): Promise<LoadedUsdScene> {
  const reader = httpReader(entry);
  const scene = applyObjectMaterialOverrides(await importUsdStage(entry, { reader, sink }), overrides);
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });
  const mtlx = await loadMtlxSceneContext(scene, entry, sink, line);
  const resources = await buildSceneResources(scene, {
    meshSource: await loadExternalMeshSource(scene, meshSourceFromScene(scene), sink),
    materialCompiler: createGraphMaterialCompiler({ documents: mtlx.documents, sink }),
    sink,
  });
  const environment = await loadEnvironment(lights, entry, sink);
  return { entry, scene, resources, lights, cameras, mtlx, ...(environment ? { environment } : {}) };
}

export type { Diagnostic };
