// Mobile USD render harness (plan section 9, T053). Unlike scene-device.harness
// (which shades a shader-ball fixture with canned control-scene materials), this
// harness renders the REAL geometry of a text USDA stage on the device GPU: it
// fetches the .usda + referenced .mtlx layers over HTTP, imports the composed
// stage (src/usd/importer.ts), builds device-neutral SceneResources, then drives
// the WebGPU compute path tracer (src/render/pathtracing/compute.ts) fed by the
// packed scene buffers (scene-buffers.ts) with progressive accumulation. The path
// tracer -- not the raster forward pass -- is used here on purpose: a pure metal
// (the gold cube/sphere) only looks metallic when it reflects the ground and the
// environment through traced rays, whereas the raster forward model reflects a
// single constant environment radiance and therefore renders metal flat. The
// preview camera and neutral fill mirror scripts/validate-disney-gold.ts so the
// subject is legible. The accumulated mean is read back, tonemapped through the
// shared output pipeline, and exposed as a PNG data URL on globalThis.__MX_IMAGE__.

import {
  NEUTRAL_SURFACE,
  buildSceneFrame,
  buildSceneFrameUniform,
  buildSceneMaterialUniform,
  type FrameCamera,
  type RasterSurface,
} from '../../src/render/raster/scene-frame.ts';
import {
  RasterBackend,
  RESOLVE_UNIFORM_SIZE,
  SCENE_FRAME_UNIFORM_SIZE,
  SCENE_MATERIAL_UNIFORM_SIZE,
  type ScenePassKind,
  type SceneDrawCall,
} from '../../src/render/raster/backend.ts';
import {
  buildSceneResources,
  createSceneBindGroups,
  uploadGeometry,
  type MaterialResource,
} from '../../src/render/scene-resources.ts';
import { buildPathTraceScene } from '../../src/render/pathtracing/scene-buffers.ts';
import {
  emitHybridShadowPass,
  emitGBufferPass,
  emitShadowCompositePass,
  packShadowUniform,
  HYBRID_SHADOW_BINDINGS,
  HYBRID_SHADOW_UNIFORM_SIZE,
  HYBRID_WORKGROUP_SIZE,
  GBUFFER_POSITION_FORMAT,
  GBUFFER_NORMAL_FORMAT,
} from '../../src/render/hybrid/trace-pass.ts';
import { buildPathTraceUniform, PathTraceBackend, PT_UNIFORM_SIZE } from '../../src/render/pathtracing/compute.ts';
import { packHdrTexture } from '../../src/assets/hdr-texture.ts';
import { buildMaterialDispatch } from '../../src/render/pathtracing/material-variant.ts';
import { buildPtDeviceBindings, type PtImageProvider } from '../../src/render/pathtracing/device-bindings.ts';
import { createGraphMaterialCompiler } from '../../src/render/graph-material-compiler.ts';
import { loadMaterialXDocuments } from '../../src/materialx/document-source.ts';
import { loadMaterialXCore } from '../../src/materialx/wasm.ts';
import { MaterialXLibraries, defaultLibrarySources } from '../../src/materialx/libraries.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';
import { decodeBrowserImage } from '../../src/assets/browser-image.ts';
import { imageSamplerDescriptor } from '../../src/assets/samplers.ts';
import {
  parseSurfaceInputsFromMtlx,
  parsedSurfaceToCanonical,
} from '../../src/materialx/surface-from-inputs.ts';
import { resolvePixel } from '../../src/render/output.ts';
import { importCameras, type SceneCamera } from '../../src/usd/cameras.ts';
import { importLights } from '../../src/usd/lights.ts';
import { loadEnvironment, meshSourceFromScene, type LoadedEnvironment } from '../../src/render/usd-scene-assets.ts';
import { loadExternalMeshSource } from '../../src/geometry/external-mesh.ts';
import { importUsdStage, type UsdLayerReader } from '../../src/usd/importer.ts';
import { lowerPreviewSurfaceMaterials } from '../../src/usd/preview-surface.ts';
import { inverse4, lookAt4, multiply4, perspective4, type Mat4, type Vec3 } from '../../src/scene/transforms.ts';
import type { MaterialXReference, SceneAsset } from '../../src/scene/types.ts';

export interface UsdSceneImage {
  entry: string;
  width: number;
  height: number;
  samples: number;
  dataUrl: string;
  /** Which backend produced the image. */
  backend: 'raster' | 'pathtracing';
  /** GPU render wall-clock in milliseconds (submit -> onSubmittedWorkDone). */
  renderMs: number;
  /** OpenPBRMaterial override bound for this render, if any. */
  materialOverride?: string;
  /** Mean 8-bit luminance and fraction of pixels brighter than 2/255. */
  stats: { meanLuma: number; litFraction: number };
}

/** Directory portion of a URL-ish path, keeping the trailing slash. */
function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(0, i + 1) : '';
}

/** Resolves a relative layer uri against a base directory (no .. handling needed). */
function joinUrl(baseDir: string, rel: string): string {
  if (rel.startsWith('/') || /^https?:/.test(rel)) return rel;
  return baseDir + rel.replace(/^\.\//, '');
}

/** Reads USD layers over HTTP, resolving relative sublayers against the entry dir. */
function httpReader(entry: string): UsdLayerReader {
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

/** Resolve a .mtlx surface to the canonical raster surface via the shared bridge.
 *  T055e5: the regex parseOpenPbr is gone -- the raw text is parsed into a
 *  ParsedSurfaceInputs (parseSurfaceInputsFromMtlx) then reduced to the shared
 *  seven-parameter anchor (parsedSurfaceToCanonical), the same path the fixture
 *  builder uses, until the path tracer is wired on the LayeredClosure (T057). */
function surfaceFromMtlx(text: string): RasterSurface {
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

/** Preview camera + fill that frame the cube/sphere cluster legibly (validate-disney-gold). */
function previewCamera(exposure: number): FrameCamera {
  const target: Vec3 = [0, 0.3, 0];
  const dir: Vec3 = [0.657, 0.438, 0.613];
  const dist = 7;
  const eye: Vec3 = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
  return { viewProj: multiply4(perspective4(0.62, 1, 0.1, 100), lookAt4(eye, target, [0, 1, 0])), eye, exposure };
}

/** Builds a render FrameCamera from a UsdGeomCamera, reprojected for the (square)
 *  render target: the authored view transform and vertical FOV are honoured while
 *  the aspect ratio is taken from the output so the subject is not stretched.
 *  `dolly` > 1 pulls the camera straight back along its view axis (keeps the same
 *  orientation and FOV) so the whole subject fits; the pull distance scales with the
 *  eye's distance to the world origin (≈ scene centre). */
function frameCameraFromUsd(camera: SceneCamera, aspect: number, dolly = 1): FrameCamera {
  const [near, far] = camera.clippingRange;
  const t = camera.transform;
  const eye0: Vec3 = [t[12] ?? 0, t[13] ?? 0, t[14] ?? 0];
  if (camera.projection === 'perspective' && dolly !== 1) {
    // Camera-to-world basis columns: col1 = up, col2 = backward (USD looks down -Z).
    const up: Vec3 = [t[4] ?? 0, t[5] ?? 0, t[6] ?? 0];
    const bw: Vec3 = [t[8] ?? 0, t[9] ?? 0, t[10] ?? 0];
    const bl = Math.hypot(bw[0], bw[1], bw[2]) || 1;
    const bn: Vec3 = [bw[0] / bl, bw[1] / bl, bw[2] / bl];
    const focus = Math.hypot(eye0[0], eye0[1], eye0[2]) || 1;
    const back = focus * (dolly - 1);
    const eye: Vec3 = [eye0[0] + bn[0] * back, eye0[1] + bn[1] * back, eye0[2] + bn[2] * back];
    const target: Vec3 = [eye[0] - bn[0], eye[1] - bn[1], eye[2] - bn[2]];
    const view = lookAt4(eye, target, up);
    const projection = perspective4(camera.fovY, aspect, near, far);
    return { viewProj: multiply4(projection, view), eye, exposure: camera.exposure ?? 0 };
  }
  const projection =
    camera.projection === 'orthographic' ? camera.projectionMatrix : perspective4(camera.fovY, aspect, near, far);
  return { viewProj: multiply4(projection, camera.view), eye: eye0, exposure: camera.exposure ?? 0 };
}

/** The scene's camera reprojected for a square target, or the legacy preview.
 *  `exposureOverride` (EV) replaces the authored exposure when supplied (CLI);
 *  `dolly` (> 1) pulls the camera back along its view axis to frame the whole subject. */
function resolveFrameCamera(
  cameras: readonly SceneCamera[],
  line: (m: string) => void,
  exposureOverride?: number,
  dolly?: number,
): FrameCamera {
  const camera = cameras[0];
  const back = dolly !== undefined && Number.isFinite(dolly) ? dolly : 1;
  if (back !== 1) line(`diag cam back=${back}`);
  const base = camera ? (line(`diag camera=${camera.path} fovY=${camera.fovY.toFixed(3)} (USD)`), frameCameraFromUsd(camera, 1, back)) : previewCamera(0);
  if (exposureOverride !== undefined && Number.isFinite(exposureOverride)) {
    line(`diag exposure override=${exposureOverride}`);
    return { ...base, exposure: exposureOverride };
  }
  return base;
}

/** USD material prim rebinding takes at runtime when a .mtlx override is given. */
const OPENPBR_MATERIAL_PATH = '/World/Looks/OpenPBRMaterial';

/** First <surfacematerial name="..."> declared in a .mtlx document. */
function firstSurfaceMaterialName(mtlx: string): string | undefined {
  return /<surfacematerial\b[^>]*\bname\s*=\s*"([^"]+)"/.exec(mtlx)?.[1];
}

/** Rebind a USD material prim to a runtime .mtlx: synthesize a MaterialX reference
 *  so resolveSceneMaterials/buildSceneResources compile the loaded document for the
 *  bound gprim instead of its inline UsdPreviewSurface. The .mtlx and any sibling
 *  textures resolve against the asset URL's directory (loadMtlxSceneContext). */
async function overrideMaterialWithMtlx(
  scene: SceneAsset,
  materialPath: string,
  assetUrl: string,
  line: (m: string) => void,
): Promise<void> {
  if (!scene.prims.has(materialPath)) {
    line(`override ignore: prim ${materialPath} absent de la scene`);
    return;
  }
  let text: string;
  try {
    const res = await fetch(assetUrl);
    if (!res.ok) {
      line(`override mtlx HTTP ${res.status}: ${assetUrl}`);
      return;
    }
    text = await res.text();
  } catch {
    line(`override mtlx introuvable: ${assetUrl}`);
    return;
  }
  const name = firstSurfaceMaterialName(text);
  if (!name) {
    line(`override mtlx sans <surfacematerial>: ${assetUrl}`);
    return;
  }
  // Replace any existing reference for this prim (inline shader or prior arc).
  const list = scene.materials as MaterialXReference[];
  for (let i = list.length - 1; i >= 0; i--) if (list[i]!.primPath === materialPath) list.splice(i, 1);
  list.push({ primPath: materialPath, assetPath: assetUrl, referencedPrimPath: `/${name}`, materialName: name });
  line(`override ${materialPath} <- ${assetUrl} (surfacematerial "${name}")`);
}

const PREVIEW_ENV: Vec3 = [0.65, 0.68, 0.72];

/** Build a flat row-major luminance CDF over the equirect HDR, used by the path
 *  tracer's environment importance sampling. Rec.709 luminance, cumulative sum. */
import { buildEnvCdf } from '../../src/assets/environment-cdf.ts';

/** Upload the dome envmap as a filterable rgba16float texture shared by the raster
 *  background pass and the path tracer's group 3, plus the luminance CDF storage
 *  buffer the tracer importance-samples. */
function uploadEnvTexture(
  device: GPUDevice,
  env: LoadedEnvironment,
): { view: GPUTextureView; sampler: GPUSampler; radianceScale: number; cdfBuffer: GPUBuffer; cdfStats: { width: number; height: number; totalSum: number } } {
  const { width: ew, height: eh } = env.image;
  const packed = packHdrTexture(env.image);
  const texture = device.createTexture({
    size: [ew, eh],
    format: 'rgba16float',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  device.queue.writeTexture({ texture }, packed.data, { bytesPerRow: ew * 8, rowsPerImage: eh }, [ew, eh, 1]);
  const { cdf, totalSum, width, height } = buildEnvCdf(env.image);
  const cdfBuffer = device.createBuffer({
    size: Math.max(16, cdf.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(cdfBuffer, 0, cdf);
  return {
    view: texture.createView(),
    radianceScale: packed.radianceScale,
    sampler: device.createSampler({ addressModeU: 'repeat', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear' }),
    cdfBuffer,
    cdfStats: { width, height, totalSum },
  };
}

/** FrameEnvironment config for a loaded dome (textured IBL) or the flat preview fill.
 *  skyPower/skyColor override the dome intensity/tint (DomeLight-derived defaults). */
function envFrameConfig(
  env: LoadedEnvironment | undefined,
  cdfStats?: { width: number; height: number; totalSum: number },
  skyPower?: number,
  skyColor?: Vec3,
): {
  radiance: Vec3;
  tint?: Vec3;
  intensity?: number;
  hasTexture?: boolean;
  envResX?: number;
  envResY?: number;
  envTotalSum?: number;
  sh?: Float32Array;
} {
  if (!env) return { radiance: PREVIEW_ENV };
  return {
    radiance: env.averageRadiance,
    tint: skyColor ?? env.tint,
    intensity: skyPower ?? env.intensity,
    hasTexture: true,
    sh: env.sh,
    ...(cdfStats ? { envResX: cdfStats.width, envResY: cdfStats.height, envTotalSum: cdfStats.totalSum } : {}),
  };
}

/** Fullscreen equirect dome background: samples the envmap along each pixel's world
 *  ray (mirrors InteractiveViewer) so the HDR shows behind geometry in the raster pass. */
function createEnvBackground(
  device: GPUDevice,
  hdrFormat: GPUTextureFormat,
  depthFormat: GPUTextureFormat,
  env: LoadedEnvironment,
  envView: GPUTextureView,
  envSampler: GPUSampler,
  invViewProj: Mat4,
  eye: Vec3,
  radianceScale: number,
): { pipeline: GPURenderPipeline; bindGroup: GPUBindGroup } {
  const module = device.createShaderModule({
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
  let far = E.invViewProj * vec4<f32>(in.ndc, 1.0, 1.0);
  let world = far.xyz / far.w;
  let dir = world - E.eye.xyz;
  let c = textureSample(envTex, envSamp, dir_to_uv(dir)).xyz;
  return vec4<f32>(c * E.tint.xyz, 1.0);
}
`,
  });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: 'fs', targets: [{ format: hdrFormat }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'always' },
  });
  const uniform = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(uniform, 0, new Float32Array(invViewProj));
  device.queue.writeBuffer(uniform, 64, new Float32Array([eye[0], eye[1], eye[2], 0]));
  const inten = env.intensity * radianceScale;
  const t = env.tint;
  device.queue.writeBuffer(uniform, 80, new Float32Array([t[0] * inten, t[1] * inten, t[2] * inten, 1]));
  const bindGroup = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniform } },
      { binding: 1, resource: envView },
      { binding: 2, resource: envSampler },
    ],
  });
  return { pipeline, bindGroup };
}

// Served dev-server paths for the MaterialX Core WASM and standard libraries the
// graph material compiler path consumes (T057m3b). The device matrix run (T057m4)
// provides the static serving; the module and libraries roots are overridable here.
const MATERIALX_CORE_URL = '/materialx/JsMaterialXCore.js';
const MATERIALX_WASM_DIR = '/materialx/';
const MATERIALX_LIBRARIES_ROOT = '/materialx/libraries';

interface MtlxSceneContext {
  documents: Awaited<ReturnType<typeof loadMaterialXDocuments>>;
  imageProvider: PtImageProvider;
  surfaceFor: (material: MaterialResource) => RasterSurface;
}

/** Load the MaterialX Core WASM + standard libraries, read every referenced .mtlx
 *  into a document source, and return the graph-compiler document set plus an image
 *  provider that decodes texture files off a 2D canvas. Shared by both backends so
 *  raster and the path tracer compile the SAME procedural/textured materials. */
async function loadMtlxSceneContext(
  scene: SceneAsset,
  entry: string,
  line: (m: string) => void,
  sink: (d: { level: string; message: string; detail?: unknown }) => void,
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
      const text = await (await fetch(url)).text();
      texts.set(ref.assetPath, text);
      surfaces.set(ref.materialName, surfaceFromMtlx(text));
    } catch {
      line(`MaterialX introuvable: ${ref.assetPath}`);
    }
  }
  // Lower inline UsdPreviewSurface shaders (incl. UsdUVTexture) into synthetic
  // MaterialX documents so the graph compiler textures/shades them in both passes
  // instead of falling back to the neutral surface. Textures resolve against the
  // usd stage directory, so make sure it is a candidate material directory.
  const lowered = lowerPreviewSurfaceMaterials(scene, sink);
  if (lowered.length > 0 && !materialDirs.includes(baseDir)) materialDirs.push(baseDir);
  for (const mat of lowered) {
    texts.set(mat.reference.assetPath, mat.xml);
    (scene.materials as MaterialXReference[]).push(mat.reference);
    try {
      surfaces.set(mat.reference.materialName, surfaceFromMtlx(mat.xml));
    } catch {
      // raster fallback surface is optional; the graph compiler drives shading
    }
    line(`UsdPreviewSurface lowered: ${mat.reference.primPath} (textures=${mat.textureFiles.length})`);
  }
  const core = await loadMaterialXCore({
    moduleUrl: MATERIALX_CORE_URL,
    locateFile: (path) => MATERIALX_WASM_DIR + path,
    onDiagnostic: sink,
  });
  line('diag step: core loaded');
  const libraries = new MaterialXLibraries(core);
  await libraries.load({
    sources: defaultLibrarySources(MATERIALX_LIBRARIES_ROOT),
    fetchText: async (url) => (await fetch(url)).text(),
    onDiagnostic: sink,
  });
  line('diag step: libraries loaded');
  const documents = await loadMaterialXDocuments({ core, libraries, texts, sink });
  line('diag step: documents loaded');
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
 *  views/samplers by the module binding name so createSceneBindGroups can wire
 *  them (T058 raster-sur-IR, textured path). Decoded images are cached by file
 *  reference across materials; the sampler matches the CPU oracle (repeat/linear). */
async function uploadMaterialTextures(
  device: GPUDevice,
  material: MaterialResource,
  imageProvider: PtImageProvider,
  cache: Map<string, DecodedPixelImage | undefined>,
): Promise<{ textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler> }> {
  const textureViews = new Map<string, GPUTextureView>();
  const samplers = new Map<string, GPUSampler>();
  const module = material.surfaceModule;
  if (!module) return { textureViews, samplers };
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
    if (image && image.componentType === 'uint8' && image.channels === 4) {
      device.queue.writeTexture({ texture: gpuTex }, image.data, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height, 1]);
    }
    textureViews.set(t.name, gpuTex.createView());
  }
  for (const s of module.samplers) {
    samplers.set(s.name, device.createSampler(imageSamplerDescriptor(s.sampler ?? {})));
  }
  return { textureViews, samplers };
}

/** Raster-renders the real USDA geometry offscreen on the device GPU (T058 path)
 *  and returns display RGBA plus the GPU wall-clock in milliseconds. */
async function renderUsdRasterOnDevice(
  device: GPUDevice,
  entry: string,
  res: number,
  line: (m: string) => void,
  materialOverride?: string,
  exposureOverride?: number,
  camBackOverride?: number,
  dispScaleOverride?: number,
  tracedShadows?: boolean,
  lightDirOverride?: Vec3,
): Promise<{ rgba: Uint8ClampedArray; renderMs: number }> {
  const sink = (d: { level: string; message: string }): void => {
    if (d.level === 'warning' || d.level === 'error') line(`diag: ${d.message}`);
  };

  const reader = httpReader(entry);
  const scene = await importUsdStage(entry, { reader, sink });
  if (materialOverride) await overrideMaterialWithMtlx(scene, OPENPBR_MATERIAL_PATH, materialOverride, line);
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });
  const envAsset = await loadEnvironment(lights, entry, sink);
  if (envAsset) line(`diag env ${envAsset.image.width}x${envAsset.image.height} intensity=${envAsset.intensity.toFixed(3)} (dome)`);

  // Compile every material through the real graph material compiler (same path as
  // the path tracer, T057m1): constant, procedural AND textured nodegraphs lower
  // to the shared LayeredClosure, so the raster forward pass shades an arbitrary
  // mtlx faithfully instead of the retired fixed 7-parameter standard_surface.
  const { documents, imageProvider, surfaceFor } = await loadMtlxSceneContext(scene, entry, line, sink);

  const resources = await buildSceneResources(scene, {
    meshSource: await loadExternalMeshSource(scene, meshSourceFromScene(scene), sink),
    materialCompiler: createGraphMaterialCompiler({ documents, sink }),
    sink,
  });
  line('diag step: scene resources built');

  const frameCamera = resolveFrameCamera(cameras, line, exposureOverride, camBackOverride);
  const exposure = frameCamera.exposure;
  const frame = buildSceneFrame(resources, {
    lights,
    frameCamera,
    environment: envFrameConfig(envAsset),
    surfaceFor,
  });
  // Override the dominant light direction (travel direction) so cast shadows are
  // demonstrable on dome-only scenes whose default light points up from below.
  if (lightDirOverride) frame.light.direction = lightDirOverride;
  line(`${frame.draws.length} draw(s), passes [${frame.passes.join(', ')}], ${frame.skipped.length} ignore(s)`);

  const outputFormat: GPUTextureFormat = 'rgba8unorm';
  const backend = new RasterBackend({ device, outputFormat, tonemap: 'acesFilmic' });
  for (const draw of frame.draws) {
    const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
    if (material?.sceneShader) {
      backend.createSceneVariantPipeline(draw.pass, material.variant.pipelineKey, material.sceneShader.code);
    }
  }
  const resolvePipeline = backend.createResolvePipeline();

  // Dome envmap: upload once, shown as the raster background and reused as IBL fill.
  const envGpu = envAsset ? uploadEnvTexture(device, envAsset) : undefined;
  frame.environment.textureRadianceScale = envGpu?.radianceScale ?? 1;
  if (envGpu) {
    frame.environment.envResX = envGpu.cdfStats.width;
    frame.environment.envResY = envGpu.cdfStats.height;
    frame.environment.envTotalSum = envGpu.cdfStats.totalSum;
  }
  const envBg =
    envAsset && envGpu
      ? createEnvBackground(device, backend.hdrFormat, backend.depthFormat, envAsset, envGpu.view, envGpu.sampler, inverse4(frameCamera.viewProj), frameCamera.eye, envGpu.radianceScale)
      : undefined;

  // Decode + upload each material's sampled textures once, keyed by material unit.
  const imageCache = new Map<string, DecodedPixelImage | undefined>();
  const materialTextures = new Map<string, { textureViews: Map<string, GPUTextureView>; samplers: Map<string, GPUSampler> }>();
  for (const [key, material] of resources.materials) {
    if (material.surfaceModule && material.surfaceModule.textures.length > 0) {
      materialTextures.set(key, await uploadMaterialTextures(device, material, imageProvider, imageCache));
    }
  }

  // Vertex-displacement (VTF) GPU resources per material: decode the height map and
  // build the MxDisp uniform (scale*multiplier, midpoint) the scene vertex shader
  // samples. Only materials whose compiled sceneShader declares a displacement
  // group get them; the shader offsets each vertex along its normal in-stage.
  const dispMidpoint = 0.5;
  const dispMul = dispScaleOverride ?? 1;
  const materialDisplacement = new Map<string, { group: number; params: GPUBuffer; textureView: GPUTextureView; sampler: GPUSampler }>();
  for (const [key, material] of resources.materials) {
    const group = material.sceneShader?.displacementGroup;
    if (group === undefined || !material.displacement) continue;
    const map = await imageProvider.decode(material.displacement.file);
    if (!map) {
      line(`diag displacement map introuvable: ${material.displacement.file}`);
      continue;
    }
    const dispTex = device.createTexture({
      size: [map.width, map.height],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    device.queue.writeTexture({ texture: dispTex }, map.data, { bytesPerRow: map.width * 4, rowsPerImage: map.height }, [map.width, map.height, 1]);
    const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(params, 0, new Float32Array([material.displacement.scale * dispMul, dispMidpoint, 0, 0]));
    materialDisplacement.set(key, {
      group,
      params,
      textureView: dispTex.createView(),
      sampler: device.createSampler({ addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear' }),
    });
    line(`diag displacement raster ${map.width}x${map.height} map=${material.displacement.file} scale=${(material.displacement.scale * dispMul).toFixed(4)}`);
  }

  const hdrTexture = device.createTexture({
    size: [res, res],
    format: backend.hdrFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const depthTexture = device.createTexture({
    size: [res, res],
    format: backend.depthFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const outputTexture = device.createTexture({
    size: [res, res],
    format: outputFormat,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });
  const hdrView = hdrTexture.createView();
  const depthView = depthTexture.createView();
  const outputView = outputTexture.createView();

  // Hybrid traced shadows: build the shared world BVH (scene-buffers.ts), upload
  // its packed buffers, and create the G-buffer + shadow compute + composite
  // pipelines. A separate compute pass traces one occlusion ray per surface pixel
  // toward the distant light; the scene is also rendered once with the direct
  // light disabled (IBL only) so the composite shadows ONLY the direct term and
  // leaves ambient/IBL untouched. This stays within the raster maxBindGroups budget.
  const SHADOW_STRENGTH = 1.0;
  let shadow:
    | {
        nodes: GPUBuffer; tris: GPUBuffer; triOrder: GPUBuffer;
        gPosView: GPUTextureView; gNormView: GPUTextureView; gDepthView: GPUTextureView;
        visView: GPUTextureView; hdr2View: GPUTextureView; hdrIblView: GPUTextureView;
        gbufferPipeline: GPURenderPipeline; shadowPipeline: GPUComputePipeline; compositePipeline: GPURenderPipeline;
        shadowUniform: GPUBuffer; compositeUniform: GPUBuffer;
        draws: Array<{ position: GPUBuffer; normal: GPUBuffer; indexBuffer: GPUBuffer; indexCount: number; frameUniform: GPUBuffer }>;
      }
    | undefined;
  if (tracedShadows) {
    const ptScene = buildPathTraceScene(resources, {
      lights,
      surfaceFor,
      frameCamera,
      environment: envFrameConfig(envAsset),
      ...(dispScaleOverride !== undefined ? { displacementScale: dispScaleOverride } : {}),
    });
    const storageBuf = (data: Float32Array | Uint32Array): GPUBuffer => {
      const buf = device.createBuffer({ size: Math.max(data.byteLength, 4), usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, data);
      return buf;
    };
    const gPos = device.createTexture({ size: [res, res], format: GBUFFER_POSITION_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const gNorm = device.createTexture({ size: [res, res], format: GBUFFER_NORMAL_FORMAT, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const gDepth = device.createTexture({ size: [res, res], format: backend.depthFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const visTex = device.createTexture({ size: [res, res], format: 'r32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    const hdr2 = device.createTexture({ size: [res, res], format: backend.hdrFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    const hdrIbl = device.createTexture({ size: [res, res], format: backend.hdrFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });

    const gbufferPass = emitGBufferPass();
    const gbufferModule = device.createShaderModule({ code: gbufferPass.code });
    const gbufferPipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: gbufferModule,
        entryPoint: gbufferPass.vertexEntry,
        buffers: [
          { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
          { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] },
        ],
      },
      fragment: { module: gbufferModule, entryPoint: gbufferPass.fragmentEntry, targets: [{ format: GBUFFER_POSITION_FORMAT }, { format: GBUFFER_NORMAL_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: backend.depthFormat, depthWriteEnabled: true, depthCompare: 'less' },
    });

    const shadowPass = emitHybridShadowPass();
    const shadowPipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module: device.createShaderModule({ code: shadowPass.code }), entryPoint: shadowPass.entryPoint },
    });

    const compositePass = emitShadowCompositePass();
    const compositeModule = device.createShaderModule({ code: compositePass.code });
    const compositePipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: compositeModule, entryPoint: compositePass.vertexEntry },
      fragment: { module: compositeModule, entryPoint: compositePass.fragmentEntry, targets: [{ format: backend.hdrFormat }] },
      primitive: { topology: 'triangle-list' },
    });

    const shadowUniform = device.createBuffer({ size: HYBRID_SHADOW_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(shadowUniform, 0, packShadowUniform({ lightDir: frame.light.direction, width: res, height: res }));
    const compositeUniform = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(compositeUniform, 0, new Float32Array([SHADOW_STRENGTH, 0, 0, 0]));

    shadow = {
      nodes: storageBuf(ptScene.nodes), tris: storageBuf(ptScene.triangles), triOrder: storageBuf(ptScene.triangleOrder),
      gPosView: gPos.createView(), gNormView: gNorm.createView(), gDepthView: gDepth.createView(),
      visView: visTex.createView(), hdr2View: hdr2.createView(), hdrIblView: hdrIbl.createView(),
      gbufferPipeline, shadowPipeline, compositePipeline, shadowUniform, compositeUniform,
      draws: [],
    };
    line(`diag shadows raster tris=${ptScene.triangleCount} nodes=${ptScene.nodeCount} strength=${SHADOW_STRENGTH}`);
  }

  const uploaded = new Map<string, ReturnType<typeof uploadGeometry>>();
  for (const [id, geometry] of resources.geometries) uploaded.set(id, uploadGeometry(device, geometry, id));

  const drawsByPass = new Map<ScenePassKind, SceneDrawCall[]>();
  const drawsByPassIbl = new Map<ScenePassKind, SceneDrawCall[]>();
  // IBL-only frame plan: same scene with the distant light killed, so its render
  // isolates the ambient/IBL term the shadow composite must preserve.
  const frameIbl = { ...frame, light: { ...frame.light, color: [0, 0, 0] as Vec3, intensity: 0 } };
  const zeroTexcoords = new Map<string, GPUBuffer>();
  const zeroTangents = new Map<string, GPUBuffer>();
  for (const draw of frame.draws) {
    const buffers = uploaded.get(draw.prototypeId);
    const geometry = resources.geometries.get(draw.prototypeId);
    const position = buffers?.vertexBuffers.get('position');
    const normal = buffers?.vertexBuffers.get('normal');
    if (!buffers || !geometry || !position || !normal) continue;
    const material = draw.materialKey ? resources.materials.get(draw.materialKey) : undefined;
    if (!material?.sceneShader) continue;
    const pipeline = backend.sceneVariantPipeline(draw.pass, material.variant.pipelineKey);
    if (!pipeline) continue;
    let texcoord = buffers.vertexBuffers.get('uv');
    if (!texcoord) {
      texcoord = zeroTexcoords.get(draw.prototypeId);
      if (!texcoord) {
        texcoord = device.createBuffer({ size: geometry.vertexCount * 8, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
        device.queue.writeBuffer(texcoord, 0, new Float32Array(geometry.vertexCount * 2));
        zeroTexcoords.set(draw.prototypeId, texcoord);
      }
    }
    const frameUniform = device.createBuffer({ size: SCENE_FRAME_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    let tangent = buffers.vertexBuffers.get('tangent') ?? zeroTangents.get(draw.prototypeId);
    if (!tangent) {
      tangent = device.createBuffer({ size: geometry.vertexCount * 16, usage: GPUBufferUsage.VERTEX });
      zeroTangents.set(draw.prototypeId, tangent);
    }
    device.queue.writeBuffer(frameUniform, 0, buildSceneFrameUniform(frame, draw));
    const materialUniform = device.createBuffer({ size: SCENE_MATERIAL_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(materialUniform, 0, buildSceneMaterialUniform(draw));
    const textures = draw.materialKey ? materialTextures.get(draw.materialKey) : undefined;
    const displacement = draw.materialKey ? materialDisplacement.get(draw.materialKey) : undefined;
    const bindGroups = createSceneBindGroups(
      device,
      material,
      {
        frame: frameUniform,
        material: materialUniform,
        ...(textures ? { textureViews: textures.textureViews, samplers: textures.samplers } : {}),
        ...(displacement ? { displacement } : {}),
        ...(envGpu ? { environment: { textureView: envGpu.view, sampler: envGpu.sampler, cdf: envGpu.cdfBuffer } } : {}),
      },
      (group) => pipeline.getBindGroupLayout(group),
    );
    const list = drawsByPass.get(draw.pass) ?? [];
    // Collect the texture/sampler groups (everything beyond material 0 and frame)
    // so recordScenePass can bind them alongside the material and frame groups.
    const textureBindGroups = new Map<number, GPUBindGroup>();
    for (const [group, bindGroup] of bindGroups.byGroup) {
      if (bindGroup !== bindGroups.materialBindGroup && bindGroup !== bindGroups.frameBindGroup) {
        textureBindGroups.set(group, bindGroup);
      }
    }
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
    drawsByPass.set(draw.pass, list);
    if (shadow) {
      shadow.draws.push({ position, normal, indexBuffer: buffers.indexBuffer, indexCount: buffers.indexCount, frameUniform });
      // Parallel draw with the light killed, rendered into the IBL-only HDR target.
      const frameUniformIbl = device.createBuffer({ size: SCENE_FRAME_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(frameUniformIbl, 0, buildSceneFrameUniform(frameIbl, draw));
      const bindGroupsIbl = createSceneBindGroups(
        device,
        material,
        {
          frame: frameUniformIbl,
          material: materialUniform,
          ...(textures ? { textureViews: textures.textureViews, samplers: textures.samplers } : {}),
          ...(displacement ? { displacement } : {}),
          ...(envGpu ? { environment: { textureView: envGpu.view, sampler: envGpu.sampler, cdf: envGpu.cdfBuffer } } : {}),
        },
        (group) => pipeline.getBindGroupLayout(group),
      );
      const listIbl = drawsByPassIbl.get(draw.pass) ?? [];
      listIbl.push({
        materialBindGroup: bindGroupsIbl.materialBindGroup,
        frameBindGroup: bindGroupsIbl.frameBindGroup,
        positionBuffer: position,
        normalBuffer: normal,
        texcoordBuffer: texcoord,
        tangentBuffer: tangent,
        indexBuffer: buffers.indexBuffer,
        indexCount: buffers.indexCount,
        pipelineKey: material.variant.pipelineKey,
        ...(textureBindGroups.size > 0 ? { textureBindGroups } : {}),
      });
      drawsByPassIbl.set(draw.pass, listIbl);
    }
  }

  const resolveUniform = device.createBuffer({ size: RESOLVE_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(resolveUniform, 0, new Float32Array([frame.camera.exposure]));
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
  const resolveBindGroup = device.createBindGroup({
    layout: resolvePipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: shadow ? shadow.hdr2View : hdrView },
      { binding: 1, resource: sampler },
      { binding: 2, resource: { buffer: resolveUniform } },
    ],
  });

  // Record the opaque/transmission scene passes into HDR, then tonemap-resolve
  // into the rgba8unorm output texture and copy it back for PNG encoding.
  const renderStart = performance.now();
  const encoder = device.createCommandEncoder();
  let firstPass = true;
  if (envBg) {
    const bgPass = encoder.beginRenderPass({
      colorAttachments: [{ view: hdrView, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
      depthStencilAttachment: { view: depthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    bgPass.setPipeline(envBg.pipeline);
    bgPass.setBindGroup(0, envBg.bindGroup);
    bgPass.draw(3);
    bgPass.end();
    firstPass = false;
  }
  for (const pass of frame.passes) {
    const draws = drawsByPass.get(pass) ?? [];
    if (draws.length === 0) continue;
    backend.recordScenePass(encoder, { pass, hdrView, depthView, draws, clear: firstPass, clearColor: frame.environment.radiance });
    firstPass = false;
  }
  if (shadow) {
    // G-buffer: redraw the geometry writing world position (.w = surface mask) and
    // world normal, so the compute pass has per-pixel shading points to trace from.
    const gPass = encoder.beginRenderPass({
      colorAttachments: [
        { view: shadow.gPosView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
        { view: shadow.gNormView, clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' },
      ],
      depthStencilAttachment: { view: shadow.gDepthView, depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
    });
    gPass.setPipeline(shadow.gbufferPipeline);
    for (const d of shadow.draws) {
      gPass.setBindGroup(0, device.createBindGroup({ layout: shadow.gbufferPipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: d.frameUniform } }] }));
      gPass.setVertexBuffer(0, d.position);
      gPass.setVertexBuffer(1, d.normal);
      gPass.setIndexBuffer(d.indexBuffer, 'uint32');
      gPass.drawIndexed(d.indexCount);
    }
    gPass.end();

    // Traced occlusion: one shadow ray per surface pixel through the shared BVH.
    const b = HYBRID_SHADOW_BINDINGS;
    const shadowBind = device.createBindGroup({
      layout: shadow.shadowPipeline.getBindGroupLayout(0),
      entries: [
        { binding: b.uniform, resource: { buffer: shadow.shadowUniform } },
        { binding: b.nodes, resource: { buffer: shadow.nodes } },
        { binding: b.triangles, resource: { buffer: shadow.tris } },
        { binding: b.triangleOrder, resource: { buffer: shadow.triOrder } },
        { binding: b.gPosition, resource: shadow.gPosView },
        { binding: b.gNormal, resource: shadow.gNormView },
        { binding: b.visibility, resource: shadow.visView },
      ],
    });
    const cPass = encoder.beginComputePass();
    cPass.setPipeline(shadow.shadowPipeline);
    cPass.setBindGroup(0, shadowBind);
    const groups = Math.ceil(res / HYBRID_WORKGROUP_SIZE);
    cPass.dispatchWorkgroups(groups, groups);
    cPass.end();

    // IBL-only render: same geometry with the light killed, into a second HDR so
    // the composite can isolate and shadow only the direct contribution.
    let firstIbl = true;
    for (const pass of frame.passes) {
      const draws = drawsByPassIbl.get(pass) ?? [];
      if (draws.length === 0) continue;
      backend.recordScenePass(encoder, { pass, hdrView: shadow.hdrIblView, depthView, draws, clear: firstIbl, clearColor: [0, 0, 0] });
      firstIbl = false;
    }

    // Composite: out = ibl + (full - ibl) * (1 - strength*(1 - vis)), into hdr2.
    const compBind = device.createBindGroup({
      layout: shadow.compositePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: hdrView },
        { binding: 1, resource: shadow.hdrIblView },
        { binding: 2, resource: shadow.visView },
        { binding: 3, resource: { buffer: shadow.compositeUniform } },
      ],
    });
    const compPass = encoder.beginRenderPass({
      colorAttachments: [{ view: shadow.hdr2View, clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    compPass.setPipeline(shadow.compositePipeline);
    compPass.setBindGroup(0, compBind);
    compPass.draw(3);
    compPass.end();
  }
  backend.recordResolvePass(encoder, { outputView, bindGroup: resolveBindGroup });
  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
  const renderMs = performance.now() - renderStart;

  const bytesPerRow = res * 4;
  const readback = device.createBuffer({ size: bytesPerRow * res, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const copy = device.createCommandEncoder();
  copy.copyTextureToBuffer({ texture: outputTexture }, { buffer: readback, bytesPerRow, rowsPerImage: res }, [res, res, 1]);
  device.queue.submit([copy.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const rgba = new Uint8ClampedArray(new Uint8Array(readback.getMappedRange()).slice(0));
  readback.unmap();
  let lit = 0;
  for (let p = 0; p < res * res; p++) if (Math.max(rgba[p * 4]!, rgba[p * 4 + 1]!, rgba[p * 4 + 2]!) > 0) lit++;
  line(`diag raster lit=${lit}/${res * res} exposure=${exposure} renderMs=${renderMs.toFixed(1)}`);
  return { rgba, renderMs };
}

/** GPU height-map displacement pre-pass: rewrites the packed triangle vertex
 *  buffer in place. Packed triangle stride is 24 floats (v0,v1,v2, n0,n1,n2,
 *  materialIndex, pad); triangleUv stride is 6 floats (u0,v0,u1,v1,u2,v2). */
const DISPLACE_WGSL = /* wgsl */ `
struct DispInfo { triCount: u32, midpoint: f32, pad0: u32, pad1: u32 };

@group(0) @binding(0) var<storage, read_write> tris: array<f32>;
@group(0) @binding(1) var<storage, read> uvs: array<f32>;
@group(0) @binding(2) var<storage, read> scales: array<f32>;
@group(0) @binding(3) var<uniform> info: DispInfo;
@group(0) @binding(4) var dispTex: texture_2d<f32>;
@group(0) @binding(5) var dispSamp: sampler;

const STRIDE: u32 = 24u;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let t = gid.x;
  if (t >= info.triCount) { return; }
  let base = t * STRIDE;
  let matIdx = u32(tris[base + 18u]);
  let scale = scales[matIdx];
  if (scale == 0.0) { return; }
  let ub = t * 6u;
  var p0 = vec3<f32>(tris[base + 0u], tris[base + 1u], tris[base + 2u]);
  var p1 = vec3<f32>(tris[base + 3u], tris[base + 4u], tris[base + 5u]);
  var p2 = vec3<f32>(tris[base + 6u], tris[base + 7u], tris[base + 8u]);
  let n0 = vec3<f32>(tris[base + 9u], tris[base + 10u], tris[base + 11u]);
  let n1 = vec3<f32>(tris[base + 12u], tris[base + 13u], tris[base + 14u]);
  let n2 = vec3<f32>(tris[base + 15u], tris[base + 16u], tris[base + 17u]);
  let uv0 = vec2<f32>(uvs[ub + 0u], uvs[ub + 1u]);
  let uv1 = vec2<f32>(uvs[ub + 2u], uvs[ub + 3u]);
  let uv2 = vec2<f32>(uvs[ub + 4u], uvs[ub + 5u]);
  let h0 = textureSampleLevel(dispTex, dispSamp, uv0, 0.0).r;
  let h1 = textureSampleLevel(dispTex, dispSamp, uv1, 0.0).r;
  let h2 = textureSampleLevel(dispTex, dispSamp, uv2, 0.0).r;
  p0 = p0 + n0 * ((h0 - info.midpoint) * scale);
  p1 = p1 + n1 * ((h1 - info.midpoint) * scale);
  p2 = p2 + n2 * ((h2 - info.midpoint) * scale);
  tris[base + 0u] = p0.x; tris[base + 1u] = p0.y; tris[base + 2u] = p0.z;
  tris[base + 3u] = p1.x; tris[base + 4u] = p1.y; tris[base + 5u] = p1.z;
  tris[base + 6u] = p2.x; tris[base + 7u] = p2.y; tris[base + 8u] = p2.z;
  // Recompute a flat geometric normal from the displaced positions, keeping the
  // winding-consistent orientation of the original interpolated normals.
  let faceN = normalize(cross(p1 - p0, p2 - p0));
  let orient = sign(dot(faceN, n0 + n1 + n2));
  let gn = faceN * orient;
  tris[base + 9u] = gn.x; tris[base + 10u] = gn.y; tris[base + 11u] = gn.z;
  tris[base + 12u] = gn.x; tris[base + 13u] = gn.y; tris[base + 14u] = gn.z;
  tris[base + 15u] = gn.x; tris[base + 16u] = gn.y; tris[base + 17u] = gn.z;
}
`;

/** Path-traces the real USDA geometry on the device GPU and returns display RGBA. */
async function renderUsdOnDevice(
  device: GPUDevice,
  entry: string,
  res: number,
  samples: number,
  line: (m: string) => void,
  materialOverride?: string,
  exposureOverride?: number,
  fireflyOverride?: number,
  skyPowerOverride?: number,
  skyColorOverride?: Vec3,
  camBackOverride?: number,
  dispScaleOverride?: number,
): Promise<{ rgba: Uint8ClampedArray; renderMs: number }> {
  const sink = (d: { level: string; message: string; detail?: unknown }): void => {
    if (d.level === 'warning' || d.level === 'error') {
      line(`diag: ${d.message}`);
      const stack = (d.detail as { stack?: string } | undefined)?.stack;
      if (stack) for (const l of stack.split('\n').slice(0, 6)) if (l.trim()) line(`  at ${l.trim()}`);
    }
  };

  const reader = httpReader(entry);
  const scene = await importUsdStage(entry, { reader, sink });
  if (materialOverride) await overrideMaterialWithMtlx(scene, OPENPBR_MATERIAL_PATH, materialOverride, line);
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });
  const envAsset = await loadEnvironment(lights, entry, sink);
  if (envAsset) line(`diag env ${envAsset.image.width}x${envAsset.image.height} intensity=${envAsset.intensity.toFixed(3)} (dome)`);

  // Load the MaterialX Core WASM and standard libraries once, read every
  // referenced .mtlx into a document source (T057m3a), and feed the graph material
  // compiler (T057m1) so the path tracer builds a megakernel variant per
  // procedural/textured material instead of the retired CPU bake path. Constant
  // materials keep the seven-parameter packed record through surfaceFor.
  const { documents, imageProvider, surfaceFor } = await loadMtlxSceneContext(scene, entry, line, sink);

  const resources = await buildSceneResources(scene, {
    meshSource: await loadExternalMeshSource(scene, meshSourceFromScene(scene), sink),
    materialCompiler: createGraphMaterialCompiler({ documents, sink }),
    sink,
  });
  line('diag step: scene resources built');

  const frameCamera = resolveFrameCamera(cameras, line, exposureOverride, camBackOverride);
  const exposure = frameCamera.exposure;
  // Upload the dome texture + luminance CDF up front so the frame environment config
  // can carry the CDF dimensions/sum used by the tracer's importance sampling.
  const envGpu = envAsset ? uploadEnvTexture(device, envAsset) : undefined;
  const ptScene = buildPathTraceScene(resources, {
    lights,
    surfaceFor,
    frameCamera,
    environment: envFrameConfig(envAsset, envGpu?.cdfStats, skyPowerOverride, skyColorOverride),
    ...(dispScaleOverride !== undefined ? { displacementScale: dispScaleOverride } : {}),
  });
  ptScene.environment.textureRadianceScale = envGpu?.radianceScale ?? 1;
  line(`${resources.instances.length} instance(s), ${samples} spp`);
  line(
    `diag tris=${ptScene.triangleCount} mats=${ptScene.materialCount} ` +
      `bounds min=[${ptScene.bounds.min.map((x) => x.toFixed(2)).join(',')}] max=[${ptScene.bounds.max.map((x) => x.toFixed(2)).join(',')}] ` +
      `eye=[${ptScene.camera.eye.map((x) => x.toFixed(2)).join(',')}]`,
  );
  line(
    `diag light dir=[${ptScene.light.direction.map((x) => x.toFixed(2)).join(',')}] ` +
      `col=[${ptScene.light.color.map((x) => x.toFixed(2)).join(',')}] int=${ptScene.light.intensity} ` +
      `env=[${ptScene.environment.radiance.map((x) => x.toFixed(2)).join(',')}]`,
  );

  // Build the megakernel dispatch from the resolved variant sources and the device
  // bindings plan (T057m2); textures are decoded by the shared image provider.
  const dispatch = buildMaterialDispatch(ptScene.variantSources);
  const bindings = await buildPtDeviceBindings(dispatch, ptScene, imageProvider, { sink });
  const fireflyClamp = Number.isFinite(fireflyOverride) ? (fireflyOverride as number) : 0;
  const sky = ptScene.environment;
  const skyDiag =
    sky.hasTexture && skyColorOverride ? ` sky-color=[${(sky.tint ?? [1, 1, 1]).map((x) => x.toFixed(2)).join(',')}]` : '';
  const skyPowerDiag = sky.hasTexture && skyPowerOverride !== undefined ? ` sky-power=${sky.intensity}` : '';
  line(
    `diag variants=${dispatch.variants.length} textures=${bindings.textures.length} exposure=${exposure}` +
      (fireflyClamp > 0 ? ` firefly=${fireflyClamp}` : '') +
      skyPowerDiag +
      skyDiag,
  );

  // Compute path tracer on the packed scene buffers, progressive accumulation.
  const backend = new PathTraceBackend(device, { dispatch, ...(envAsset ? { environment: true } : {}) });
  device.pushErrorScope('validation');
  const { pipeline, module } = backend.createPipeline();
  const pipelineError = await device.popErrorScope();
  if (pipelineError) line(`diag pipeline validation error: ${pipelineError.message}`);
  if (typeof module.getCompilationInfo === 'function') {
    const info = await module.getCompilationInfo();
    for (const m of info.messages) {
      if (m.type === 'error' || m.type === 'warning') {
        line(`diag wgsl ${m.type} L${m.lineNum}:${m.linePos} ${m.message}`);
      }
    }
    line(`diag wgsl messages=${info.messages.length}`);
  }
  const storage = (data: Float32Array | Uint32Array | Int32Array): GPUBuffer => {
    const buf = device.createBuffer({ size: data.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(buf, 0, data);
    return buf;
  };
  // Zero-length scene streams (no UVs / tangents) would create an invalid empty
  // buffer, so substitute a single-element array of the matching type.
  const storageData = (data: Float32Array | Uint32Array): GPUBuffer =>
    storage(data.byteLength > 0 ? data : data instanceof Uint32Array ? new Uint32Array(1) : new Float32Array(1));

  const accumBytes = res * res * 16;
  const accumBuffer = device.createBuffer({
    size: accumBytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  device.queue.writeBuffer(accumBuffer, 0, new Float32Array(res * res * 4));
  const uniform = device.createBuffer({ size: PT_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  // group-0: the per-frame uniform and accumulation buffers are data-less in the
  // plan (harness-sized), every other slot carries packed scene storage data.
  let triangleBuffer: GPUBuffer | undefined;
  let triangleUvBuffer: GPUBuffer | undefined;
  const group0Entries: GPUBindGroupEntry[] = bindings.group0.map((slot) => {
    if (slot.role === 'uniform') return { binding: slot.binding, resource: { buffer: uniform } };
    if (slot.role === 'accum') return { binding: slot.binding, resource: { buffer: accumBuffer } };
    if (slot.role === 'mxUniforms') {
      // MxUniforms packing is not emitted yet (surface-ir folds constants); bind a
      // zeroed placeholder so the layout stays valid if a variant ever needs it.
      const mx = device.createBuffer({ size: 256, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      return { binding: slot.binding, resource: { buffer: mx } };
    }
    const buf = storageData(slot.data ?? new Float32Array(1));
    if (slot.role === 'triangles') triangleBuffer = buf;
    if (slot.role === 'triangleUv') triangleUvBuffer = buf;
    return { binding: slot.binding, resource: { buffer: buf } };
  });
  const group0 = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: group0Entries });

  // group-1 textures + group-2 samplers (only bound when a material samples any).
  const textureViews = new Map<number, GPUTextureView>();
  for (const tex of bindings.textures) {
    const image = bindings.images[tex.imageIndex];
    const width = image?.width ?? 1;
    const height = image?.height ?? 1;
    const gpuTex = device.createTexture({
      size: [width, height],
      format: tex.format,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    if (image && image.componentType === 'uint8' && image.channels === 4) {
      device.queue.writeTexture(
        { texture: gpuTex },
        image.data,
        { bytesPerRow: width * 4, rowsPerImage: height },
        [width, height, 1],
      );
    }
    textureViews.set(tex.binding, gpuTex.createView());
  }
  const group1 =
    bindings.textures.length > 0
      ? device.createBindGroup({
          layout: pipeline.getBindGroupLayout(1),
          entries: bindings.textures.map((tex) => ({ binding: tex.binding, resource: textureViews.get(tex.binding)! })),
        })
      : undefined;
  const group2 =
    bindings.samplers.length > 0
      ? device.createBindGroup({
          layout: pipeline.getBindGroupLayout(2),
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
    envAsset && envGpu
      ? device.createBindGroup({
          layout: pipeline.getBindGroupLayout(3),
          entries: [
            { binding: 0, resource: envGpu.view },
            { binding: 1, resource: envGpu.sampler },
            { binding: 2, resource: { buffer: envGpu.cdfBuffer } },
          ],
        })
      : undefined;
  // GPU height-map displacement pre-pass (runs once, before accumulation): a
  // compute shader rewrites the packed vertex buffer in place -- each triangle
  // vertex is pushed along its shading normal by (height - midpoint) * scale,
  // sampled from the displacement map at the vertex UV, then the flat geometric
  // normal is recomputed from the displaced positions. The BVH node bounds were
  // already inflated by the max offset in scene-buffers so traversal stays valid
  // without a GPU BVH rebuild. Shared vertices duplicated across soup triangles
  // carry identical UV+normal, so they displace identically -> no cracks.
  if (ptScene.displacement && triangleBuffer && triangleUvBuffer) {
    const map = await imageProvider.decode(ptScene.displacement.mapFile);
    if (!map) {
      line(`diag displacement map introuvable: ${ptScene.displacement.mapFile}`);
    } else {
      const dispTex = device.createTexture({
        size: [map.width, map.height],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      device.queue.writeTexture(
        { texture: dispTex },
        map.data,
        { bytesPerRow: map.width * 4, rowsPerImage: map.height },
        [map.width, map.height, 1],
      );
      const dispSampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        magFilter: 'linear',
        minFilter: 'linear',
      });
      const scaleBuffer = storage(ptScene.displacement.scale);
      const dispInfo = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(dispInfo, 0, new Uint32Array([ptScene.triangleCount, 0, 0, 0]));
      device.queue.writeBuffer(dispInfo, 4, new Float32Array([ptScene.displacement.midpoint]));
      const dispModule = device.createShaderModule({ code: DISPLACE_WGSL });
      const dispPipeline = device.createComputePipeline({
        layout: 'auto',
        compute: { module: dispModule, entryPoint: 'main' },
      });
      const dispGroup = device.createBindGroup({
        layout: dispPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: triangleBuffer } },
          { binding: 1, resource: { buffer: triangleUvBuffer } },
          { binding: 2, resource: { buffer: scaleBuffer } },
          { binding: 3, resource: { buffer: dispInfo } },
          { binding: 4, resource: dispTex.createView() },
          { binding: 5, resource: dispSampler },
        ],
      });
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(dispPipeline);
      pass.setBindGroup(0, dispGroup);
      pass.dispatchWorkgroups(Math.ceil(ptScene.triangleCount / 64), 1, 1);
      pass.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
      line(`diag displacement ${map.width}x${map.height} tris=${ptScene.triangleCount} map=${ptScene.displacement.mapFile}`);
    }
  }

  backend.resetAccumulation();
  const renderStart = performance.now();
  device.pushErrorScope('validation');
  const batch = 8;
  for (let f = 0; f < samples; f++) {
    // Match the viewer's tiled dispatch: full-image alpha/shadow work can exceed
    // the mobile watchdog budget even for a single sample.
    while (backend.frameIndex === f) {
      const { tile, frameIndex } = backend.advanceTile(res, res);
      if (tile.width === 0 || tile.height === 0) { continue; }
      const [wgX, wgY] = PathTraceBackend.workgroupCount(tile.width, tile.height);
      device.queue.writeBuffer(uniform, 0, buildPathTraceUniform(ptScene, frameIndex, 1, res, res, fireflyClamp, tile));
      const encoder = device.createCommandEncoder();
      const compute = encoder.beginComputePass();
      compute.setPipeline(pipeline);
      compute.setBindGroup(0, group0);
      if (group1) compute.setBindGroup(1, group1);
      if (group2) compute.setBindGroup(2, group2);
      if (ptEnvGroup) compute.setBindGroup(3, ptEnvGroup);
      compute.dispatchWorkgroups(wgX, wgY, 1);
      compute.end();
      device.queue.submit([encoder.finish()]);
      await device.queue.onSubmittedWorkDone();
    }
    if ((f + 1) % batch === 0 || f === samples - 1) {
      line(`diag pt frame ${f + 1}/${samples} @ ${(performance.now() - renderStart).toFixed(0)} ms`);
    }
  }
  const frameError = await device.popErrorScope();
  if (frameError) line(`diag dispatch validation error: ${frameError.message}`);
  const renderMs = performance.now() - renderStart;

  // Read the accumulated mean back and tonemap through the shared output pipeline.
  const readback = device.createBuffer({ size: accumBytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
  const copy = device.createCommandEncoder();
  copy.copyBufferToBuffer(accumBuffer, 0, readback, 0, accumBytes);
  device.queue.submit([copy.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const mean = new Float32Array(readback.getMappedRange());
  let nonFinite = 0;
  for (let p = 0; p < res * res; p++) {
    for (let c = 0; c < 3; c++) if (!Number.isFinite(mean[p * 4 + c])) nonFinite++;
  }
  line(`diag accum nonfinite=${nonFinite}`);
  if (nonFinite > 0) {
    readback.unmap();
    throw new Error(`Pathtracing accumulation contains ${nonFinite} non-finite RGB components`);
  }
  const rgba = new Uint8ClampedArray(res * res * 4);
  for (let p = 0; p < res * res; p++) {
    const o = p * 4;
    const color = resolvePixel([[mean[o]!, mean[o + 1]!, mean[o + 2]!]], { exposureEv: exposure }).color;
    rgba[o] = Math.round(color[0] * 255);
    rgba[o + 1] = Math.round(color[1] * 255);
    rgba[o + 2] = Math.round(color[2] * 255);
    rgba[o + 3] = 255;
  }
  {
    let accMax = 0;
    let accSum = 0;
    let nan = 0;
    for (let i = 0; i < res * res * 4; i++) {
      const v = mean[i]!;
      if (Number.isNaN(v)) nan++;
      else {
        if (v > accMax) accMax = v;
        accSum += v;
      }
    }
    let outMax = 0;
    let outNonZero = 0;
    for (let p = 0; p < res * res; p++) {
      const o = p * 4;
      const m = Math.max(rgba[o]!, rgba[o + 1]!, rgba[o + 2]!);
      if (m > outMax) outMax = m;
      if (m > 0) outNonZero++;
    }
    line(`diag accum max=${accMax.toFixed(3)} mean=${(accSum / (res * res * 4)).toFixed(4)} nan=${nan} outMax=${outMax} lit=${outNonZero}/${res * res}`);
  }
  readback.unmap();
  return { rgba, renderMs };
}

export async function bootstrapUsdImage(
  entry = '/scenes/test_material_disney_gold/test_material_disney_gold.usda',
  res = 256,
  samples = 192,
  backend: 'raster' | 'pathtracing' = 'pathtracing',
  materialOverride?: string,
  exposure?: number,
  firefly?: number,
  skyPower?: number,
  skyColor?: Vec3,
  camBack?: number,
  dispScale?: number,
  tracedShadows?: boolean,
  lightDir?: Vec3,
): Promise<UsdSceneImage | null> {
  const root = typeof document !== 'undefined' ? document.getElementById('log') ?? document.body : undefined;
  const line = (msg: string): void => {
    if (!root) return;
    const p = document.createElement('p');
    p.textContent = msg;
    root.appendChild(p);
  };
  const fail = (): null => {
    (globalThis as { __MX_IMAGE__?: UsdSceneImage | null }).__MX_IMAGE__ = null;
    return null;
  };

  if (typeof navigator === 'undefined' || !navigator.gpu) {
    line('WebGPU indisponible sur cet appareil.');
    return fail();
  }
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  if (!adapter) {
    line('Aucun adaptateur WebGPU.');
    return fail();
  }
  const device = await adapter.requestDevice();
  // Surface a GPU device loss (e.g. a Windows TDR watchdog reset after a long
  // megakernel dispatch) instead of hanging silently on onSubmittedWorkDone.
  device.lost.then((info) => line(`diag device lost: ${info.reason} ${info.message}`)).catch(() => undefined);
  device.onuncapturederror = (event) => line(`diag uncaptured error: ${event.error.message}`);

  let rgba: Uint8ClampedArray;
  let renderMs: number;
  if (materialOverride) line(`OpenPBRMaterial override: ${materialOverride}`);
  if (backend === 'raster') {
    line(`Rendu raster GPU de ${entry} (${res}x${res})...`);
    ({ rgba, renderMs } = await renderUsdRasterOnDevice(device, entry, res, line, materialOverride, exposure, camBack, dispScale, tracedShadows, lightDir));
  } else {
    line(`Rendu path-trace GPU de ${entry} (${res}x${res}, ${samples} spp)...`);
    ({ rgba, renderMs } = await renderUsdOnDevice(device, entry, res, samples, line, materialOverride, exposure, firefly, skyPower, skyColor, camBack, dispScale));
  }

  const canvas = document.createElement('canvas');
  canvas.width = res;
  canvas.height = res;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    line('Canvas 2D indisponible.');
    return fail();
  }
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, res, res), 0, 0);
  const dataUrl = canvas.toDataURL('image/png');

  const img = document.createElement('img');
  img.src = dataUrl;
  img.width = Math.min(512, res * 2);
  if (root) root.appendChild(img);

  const info = adapter.info;
  const effectiveSamples = backend === 'raster' ? 1 : samples;
  let lumaSum = 0;
  let lit = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const luma = 0.2126 * rgba[i]! + 0.7152 * rgba[i + 1]! + 0.0722 * rgba[i + 2]!;
    lumaSum += luma;
    if (luma > 2) lit++;
  }
  const pixels = Math.max(1, rgba.length / 4);
  const stats = { meanLuma: lumaSum / pixels, litFraction: lit / pixels };
  const image: UsdSceneImage = {
    entry, width: res, height: res, samples: effectiveSamples, dataUrl, backend, renderMs, stats,
    ...(materialOverride !== undefined ? { materialOverride } : {}),
  };
  (globalThis as { __MX_IMAGE__?: UsdSceneImage | null }).__MX_IMAGE__ = image;
  line(`${info?.vendor ?? 'gpu'} / ${info?.architecture ?? '?'} - ${backend} prete en ${renderMs.toFixed(0)} ms.`);
  return image;
}
