import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIELECTRIC_CASES = [
  { id: 'clear', label: 'Clear Glass', controls: {} },
  { id: 'reflection_tint', label: 'Reflection Tint', controls: { reflectionTint: '0.2, 0.6, 1' } },
  { id: 'transmission_tint', label: 'Transmission Tint', controls: { transmissionTint: '0.2, 0.6, 1' } },
  { id: 'fresnel_artistic', label: 'Fresnel Mode - Artistic', controls: { fresnelMode: '0' } },
  { id: 'fresnel_scientific', label: 'Fresnel Mode - Scientific', controls: { fresnelMode: '1' } },
  { id: 'reflectivity', label: 'Reflectivity', controls: { fresnelMode: '0', reflectivity: '0.12' } },
  { id: 'ior', label: 'IOR', controls: { IOR: '2' } },
  { id: 'roughness', label: 'Roughness', controls: { roughness: '0.45' } },
  { id: 'normal_bump', label: 'Normal / Bump', controls: {}, normal: true },
  { id: 'tail_mix', label: 'Tail Mix (engine equivalent)', controls: { tailMix: '0.6', tailLength: '0.7' }, equivalent: true },
  { id: 'tail_length', label: 'Tail Length (engine equivalent)', controls: { tailMix: '0.5', tailLength: '0.9' }, equivalent: true },
  { id: 'anisotropy', label: 'Anisotropy', controls: { anisotropy: '0.8', roughness: '0.3' } },
  { id: 'anisotropy_negative', label: 'Anisotropy - Negative', controls: { anisotropy: '-0.8', roughness: '0.3' } },
  { id: 'direction', label: 'Direction', controls: { anisotropy: '0.8', direction: '0, 0, 1', roughness: '0.3' } },
  { id: 'rotation', label: 'Rotation', controls: { anisotropy: '0.8', rotation: '-0.125', roughness: '0.3' } },
  { id: 'dispersion_mode', label: 'Dispersion Mode (RGB equivalent)', controls: { dispersionMode: '1', dispersionAbbe: '20' }, equivalent: true },
  { id: 'dispersion_spread', label: 'Dispersion Spread (RGB equivalent)', controls: { dispersionSpread: '3' }, equivalent: true },
  { id: 'dispersion_abbe', label: 'Dispersion Abbe (RGB equivalent)', controls: { dispersionMode: '1', dispersionAbbe: '10' }, equivalent: true },
  { id: 'dispersion_saturation', label: 'Dispersion Saturation (RGB equivalent)', controls: { dispersionSpread: '3', dispersionSaturation: '0.4' }, equivalent: true },
  { id: 'absorption_color', label: 'Absorption Color', controls: { absorptionColor: '0.85, 0.35, 0.08', absorptionRadius: '0.08' } },
  { id: 'absorption_radius', label: 'Absorption Radius', controls: { absorptionColor: '0.12, 0.5, 0.85', absorptionRadius: '0.02' } },
  { id: 'scatter_color', label: 'Scatter Color', controls: { absorptionColor: '0.4, 0.4, 0.4', absorptionRadius: '0.05', scatterColor: '0.8, 0.6, 0.3' } },
  { id: 'scatter_anisotropy', label: 'Scatter Anisotropy', controls: { absorptionColor: '0.4, 0.4, 0.4', absorptionRadius: '0.05', scatterColor: '0.8, 0.8, 0.8', scatterAnisotropy: '-0.4' } },
  { id: 'exterior_ior', label: 'Exterior IOR', controls: { exteriorIOR: '1.33' } },
  ...[
    ['energy_compensation', 'Energy Compensation', 'energyCompensation', '1', 'No dielectric multiple-scattering compensation is implemented.'],
    ['shadow_density', 'Shadow Density', 'shadowDensity', '0.3', 'Artistic transmission-shadow overrides are not implemented.'],
    ['shadow_coloring', 'Shadow Coloring', 'shadowColoring', '0.5', 'Colored transmission-shadow overrides are not implemented.'],
    ['shadow_fresnel_front', 'Shadow Fresnel Front', 'shadowFresnelFront', '0', 'Front-face shadow Fresnel overrides are not implemented.'],
    ['shadow_fresnel_back', 'Shadow Fresnel Back', 'shadowFresnelBack', '0', 'Back-face shadow Fresnel overrides are not implemented.'],
    ['surface_mollification', 'Surface Mollification', 'surfaceMollification', '1', 'Per-hit curvature/normal-variance data is not supplied.'],
    ['motion_mollification', 'Motion Mollification', 'motionMollification', '1', 'No time-dependent geometry or shutter data is supplied.'],
    ['lobe_name', 'Lobe Name', 'lobeName', 'glass_reflection', 'Named LPE/AOV routing is not implemented.'],
    ['interior_id', 'Interior Id', 'interiorId', '2', 'Nested medium tracking by named interior ID is not implemented.'],
    ['matte', 'Matte', 'matte', 'glass_weight', 'Per-lobe final-weight AOV accumulation is not implemented.'],
  ].map(([id, label, parameter, value, blocked]) => ({ id, label: `${label} - NOT SUPPORTED`, controls: { [parameter]: value }, blocked })),
];

const defaults = { reflectionTint: '1, 1, 1', transmissionTint: '1, 1, 1', fresnelMode: '1', IOR: '1.5',
  reflectivity: '0.04', roughness: '0.08', absorptionColor: '1, 1, 1', absorptionRadius: '0.08',
  scatterColor: '0, 0, 0', scatterAnisotropy: '0', anisotropy: '0', rotation: '0', exteriorIOR: '1' };
const colors = new Set(['reflectionTint', 'transmissionTint', 'absorptionColor', 'scatterColor']);
const strings = new Set(['lobeName', 'matte']);
const integers = new Set(['fresnelMode', 'dispersionMode', 'interiorId']);
const ranges = { IOR: [1, 3], reflectivity: [0, 0.99], roughness: [0, 1], absorptionRadius: [0.001, 1],
  anisotropy: [-0.98, 0.98], scatterAnisotropy: [-0.99, 0.99], rotation: [-1, 1], exteriorIOR: [0.1, 3],
  dispersionAbbe: [1, 100], dispersionSpread: [0, 10] };

export async function buildDielectricScenes(root = new URL('../', import.meta.url)) {
  const directory = new URL('scenes/lama/dielectric/', root);
  await mkdir(directory, { recursive: true });
  const template = await readFile(new URL('scenes/lama/layer/lama_layer_gold_rough_coating.usda', root), 'utf8');
  const nodes = [];
  for (const example of DIELECTRIC_CASES) {
    const material = `dielectric_${example.id}`;
    const inputs = Object.entries({ ...defaults, ...example.controls }).map(([name, value]) => {
      const type = colors.has(name) ? 'color3' : strings.has(name) ? 'string' : integers.has(name) ? 'integer' : name === 'direction' ? 'vector3' : 'float';
      const [minimum, maximum] = ranges[name] ?? [0, 1];
      const editable = type === 'float' || type === 'integer' ? ` uimin="${minimum}" uimax="${maximum}" engine:editable="true"` : '';
      return `    <input name="${name}" type="${type}" value="${value}"${editable} />`;
    });
    if (example.normal) inputs.push('    <input name="normal" type="vector3" nodename="surface_normal" />');
    nodes.push(`  <LamaDielectric name="${material}_bsdf" type="BSDF">\n${inputs.join('\n')}\n  </LamaDielectric>\n  <LamaSurface name="${material}" type="material">\n    <input name="materialFront" type="BSDF" nodename="${material}_bsdf" />\n    <input name="materialBack" type="BSDF" nodename="${material}_bsdf" />\n    <input name="presence" type="float" value="1" />\n  </LamaSurface>`);
    const stage = template
      .replace('Rough gold base with dielectric top, LamaLayer Rough Coating', `${example.label}${example.blocked ? `: ${example.blocked}` : ''}`)
      .replace('pathtracer:environmentIntensity = 0.06', 'pathtracer:environmentIntensity = 0.3')
      .replace('inputs:intensity = 0.06', 'inputs:intensity = 0.3')
      .replaceAll('@./lama_layer_gold_modes.mtlx@', '@./materials.mtlx@')
      .replace(/        def Material "stand"[^\n]*\n/, '')
      .replace(/        def Material "layeredGold"[^\n]*/, `        def Material "${material}" (prepend references = @./materials.mtlx@</MaterialX/Materials/${material}>) {}`)
      .replaceAll('/World/Looks/layeredGold', `/World/Looks/${material}`)
      .replaceAll('/World/Looks/stand', `/World/Looks/${material}`)
      .replaceAll('@../../renderman/', '@../../pathtracer/renderman/')
      .replaceAll('@../../HDR/', '@../../pathtracer/HDR/');
    await writeFile(new URL(`${material}.usda`, directory), stage);
  }
  const supporting = `  <standard_surface name="ground_surface" type="surfaceshader">
    <input name="base_color" type="color3" value="0.22, 0.23, 0.24" />
    <input name="specular_roughness" type="float" value="0.8" />
  </standard_surface>
  <surfacematerial name="ground" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="ground_surface" />
  </surfacematerial>
  <position name="position" type="vector3" />
  <multiply name="noise_scale" type="vector3">
    <input name="in1" type="vector3" nodename="position" />
    <input name="in2" type="vector3" value="600, 80, 80" />
  </multiply>
  <noise3d name="noise" type="vector3">
    <input name="position" type="vector3" nodename="noise_scale" />
    <input name="amplitude" type="vector3" value="0.2, 0.2, 0" />
    <input name="pivot" type="float" value="0.5" />
  </noise3d>
  <add name="normal_signal" type="vector3">
    <input name="in1" type="vector3" nodename="noise" />
    <input name="in2" type="vector3" value="0, 0, 0.5" />
  </add>
  <normalmap name="surface_normal" type="vector3">
    <input name="in" type="vector3" nodename="normal_signal" />
    <input name="scale" type="float" value="0.3" />
  </normalmap>`;
  await writeFile(new URL('materials.mtlx', directory), `<?xml version="1.0"?>\n<materialx version="1.39" colorspace="lin_rec709" xmlns:engine="urn:materialx-webgpu-engine:extensions">\n${supporting}\n${nodes.join('\n')}\n</materialx>\n`);
  await writeFile(new URL('coverage.json', directory), `${JSON.stringify(DIELECTRIC_CASES.map(example => ({
    parameter: example.id, scene: `dielectric_${example.id}.usda`, label: example.label,
    status: example.blocked ? 'unsupported' : example.equivalent ? 'engine-equivalent' : 'implemented',
    ...(example.blocked ? { reason: example.blocked } : {}),
  })), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildDielectricScenes();
  console.log(`Generated ${DIELECTRIC_CASES.length} LamaDielectric parameter scenes.`);
}