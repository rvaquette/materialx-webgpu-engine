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
// Not part of the test suite. Run with: node scripts/validate-disney-gold.ts
// (Node >=23.6 strips the TypeScript types natively, so no build step is needed).
// Emits a JSON report under docs/generated/ and prints a French summary.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
import { buildPathTraceScene } from '../src/render/pathtracing/scene-buffers.ts';
import { compareSceneBackends } from '../src/render/compare-backends.ts';
import {
  NEUTRAL_SURFACE,
  type BuildSceneFrameOptions,
  type RasterSurface,
} from '../src/render/raster/scene-frame.ts';
import type { RawMesh } from '../src/geometry/prepare.ts';
import type { Diagnostic } from '../src/core/diagnostics.ts';
import type { SceneAsset, ScenePrim } from '../src/scene/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SCENE_DIR = resolve(here, '../scenes/test_material_disney_gold');
const ENTRY = join(SCENE_DIR, 'test_material_disney_gold.usda');
const OUT_DIR = resolve(here, '../docs/generated');
const OUT_FILE = join(OUT_DIR, 't053a-disney-gold.json');

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
    timings: {
      loadMs: tLoad - t0,
      importMs: tImport - tLoad,
      resourcesMs: tResources - tImport,
      renderMs: tRender - tResources,
      totalMs: tRender - t0,
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
  console.log(`[t053a] Temps : load=${ms(report.timings.loadMs)}, import=${ms(report.timings.importMs)}, ` +
    `ressources=${ms(report.timings.resourcesMs)}, rendu(CPU)=${ms(report.timings.renderMs)}, ` +
    `total=${ms(report.timings.totalMs)}`);
  console.log(`[t053a] Diagnostics (${diagnostics.length}) :`);
  for (const d of diagnostics) console.log(`[t053a]   - [${d.level}] ${d.message}`);
  console.log(`[t053a] Rapport JSON : ${OUT_FILE}`);
}

main().catch((err) => {
  console.error('[t053a] echec:', err);
  process.exitCode = 1;
});
