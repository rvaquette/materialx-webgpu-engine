// T053a validation run (plan section 9, P9). Validates the engine end-to-end on
// the SINGLE scene scenes/test_material_disney_gold/test_material_disney_gold.usda:
//   1. composed loading of the text USDA stage (importUsdStage),
//   2. diagnostics for unsupported / approximated features (recorded, never
//      silently dropped -- REQ-013),
//   3. both executable backends built from ONE SceneResources on the SAME assets
//      (raster scene-frame + path-tracing scene-buffers, via compareSceneBackends),
//   4. Node-measurable proxies for load / compile / render time and memory
//      (buffer byte sizes + heap), since Node has no WebGPU -- the real GPU-local
//      timings come from the browser device harness (T053).
//   5. a CPU path-traced preview PNG (renders/, gitignored) of the real scene
//      geometry using the reference integrator -- the same packed BVH/triangles
//      the WGSL compute shader reads, with its exact camera-ray unprojection.
// Not part of the test suite. Run with: node scripts/validate-disney-gold.ts
// (Node >=23.6 strips the TypeScript types natively, so no build step is needed).
// Optional args: [resolution] [spp]. Emits a JSON report under docs/generated/,
// a PNG under renders/, and prints a French summary.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { emitWgsl } from '../src/compiler/wgsl.ts';
import { FLOAT, IrModuleBuilder, shaderType } from '../src/compiler/ir.ts';
import { importUsdStage, type UsdLayerReader } from '../src/usd/importer.ts';
import { importLights } from '../src/usd/lights.ts';
import { importCameras } from '../src/usd/cameras.ts';
import {
  buildSceneResources,
  type MaterialBuild,
  type MaterialCompiler,
  type MaterialResource,
  type MeshSource,
} from '../src/render/scene-resources.ts';
import {
  buildPathTraceScene,
  createSceneSampler,
  type PathTraceCamera,
} from '../src/render/pathtracing/scene-buffers.ts';
import { compareSceneBackends } from '../src/render/compare-backends.ts';
import { integratePath, createPcg32, type Ray } from '../src/render/pathtracing/integrator.ts';
import { applyExposure, tonemap, encodeOutput } from '../src/render/output.ts';
import { lookAt4, multiply4, perspective4 } from '../src/scene/transforms.ts';
import {
  NEUTRAL_SURFACE,
  type BuildSceneFrameOptions,
  type FrameCamera,
  type RasterSurface,
} from '../src/render/raster/scene-frame.ts';
import type { RawMesh } from '../src/geometry/prepare.ts';
import type { Diagnostic } from '../src/core/diagnostics.ts';
import type { Vec3 } from '../src/scene/transforms.ts';
import type { SceneAsset, ScenePrim } from '../src/scene/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SCENE_DIR = resolve(here, '../scenes/test_material_disney_gold');
const ENTRY = join(SCENE_DIR, 'test_material_disney_gold.usda');
const OUT_DIR = resolve(here, '../docs/generated');
const OUT_FILE = join(OUT_DIR, 't053a-disney-gold.json');
const RENDERS_DIR = resolve(here, '../renders');
const PNG_FILE = join(RENDERS_DIR, 't053a-disney-gold.png');
const RES = Math.max(16, Number.parseInt(process.argv[2] ?? '256', 10) || 256);
const SPP = Math.max(1, Number.parseInt(process.argv[3] ?? '32', 10) || 32);

/** Reads USD/MaterialX layers off disk, resolving relative paths against the scene dir. */
function fsReader(sceneDir: string): UsdLayerReader {
  return {
    async read(uri: string): Promise<string> {
      const abs = uri.startsWith('/') || /^[A-Za-z]:/.test(uri) ? uri : resolve(sceneDir, uri);
      return readFileSync(abs, 'utf8');
    },
  };
}

/** Flat numeric attribute array (point3f[]/int[] flatten to readonly number[]). */
function numArray(prim: ScenePrim, name: string): number[] {
  const value = prim.attributes.get(name)?.value;
  return Array.isArray(value) ? (value as readonly unknown[]).map((v) => Number(v)) : [];
}

/** Supplies inline USDA mesh geometry per prototype prim path. */
function meshSourceFromScene(scene: SceneAsset): MeshSource {
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
      return {
        points,
        faceVertexCounts,
        faceVertexIndices,
        ...(leftHanded ? { leftHanded: true } : {}),
      };
    },
  };
}

/** Parse an OpenPBR MaterialX shader's inputs into the canonical raster surface. */
function parseOpenPbr(text: string): RasterSurface {
  const inputs: Record<string, number | number[]> = {};
  const re = /<input\s+name="([^"]+)"\s+type="([^"]+)"\s+value="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = m[1]!;
    const type = m[2]!;
    const value = m[3]!;
    if (type === 'color3' || type === 'vector3') {
      inputs[name] = value.split(',').map((v) => Number.parseFloat(v.trim()));
    } else if (type === 'float' || type === 'integer') {
      inputs[name] = Number.parseFloat(value);
    }
  }
  const num = (k: string, d: number): number => (typeof inputs[k] === 'number' ? (inputs[k] as number) : d);
  const col = (k: string, d: [number, number, number]): [number, number, number] => {
    const v = inputs[k];
    return Array.isArray(v) && v.length >= 3 ? [v[0]!, v[1]!, v[2]!] : d;
  };
  return {
    baseColor: col('base_color', [0.8, 0.8, 0.8]),
    metalness: num('base_metalness', 0),
    roughness: num('specular_roughness', 0.3),
    transmission: num('transmission_weight', 0),
    subsurface: num('subsurface_weight', 0),
    ior: num('specular_ior', 1.5),
    specular: num('specular_weight', 1),
  };
}

// --- CPU preview PNG ---------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeData), 0);
  return Buffer.concat([len, typeData, crc]);
}

function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type 0 (None)
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Primary ray for pixel (px,py) -- byte-for-byte the WGSL camera_ray unprojection. */
function cameraRay(cam: PathTraceCamera, px: number, py: number, w: number, h: number, jx: number, jy: number): Ray {
  const ndcX = ((px + jx) / w) * 2 - 1;
  const ndcY = 1 - ((py + jy) / h) * 2;
  const m = cam.invViewProj;
  const fx = m[0]! * ndcX + m[4]! * ndcY + m[8]! + m[12]!;
  const fy = m[1]! * ndcX + m[5]! * ndcY + m[9]! + m[13]!;
  const fz = m[2]! * ndcX + m[6]! * ndcY + m[10]! + m[14]!;
  const fw = m[3]! * ndcX + m[7]! * ndcY + m[11]! + m[15]!;
  const dx = fx / fw - cam.eye[0];
  const dy = fy / fw - cam.eye[1];
  const dz = fz / fw - cam.eye[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  return { origin: cam.eye, direction: [dx / len, dy / len, dz / len] };
}

/** Resolve one linear HDR pixel to 8-bit sRGB via the shared output pipeline. */
function resolvePixel(c: Vec3, exposure: number): [number, number, number] {
  const enc = encodeOutput(tonemap(applyExposure(c, exposure), 'acesFilmic'), 'lin_rec709').color;
  const q = (x: number): number => Math.round(Math.min(Math.max(x, 0), 1) * 255);
  return [q(enc[0]), q(enc[1]), q(enc[2])];
}

/** Minimal opaque material compiler: the surface params come from the .mtlx files;
 *  the full MaterialX -> IR -> WGSL compile is validated separately (T044/T045). */
function stubCompiler(): MaterialCompiler {
  return {
    compile(): MaterialBuild {
      const b = new IrModuleBuilder();
      const opacity = b.constant(FLOAT, 1);
      const ref = b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
      b.output({ name: 'surfaceshader', type: shaderType('surface'), ref });
      const ir = b.build();
      return { ir, module: emitWgsl(ir) };
    },
  };
}

async function main(): Promise<void> {
  if (!existsSync(ENTRY)) {
    console.error(`[t053a] scene introuvable: ${ENTRY}`);
    console.error('[t053a] generez-la localement (scripts/build-disney-gold-scene.mjs) puis relancez.');
    process.exitCode = 1;
    return;
  }

  const diagnostics: Diagnostic[] = [];
  const sink = (d: Diagnostic): void => {
    diagnostics.push(d);
  };

  const heap0 = process.memoryUsage().heapUsed;
  const t0 = performance.now();

  // 1. Composed loading.
  const scene = await importUsdStage(ENTRY, { reader: fsReader(SCENE_DIR), sink });
  const tLoad = performance.now();

  // 2. Lights + cameras (diagnostics for anything unknown).
  const lights = importLights(scene, { sink });
  const cameras = importCameras(scene, { sink });
  const tImport = performance.now();

  // Area lights are approximated as a single directional light by the current
  // executable backends (directionalLightFrom). Surface that explicitly (REQ-013).
  for (const l of lights) {
    if (l.type === 'sphere' || l.type === 'rect' || l.type === 'disk' || l.type === 'cylinder') {
      diagnostics.push({
        level: 'info',
        message: `Lumiere de surface ${l.usdType} (${l.path}) approximee en lumiere directionnelle par le backend executable.`,
        detail: { light: l.path, type: l.type },
      });
    }
  }

  // Parse the OpenPBR surfaces straight off the referenced .mtlx files.
  const surfaces = new Map<string, RasterSurface>();
  for (const ref of scene.materials) {
    const mtlxPath = resolve(SCENE_DIR, ref.assetPath);
    if (existsSync(mtlxPath)) {
      surfaces.set(ref.materialName, parseOpenPbr(readFileSync(mtlxPath, 'utf8')));
    } else {
      diagnostics.push({ level: 'warning', message: `MaterialX introuvable: ${ref.assetPath}`, detail: { material: ref.materialName } });
    }
  }
  const surfaceFor = (material: MaterialResource): RasterSurface =>
    surfaces.get(material.materialName) ?? NEUTRAL_SURFACE;

  // 3. One SceneResources, both backends from the SAME assets.
  const resources = await buildSceneResources(scene, {
    meshSource: meshSourceFromScene(scene),
    materialCompiler: stubCompiler(),
    sink,
  });
  const tResources = performance.now();

  const camera = cameras[0];
  const frameOpts: BuildSceneFrameOptions = {
    lights,
    surfaceFor,
    ...(camera ? { camera } : {}),
  };
  const comparison = compareSceneBackends(resources, frameOpts);
  const pt = buildPathTraceScene(resources, frameOpts);
  const tRender = performance.now();

  // 4. CPU path-traced preview of the REAL scene geometry (renders/, gitignored).
  // The gold material is a pure metal (metalness=1, roughness=0.02): it only
  // reflects the environment, and the two area lights are approximated as a single
  // directional light (see diagnostics) that grazes the up-facing ground. Under
  // the scene's near-black default environment the result is faithfully almost
  // black. For a LEGIBLE thumbnail we render against a neutral constant
  // environment (studio fill) that still goes through the real BSDF, from a
  // preview camera framed on the cube+sphere cluster (the authored scene camera
  // is pulled far back behind a 20x20 ground plane). Both overrides are
  // preview-only; the validation numbers above use the scene's own camera and
  // environment. Real lighting/framing fidelity on the GPU is T053.
  const previewEnv: Vec3 = [0.6, 0.6, 0.6];
  const target: Vec3 = [0, 0.3, 0];
  const dir: Vec3 = [0.657, 0.438, 0.613]; // normalized authored-camera view axis
  const dist = 7;
  const eye: Vec3 = [target[0] + dir[0] * dist, target[1] + dir[1] * dist, target[2] + dir[2] * dist];
  const previewCamera: FrameCamera = {
    viewProj: multiply4(perspective4(0.62, 1, 0.1, 100), lookAt4(eye, target, [0, 1, 0])),
    eye,
    exposure: camera?.exposure ?? 0,
  };
  const ptPreview = buildPathTraceScene(resources, {
    ...frameOpts,
    frameCamera: previewCamera,
    environment: { radiance: previewEnv },
  });
  const sampler = createSceneSampler(ptPreview);
  const rgba = new Uint8Array(RES * RES * 4);
  let primaryHits = 0;
  const tImg0 = performance.now();
  for (let py = 0; py < RES; py++) {
    for (let px = 0; px < RES; px++) {
      const idx = (py * RES + px) * 4;
      if (!sampler.intersect(cameraRay(ptPreview.camera, px, py, RES, RES, 0.5, 0.5))) continue; // transparent miss
      primaryHits += 1;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let s = 0; s < SPP; s++) {
        const rng = createPcg32((py * RES + px) * SPP + s + 1);
        const jx = rng();
        const jy = rng();
        const L = integratePath(sampler, cameraRay(ptPreview.camera, px, py, RES, RES, jx, jy), rng);
        r += L[0];
        g += L[1];
        b += L[2];
      }
      const mean: Vec3 = [r / SPP, g / SPP, b / SPP];
      const [cr, cg, cb] = resolvePixel(mean, ptPreview.camera.exposure);
      rgba[idx] = cr;
      rgba[idx + 1] = cg;
      rgba[idx + 2] = cb;
      rgba[idx + 3] = 255;
    }
  }
  const tImg = performance.now();
  mkdirSync(RENDERS_DIR, { recursive: true });
  writeFileSync(PNG_FILE, encodePng(RES, RES, rgba));

  const triangleTotal = [...resources.geometries.values()].reduce((s, g) => s + g.triangleCount, 0);
  const ptNodesBytes = pt.nodes.byteLength;
  const ptTrianglesBytes = pt.triangles.byteLength;
  const ptMaterialsBytes = pt.materials.byteLength;
  const heapUsedBytes = process.memoryUsage().heapUsed - heap0;

  const report = {
    scene: 'scenes/test_material_disney_gold/test_material_disney_gold.usda',
    timestamp: new Date().toISOString(),
    node: process.version,
    loading: {
      prims: scene.prims.size,
      roots: scene.roots.length,
      materials: scene.materials.map((m) => m.materialName),
      meshes: [...scene.prims.values()].filter((p) => p.typeName === 'Mesh').map((p) => p.path),
      lights: lights.map((l) => ({ path: l.path, type: l.type, usdType: l.usdType })),
      cameras: cameras.map((c) => ({ path: c.path, projection: c.projection })),
    },
    resources: {
      geometries: resources.geometries.size,
      instances: resources.instances.length,
      triangles: triangleTotal,
      pendingGeometry: resources.pendingGeometry,
      pendingMaterials: resources.pendingMaterials,
      unboundGprims: resources.unboundGprims,
    },
    backends: {
      rasterDraws: comparison.rasterDraws,
      pathTraceTriangles: comparison.pathTraceTriangles,
      materialCount: comparison.materialCount,
      sharedCamera: comparison.sharedCamera,
      sharedLight: comparison.sharedLight,
      diffuseProbe: { maxAbsDiff: comparison.diffuseProbe.maxAbsDiff, agree: comparison.diffuseProbe.agree },
    },
    memory: {
      ptNodesBytes,
      ptTrianglesBytes,
      ptMaterialsBytes,
      ptTotalBytes: ptNodesBytes + ptTrianglesBytes + ptMaterialsBytes,
      heapUsedBytes,
    },
    image: {
      path: 'renders/t053a-disney-gold.png',
      width: RES,
      height: RES,
      spp: SPP,
      primaryHits,
      pixels: RES * RES,
      coverage: primaryHits / (RES * RES),
      previewEnvironment: previewEnv,
      renderMs: tImg - tImg0,
    },
    timings: {
      loadMs: tLoad - t0,
      importMs: tImport - tLoad,
      resourcesMs: tResources - tImport,
      backendsMs: tRender - tResources,
      imageMs: tImg - tImg0,
      totalMs: tImg - t0,
    },
    diagnostics: diagnostics.map((d) => ({ level: d.level, message: d.message })),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + '\n');

  const ms = (x: number): string => `${x.toFixed(2)} ms`;
  const kb = (x: number): string => `${(x / 1024).toFixed(1)} Kio`;
  console.log('[t053a] Validation bout-en-bout - test_material_disney_gold');
  console.log(`[t053a] Node ${report.node}`);
  console.log(`[t053a] Chargement compose : ${report.loading.prims} prims, ${report.loading.meshes.length} meshes, ` +
    `${report.loading.lights.length} lumieres, ${report.loading.cameras.length} camera(s), ` +
    `materiaux [${report.loading.materials.join(', ')}]`);
  console.log(`[t053a] Ressources : ${report.resources.geometries} geometries, ${report.resources.instances} instances, ` +
    `${report.resources.triangles} triangles ; pending geo=${report.resources.pendingGeometry.length}, ` +
    `pending mat=${report.resources.pendingMaterials.length}, non bornes=${report.resources.unboundGprims.length}`);
  console.log(`[t053a] Backends partages : rasterDraws=${report.backends.rasterDraws}, ` +
    `ptTriangles=${report.backends.pathTraceTriangles}, materiaux=${report.backends.materialCount}, ` +
    `cameraPartagee=${report.backends.sharedCamera}, lumierePartagee=${report.backends.sharedLight}, ` +
    `probeDiffuse=${report.backends.diffuseProbe.agree} (maxAbs=${report.backends.diffuseProbe.maxAbsDiff.toExponential(2)})`);
  console.log(`[t053a] Memoire buffers PT : noeuds=${kb(ptNodesBytes)}, triangles=${kb(ptTrianglesBytes)}, ` +
    `materiaux=${kb(ptMaterialsBytes)}, total=${kb(report.memory.ptTotalBytes)} ; heap=${kb(heapUsedBytes)}`);
  console.log(`[t053a] Rendu CPU : ${RES}x${RES}, ${SPP} spp, couverture=${(report.image.coverage * 100).toFixed(1)}% ` +
    `(${primaryHits}/${RES * RES} px) -> ${PNG_FILE}`);
  console.log(`[t053a] Temps : load=${ms(report.timings.loadMs)}, import=${ms(report.timings.importMs)}, ` +
    `ressources=${ms(report.timings.resourcesMs)}, backends=${ms(report.timings.backendsMs)}, ` +
    `image(CPU)=${ms(report.timings.imageMs)}, total=${ms(report.timings.totalMs)}`);
  console.log(`[t053a] Diagnostics (${diagnostics.length}) :`);
  for (const d of diagnostics) console.log(`[t053a]   - [${d.level}] ${d.message}`);
  console.log(`[t053a] Rapport JSON : ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('[t053a] echec:', err);
  process.exitCode = 1;
});
