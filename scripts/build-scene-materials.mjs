// T035c3 prebuild: extract canonical surface parameters from the MaterialX
// example .mtlx files referenced by the control scenes (T033) and emit a
// deterministic JSON fixture the .ts tests import without touching node:fs.
// Only scenes declaring BOTH raster and pathtracing backends are extracted, so
// the cross-backend comparison (T035c4) has shared material inputs. Per-family
// input names are mapped to one canonical model (baseColor / metalness /
// roughness / transmission / subsurface / ior / specular); missing inputs fall
// back to that family's MaterialX defaults.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SCENES = resolve(here, '../tests/fixtures/control-scenes.json');
const OUT = resolve(here, '../tests/fixtures/scene-materials.json');
const EXAMPLES_DIR =
  process.env.MATERIALX_EXAMPLES ??
  'D:\\WebGL2\\MaterialX\\MaterialX-rva\\resources\\Materials\\Examples';

const NODE_TAGS = ['standard_surface', 'open_pbr_surface', 'disney_principled', 'gltf_pbr', 'UsdPreviewSurface'];

function round6(x) {
  return Number.parseFloat(Number(x).toFixed(6));
}

/** Pull the surface-shader element block out of the raw .mtlx text. */
function shaderBlock(text) {
  for (const tag of NODE_TAGS) {
    const re = new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'm');
    const m = re.exec(text);
    if (m) return { tag, block: m[0] };
  }
  throw new Error('no known surface shader node found');
}

/** Parse <input name=.. type=.. value=.. /> entries into a name -> value map. */
function parseInputs(block) {
  const inputs = {};
  const re = /<input\s+name="([^"]+)"\s+type="([^"]+)"\s+value="([^"]*)"/g;
  let m;
  while ((m = re.exec(block)) !== null) {
    const [, name, type, value] = m;
    if (type === 'color3' || type === 'vector3') {
      inputs[name] = value.split(',').map((v) => Number.parseFloat(v.trim()));
    } else if (type === 'float' || type === 'integer') {
      inputs[name] = Number.parseFloat(value);
    } else if (type === 'boolean') {
      inputs[name] = value.trim() === 'true';
    }
  }
  return inputs;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const col = (v, d) => (Array.isArray(v) && v.length === 3 ? v : d);
const scaleCol = (c, s) => [c[0] * s, c[1] * s, c[2] * s];

/** Map a family's raw inputs onto the shared canonical surface parameters. */
function toCanonical(tag, inputs) {
  switch (tag) {
    case 'standard_surface': {
      const base = num(inputs.base, 1);
      return {
        baseColor: scaleCol(col(inputs.base_color, [0.8, 0.8, 0.8]), base),
        metalness: num(inputs.metalness, 0),
        roughness: num(inputs.specular_roughness, 0.2),
        transmission: num(inputs.transmission, 0),
        subsurface: num(inputs.subsurface, 0),
        ior: num(inputs.specular_IOR, 1.5),
        specular: num(inputs.specular, 1),
      };
    }
    case 'open_pbr_surface': {
      const baseWeight = num(inputs.base_weight, 1);
      return {
        baseColor: scaleCol(col(inputs.base_color, [0.8, 0.8, 0.8]), baseWeight),
        metalness: num(inputs.base_metalness, 0),
        roughness: num(inputs.specular_roughness, 0.3),
        transmission: num(inputs.transmission_weight, 0),
        subsurface: num(inputs.subsurface_weight, 0),
        ior: num(inputs.specular_ior, 1.5),
        specular: num(inputs.specular_weight, 1),
      };
    }
    case 'disney_principled':
      return {
        baseColor: col(inputs.baseColor, [0.8, 0.8, 0.8]),
        metalness: num(inputs.metallic, 0),
        roughness: num(inputs.roughness, 0.5),
        transmission: num(inputs.specTrans, 0),
        subsurface: num(inputs.subsurface, 0),
        ior: num(inputs.ior, 1.5),
        specular: 1,
      };
    case 'gltf_pbr':
      return {
        baseColor: col(inputs.base_color, [1, 1, 1]),
        metalness: num(inputs.metallic, 1),
        roughness: num(inputs.roughness, 1),
        transmission: num(inputs.transmission, 0),
        subsurface: 0,
        ior: num(inputs.ior, 1.5),
        specular: num(inputs.specular, 1),
      };
    case 'UsdPreviewSurface':
      return {
        baseColor: col(inputs.diffuseColor, [0.18, 0.18, 0.18]),
        metalness: num(inputs.metallic, 0),
        roughness: num(inputs.roughness, 0.5),
        transmission: 0,
        subsurface: 0,
        ior: num(inputs.ior, 1.5),
        specular: 1,
      };
    default:
      throw new Error(`unmapped family node ${tag}`);
  }
}

const scenesDoc = JSON.parse(readFileSync(SCENES, 'utf8'));
const out = { source: 'MaterialX-rva/resources/Materials/Examples', scenes: {} };

for (const scene of scenesDoc.scenes) {
  if (!(scene.backends.includes('raster') && scene.backends.includes('pathtracing'))) continue;
  const path = resolve(EXAMPLES_DIR, scene.material.replace(/\//g, '\\'));
  const text = readFileSync(path, 'utf8');
  const { tag, block } = shaderBlock(text);
  const canon = toCanonical(tag, parseInputs(block));
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
  };
}

writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(`[materials] extracted ${Object.keys(out.scenes).length} scenes -> ${OUT}`);
