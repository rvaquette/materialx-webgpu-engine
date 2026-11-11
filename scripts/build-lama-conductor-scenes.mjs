import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const CONDUCTOR_CASES = [
  { id: 'tint', label: 'Conductor Tint', controls: { tint: '0.5, 0.8, 1' } },
  { id: 'fresnel_artistic', label: 'Fresnel Mode - Artistic', controls: { fresnelMode: '0' } },
  { id: 'fresnel_scientific', label: 'Fresnel Mode - Scientific', controls: { fresnelMode: '1' } },
  { id: 'reflectivity', label: 'Reflectivity', controls: { fresnelMode: '0', reflectivity: '0.8, 0.3, 0.1' } },
  { id: 'edge_color', label: 'Edge Color', controls: { fresnelMode: '0', edgeColor: '0.1, 0.8, 0.95' } },
  { id: 'ior', label: 'IOR (Eta)', controls: { IOR: '0.9, 0.5, 0.2' } },
  { id: 'extinction', label: 'Extinction (Kappa)', controls: { extinction: '1.5, 2.5, 4' } },
  { id: 'roughness', label: 'Roughness', controls: { roughness: '0.65' } },
  { id: 'normal_bump', label: 'Normal / Bump', controls: {}, normal: true },
  { id: 'tail_mix', label: 'Tail Mix (engine equivalent)', controls: { tailMix: '0.65', tailLength: '0.65' }, equivalent: true },
  { id: 'tail_length', label: 'Tail Length (engine equivalent)', controls: { tailMix: '0.5', tailLength: '0.9' }, equivalent: true },
  { id: 'anisotropy', label: 'Anisotropy', controls: { anisotropy: '0.8', roughness: '0.4' } },
  { id: 'anisotropy_negative', label: 'Anisotropy - Negative', controls: { anisotropy: '-0.8', roughness: '0.4' } },
  { id: 'direction', label: 'Direction', controls: { anisotropy: '0.8', anisotropyDirection: '0, 0, 1', roughness: '0.4' } },
  { id: 'rotation', label: 'Rotation', controls: { anisotropy: '0.8', anisotropyRotation: '-0.125', roughness: '0.4' } },
  { id: 'exterior_ior', label: 'Exterior IOR', controls: { exteriorIOR: '1.5' } },
  { id: 'energy_compensation', label: 'Energy Compensation (engine equivalent)', controls: { energyCompensation: '1', roughness: '0.8' }, equivalent: true },
  { id: 'surface_mollification', label: 'Surface Mollification - NOT SUPPORTED', controls: { surfaceMollification: '1' }, blocked: 'Per-hit curvature/normal-variance data is not supplied to material graphs.' },
  { id: 'motion_mollification', label: 'Motion Mollification - NOT SUPPORTED', controls: { motionMollification: '1' }, blocked: 'The renderer has no shutter interval or time-dependent geometry/velocity inputs.' },
  { id: 'lobe_name', label: 'Lobe Name - NOT SUPPORTED', controls: { lobeName: 'metal_reflection' }, blocked: 'Named LPE/AOV routing and output buffers are not implemented.' },
  { id: 'matte', label: 'Matte - NOT SUPPORTED', controls: { matte: 'metal_weight' }, blocked: 'Per-lobe weight AOV output buffers and export are not implemented.' },
];

const DEFAULTS = {
  fresnelMode: '1', tint: '1, 1, 1', reflectivity: '0.945, 0.7772, 0.3737', edgeColor: '0.7137, 0.7373, 0.455',
  IOR: '0.18, 0.42, 1.37', extinction: '3.42, 2.35, 1.77', roughness: '0.24', anisotropy: '0',
  anisotropyRotation: '0', exteriorIOR: '1', energyCompensation: '0', tailMix: '0', tailLength: '0.5',
};
const COLORS = new Set(['tint', 'reflectivity', 'edgeColor']);
const VECTORS = new Set(['IOR', 'extinction', 'anisotropyDirection']);
const STRINGS = new Set(['lobeName', 'matte']);
const RANGES = { anisotropy: [-0.98, 0.98], anisotropyRotation: [-1, 1], exteriorIOR: [0.1, 3], tailLength: [-1, 1] };

function inputXml(name, value) {
  const type = STRINGS.has(name) ? 'string' : name === 'fresnelMode' ? 'integer'
    : COLORS.has(name) ? 'color3' : VECTORS.has(name) ? 'vector3' : 'float';
  const range = RANGES[name] ?? [0, 1];
  const editable = type === 'float' || type === 'integer'
    ? ` uimin="${range[0]}" uimax="${range[1]}" engine:editable="true"` : '';
  return `    <input name="${name}" type="${type}" value="${value}"${editable} />`;
}

export async function buildConductorScenes(root = new URL('../', import.meta.url)) {
  const directory = new URL('scenes/lama/conductor/', root);
  await mkdir(directory, { recursive: true });
  const template = await readFile(new URL('scenes/lama/layer/lama_layer_gold_rough_coating.usda', root), 'utf8');
  const nodes = [];
  for (const example of CONDUCTOR_CASES) {
    const controls = { ...DEFAULTS, ...example.controls };
    const material = `conductor_${example.id}`;
    nodes.push(`  <LamaConductor name="${material}_bsdf" type="BSDF">\n${Object.entries(controls).map(([name, value]) => inputXml(name, value)).join('\n')}${example.normal ? '\n    <input name="normal" type="vector3" nodename="scratched_normal" />' : ''}\n  </LamaConductor>\n  <LamaSurface name="${material}" type="material">\n    <input name="materialFront" type="BSDF" nodename="${material}_bsdf" />\n    <input name="materialBack" type="BSDF" nodename="${material}_bsdf" />\n    <input name="presence" type="float" value="1" />\n  </LamaSurface>`);
    const stage = template
      .replace('Rough gold base with dielectric top, LamaLayer Rough Coating', `${example.label}${example.blocked ? `: ${example.blocked}` : ''}`)
      .replaceAll('@./lama_layer_gold_modes.mtlx@', '@../layer/lama_layer_gold_modes.mtlx@')
      .replace(/        def Material "stand"[^\n]*\n/, '')
      .replace(/        def Material "layeredGold"[^\n]*/, `        def Material "${material}" (prepend references = @./materials.mtlx@</MaterialX/Materials/${material}>) {}`)
      .replaceAll('/World/Looks/layeredGold', `/World/Looks/${material}`)
      .replaceAll('/World/Looks/stand', `/World/Looks/${material}`)
      .replaceAll('@../../renderman/', '@../../pathtracer/renderman/')
      .replaceAll('@../../HDR/', '@../../pathtracer/HDR/');
    await writeFile(new URL(`${material}.usda`, directory), stage);
  }
  const normal = `  <position name="position" type="vector3" />
  <multiply name="scratch_scale" type="vector3">
    <input name="in1" type="vector3" nodename="position" />
    <input name="in2" type="vector3" value="2000, 80, 80" />
  </multiply>
  <noise3d name="scratches" type="vector3">
    <input name="position" type="vector3" nodename="scratch_scale" />
    <input name="amplitude" type="vector3" value="0.2, 0.2, 0" />
    <input name="pivot" type="float" value="0.5" />
  </noise3d>
  <add name="normal_signal" type="vector3">
    <input name="in1" type="vector3" nodename="scratches" />
    <input name="in2" type="vector3" value="0, 0, 0.5" />
  </add>
  <normalmap name="scratched_normal" type="vector3">
    <input name="in" type="vector3" nodename="normal_signal" />
    <input name="scale" type="float" value="0.3" />
  </normalmap>`;
  await writeFile(new URL('materials.mtlx', directory), `<?xml version="1.0"?>\n<materialx version="1.39" colorspace="lin_rec709" xmlns:engine="urn:materialx-webgpu-engine:extensions">\n${normal}\n${nodes.join('\n')}\n</materialx>\n`);
  await writeFile(new URL('coverage.json', directory), `${JSON.stringify(CONDUCTOR_CASES.map(example => ({
    parameter: example.id, scene: `conductor_${example.id}.usda`, label: example.label,
    status: example.blocked ? 'unsupported' : example.equivalent ? 'engine-equivalent' : 'implemented',
    ...(example.blocked ? { reason: example.blocked } : {}),
  })), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildConductorScenes();
  console.log(`Generated ${CONDUCTOR_CASES.length} LamaConductor scenes (${CONDUCTOR_CASES.filter(example => example.blocked).length} explicitly unsupported).`);
}