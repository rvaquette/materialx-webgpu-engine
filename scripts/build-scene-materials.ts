// T035c3 prebuild: extract canonical surface parameters from the MaterialX
// example .mtlx files referenced by the control scenes (T033) and emit a
// deterministic JSON fixture the .ts tests import without touching node:fs.
// Only scenes declaring BOTH raster and pathtracing backends are extracted, so
// the cross-backend comparison (T035c4) has shared material inputs. Per-family
// input names are mapped to one canonical model (baseColor / metalness /
// roughness / transmission / subsurface / ior / specular); missing inputs fall
// back to that family's MaterialX defaults.
// T055e1: ported from .mjs to .ts so it runs under `node` (Node >=23.6 strips the
// types) and can import from src/ -- it now shares the fixture rounding helper
// (src/compiler/layered-serialize.ts).
// T055e4: the per-family toCanonical switch is gone; the 7 flat fields are now
// derived from the single LayeredClosure lowering path via layeredToCanonical, so
// there is no parallel hand mapping left in this script.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { roundTo, serializeLayeredClosure } from '../src/compiler/layered-serialize.ts';
import {
  parseSurfaceInputsFromMtlx,
  parsedInputsToLayered,
  parsedSurfaceToCanonical,
} from '../src/materialx/surface-from-inputs.ts';

const here = dirname(fileURLToPath(import.meta.url));
const SCENES = resolve(here, '../tests/fixtures/control-scenes.json');
const OUT = resolve(here, '../tests/fixtures/scene-materials.json');
const EXAMPLES_DIR =
  process.env.MATERIALX_EXAMPLES ??
  'D:\\WebGL2\\MaterialX\\MaterialX-rva\\resources\\Materials\\Examples';

const round6 = (x: number): number => roundTo(x, 6);

interface Scene {
  id: string;
  material: string;
  family: string;
  focus: string[];
  backends: string[];
}

const scenesDoc = JSON.parse(readFileSync(SCENES, 'utf8')) as { scenes: Scene[] };
const out: { source: string; scenes: Record<string, unknown> } = {
  source: 'MaterialX-rva/resources/Materials/Examples',
  scenes: {},
};

for (const scene of scenesDoc.scenes) {
  if (!(scene.backends.includes('raster') && scene.backends.includes('pathtracing'))) continue;
  const path = resolve(EXAMPLES_DIR, scene.material.replace(/\//g, '\\'));
  const text = readFileSync(path, 'utf8');
  const spec = parseSurfaceInputsFromMtlx(text);
  if (!spec) throw new Error(`no known surface shader node found for ${scene.id}`);
  // Single parse feeds both derivations: the LayeredClosure (lowering path) and
  // the 7 flat fields (shared parsedSurfaceToCanonical reduction) come from the
  // same spec -- no parallel per-family mapping remains in this script.
  const closure = parsedInputsToLayered(spec);
  if (!closure) throw new Error(`could not lower surface closure for ${scene.id} (${spec.category})`);
  const canon = parsedSurfaceToCanonical(spec);
  out.scenes[scene.id] = {
    family: scene.family,
    focus: scene.focus,
    baseColor: canon.baseColor.map(round6),
    metalness: round6(canon.metalness),
    roughness: round6(canon.roughness),
    transmission: round6(canon.transmission),
    subsurface: round6(canon.subsurface),
    ior: round6(canon.ior),
    specular: round6(canon.specular),
    closure: serializeLayeredClosure(closure),
  };
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`[materials] extracted ${Object.keys(out.scenes).length} scenes -> ${OUT}`);
