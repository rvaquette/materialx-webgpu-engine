// Derives new standalone USDA scenes from the test_material_disney_gold scene by
// reusing its geometry / camera / lights and swapping only the subject material
// (cube + sphere) for a different MaterialX document. The ground material is kept.
// The source .mtlx is copied next to the generated .usda so the scene stays
// self-contained and loadable by the engine importer over HTTP.
//
// Usage: node scripts/build-material-variant-scenes.mjs

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const GOLD_DIR = join(projectRoot, 'scenes', 'test_material_disney_gold');
const GOLD_USDA = join(GOLD_DIR, 'test_material_disney_gold.usda');

const VARIANTS = [
  {
    name: 'velvet',
    scene: 'test_material_velvet',
    mtlx: 'D:/WebGL2/MaterialX/material-samples/materials/showcase/standard_surface/velvet/velvet.mtlx',
  },
  {
    name: 'metal_brushed',
    scene: 'test_material_metal_brushed',
    mtlx: 'D:/WebGL2/MaterialX/material-samples/materials/showcase/standard_surface/metal_brushed/metal_brushed.mtlx',
  },
  {
    name: 'brick_procedural',
    scene: 'test_material_brick_procedural',
    mtlx: 'D:/WebGL2/MaterialX/material-samples/materials/showcase/standard_surface/brick_procedural/brick_procedural.mtlx',
  },
];

const goldUsda = readFileSync(GOLD_USDA, 'utf8');

for (const v of VARIANTS) {
  const mtlxFile = basename(v.mtlx);
  const outDir = join(projectRoot, 'scenes', v.scene);
  mkdirSync(outDir, { recursive: true });

  // Swap the gold Material prim for the variant, then rebind cube/sphere to it.
  let usda = goldUsda
    .replace(
      /def Material "gold" \(\s*prepend references = @\.\/gold\.mtlx@<\/MaterialX\/Materials\/gold>/,
      `def Material "${v.name}" (\n            prepend references = @./${mtlxFile}@</MaterialX/Materials/${v.name}>`,
    )
    .replaceAll('</World/Looks/gold>', `</World/Looks/${v.name}>`)
    .replace('test_material_disney_gold converted to OpenPBR MaterialX', `${v.scene} (material swapped to ${mtlxFile})`);

  writeFileSync(join(outDir, `${v.scene}.usda`), usda);
  copyFileSync(v.mtlx, join(outDir, mtlxFile));
  copyFileSync(join(GOLD_DIR, 'ground.mtlx'), join(outDir, 'ground.mtlx'));
  console.log(`[variant] wrote scenes/${v.scene}/${v.scene}.usda (+ ${mtlxFile}, ground.mtlx)`);
}
