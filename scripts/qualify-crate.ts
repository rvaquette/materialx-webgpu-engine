// T048 crate-reader qualification harness. Exercises the real engine path
// (importCrate + the default OpenUSD-wasm loader) against the reference crates
// and prints a per-crate SceneAsset summary. Run: `node scripts/qualify-crate.ts`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { importCrate } from '../src/usd/crate.ts';
import { loadOpenUsd } from './openusd-loader.ts';
import type { ScenePrim } from '../src/scene/types.ts';

const SCENE_ROOT = 'D:/WebGL2/MaterialX/OpenPBRShaderPlayground/ShdrPlygrnd';
const CRATES = ['assets/ShdrPlygrnd_Geo.usd', 'cameras/renderCams.usd', 'lights/lightRig.usd'];

function tally(prims: Iterable<ScenePrim>): Map<string, number> {
  const byType = new Map<string, number>();
  for (const p of prims) {
    const t = p.typeName ?? '(typeless)';
    byType.set(t, (byType.get(t) ?? 0) + 1);
  }
  return byType;
}

async function main(): Promise<void> {
  const loadModule = loadOpenUsd;
  for (const rel of CRATES) {
    console.log(`\n=== ${rel} ===`);
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(join(SCENE_ROOT, rel)));
    } catch (e) {
      console.log(`  skip (not found): ${(e as Error).message}`);
      continue;
    }
    const t0 = Date.now();
    const scene = await importCrate(bytes, rel, { loadModule, sink: (d) => d.level !== 'info' && console.log(`  [${d.level}] ${d.message}`) });
    const byType = tally(scene.prims.values());
    console.log(`  imported in ${Date.now() - t0} ms  upAxis=${scene.stage.upAxis ?? '?'}  prims=${scene.prims.size}`);
    console.log('  by type:', [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(', '));

    const firstMesh = [...scene.prims.values()].find((p) => p.typeName === 'Mesh');
    if (firstMesh) {
      const pts = firstMesh.attributes.get('points')?.value;
      const idx = firstMesh.attributes.get('faceVertexIndices')?.value;
      const nVerts = Array.isArray(pts) ? pts.length / 3 : 0;
      const nIdx = Array.isArray(idx) ? idx.length : 0;
      const primvars = firstMesh.mesh?.primvars.map((p) => p.name).join(', ') ?? '';
      console.log(`  mesh ${firstMesh.path}: ${nVerts} verts, ${nIdx} indices, primvars=[${primvars}]`);
    }
  }
  console.log('\ndone.');
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
