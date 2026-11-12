import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scientific = { fresnelMode: '1' };
const interior = { absorptionColor: '0.4, 0.4, 0.4', absorptionRadius: '0.05' };

export const GENERALIZED_SCHLICK_CASES = [
  { id: 'clear', label: 'Clear Schlick Glass', controls: {} },
  { id: 'reflection_tint', label: 'Reflection Tint', controls: { reflectionTint: '0.2, 0.6, 1' } },
  { id: 'transmission_tint', label: 'Transmission Tint', controls: { transmissionTint: '0.2, 0.6, 1' } },
  { id: 'fresnel_artistic', label: 'Fresnel Mode - Artistic', controls: { fresnelMode: '0' } },
  { id: 'fresnel_scientific', label: 'Fresnel Mode - Scientific', controls: scientific },
  { id: 'reflectivity', label: 'Reflectivity', controls: { reflectivity: '0.15, 0.15, 0.15' } },
  { id: 'reflectivity_color', label: 'Reflectivity - Colored (engine equivalent)', controls: { reflectivity: '0.3, 0.12, 0.03' }, equivalent: true },
  { id: 'reflectivity90', label: 'Reflectivity 90 (engine equivalent)', controls: { reflectivity90: '0.2, 0.5, 1' }, equivalent: true },
  { id: 'reflectivity_profile', label: 'Reflectivity Profile (engine equivalent)', controls: { reflectivityProfile: '0.6' }, equivalent: true },
  { id: 'ior', label: 'IOR', controls: { ...scientific, IOR: '2, 2, 2' } },
  { id: 'ior_rgb', label: 'IOR - Per Channel (engine equivalent)', controls: { ...scientific, IOR: '1.4, 1.6, 1.9' }, equivalent: true },
  { id: 'roughness', label: 'Roughness', controls: { roughness: '0.45' } },
  { id: 'normal_bump', label: 'Normal / Bump', controls: {}, normal: true },
  { id: 'tail_mix', label: 'Tail Mix (engine equivalent)', controls: { tailMix: '0.6', tailLength: '0.7' }, equivalent: true },
  { id: 'tail_length', label: 'Tail Length (engine equivalent)', controls: { tailMix: '0.5', tailLength: '0.9' }, equivalent: true },
  { id: 'anisotropy', label: 'Anisotropy - Co-tangent Roughness', controls: { roughness: '0.1', anisotropy: '0.5' } },
  { id: 'anisotropy_isotropic', label: 'Anisotropy - Negative (isotropic)', controls: { roughness: '0.3', anisotropy: '-1' } },
  { id: 'anisotropy_direction', label: 'Anisotropy Direction', controls: { roughness: '0.1', anisotropy: '0.5', anisotropyDirection: '0, 0, 1' } },
  { id: 'anisotropy_rotation', label: 'Anisotropy Rotation', controls: { roughness: '0.1', anisotropy: '0.5', anisotropyRotation: '0.125' } },
  { id: 'absorption_color', label: 'Absorption Color', controls: { absorptionColor: '0.85, 0.35, 0.08', absorptionRadius: '0.08' } },
  { id: 'absorption_radius', label: 'Absorption Radius', controls: { absorptionColor: '0.12, 0.5, 0.85', absorptionRadius: '0.02' } },
  { id: 'scatter_color', label: 'Scatter Color', controls: { ...interior, scatterColor: '0.8, 0.6, 0.3' } },
  { id: 'scatter_anisotropy', label: 'Scatter Anisotropy', controls: { ...interior, scatterColor: '0.8, 0.8, 0.8', scatterAnisotropy: '-0.4' } },
  { id: 'exterior_ior', label: 'Exterior IOR', controls: { ...scientific, exteriorIOR: '1.33' } },
  ...[
    ['energy_compensation', 'Energy Compensation', 'energyCompensation', '1', 'No generalized-Schlick multiple-scattering compensation is implemented.'],
    ['shadow_density', 'Shadow Density', 'shadowDensity', '0.3', 'Artistic transmission-shadow overrides are not implemented.'],
    ['shadow_coloring', 'Shadow Coloring', 'shadowColoring', '0.5', 'Colored transmission-shadow overrides are not implemented.'],
    ['shadow_fresnel_front', 'Shadow Fresnel Front', 'shadowFresnelFront', '0', 'Front-face shadow Fresnel overrides are not implemented.'],
    ['shadow_fresnel_back', 'Shadow Fresnel Back', 'shadowFresnelBack', '0', 'Back-face shadow Fresnel overrides are not implemented.'],
    ['surface_mollification', 'Surface Mollification', 'surfaceMollification', '1', 'Per-hit curvature/normal-variance data is not supplied.'],
    ['motion_mollification', 'Motion Mollification', 'motionMollification', '1', 'No time-dependent geometry or shutter data is supplied.'],
    ['lobe_name', 'Lobe Name', 'lobeName', 'schlick_reflection', 'Named LPE/AOV routing is not implemented.'],
    ['interior_id', 'Interior Id', 'interiorId', '2', 'Nested medium tracking by named interior ID is not implemented.'],
    ['matte', 'Matte', 'matte', 'schlick_weight', 'Per-lobe final-weight AOV accumulation is not implemented.'],
  ].map(([id, label, parameter, value, blocked]) => ({ id, label: `${label} - NOT SUPPORTED`, controls: { [parameter]: value }, blocked })),
];

const defaults = { reflectionTint: '1, 1, 1', transmissionTint: '1, 1, 1', fresnelMode: '0', IOR: '1.5, 1.5, 1.5',
  reflectivity: '0.04, 0.04, 0.04', reflectivity90: '1, 1, 1', reflectivityProfile: '0.2', roughness: '0.08',
  anisotropy: '-1', anisotropyRotation: '0', absorptionColor: '1, 1, 1', absorptionRadius: '0.08',
  scatterColor: '0, 0, 0', scatterAnisotropy: '0', exteriorIOR: '1' };
const colors = new Set(['reflectionTint', 'transmissionTint', 'reflectivity', 'reflectivity90', 'absorptionColor', 'scatterColor']);
const vectors = new Set(['IOR', 'anisotropyDirection']);
const strings = new Set(['lobeName', 'matte']);
const integers = new Set(['fresnelMode', 'interiorId']);
const ranges = { reflectivityProfile: [0.01, 1], roughness: [0, 1], absorptionRadius: [0.001, 1],
  anisotropy: [-1, 1], scatterAnisotropy: [-0.99, 0.99], anisotropyRotation: [-1, 1], exteriorIOR: [0.1, 3] };

export async function buildGeneralizedSchlickScenes(root = new URL('../', import.meta.url)) {
  const directory = new URL('scenes/lama/generalized_schlick/', root);
  await mkdir(directory, { recursive: true });
  const template = await readFile(new URL('scenes/lama/layer/lama_layer_gold_rough_coating.usda', root), 'utf8');
  const nodes = [];
  for (const example of GENERALIZED_SCHLICK_CASES) {
    const material = `generalized_schlick_${example.id}`;
    const inputs = Object.entries({ ...defaults, ...example.controls }).map(([name, value]) => {
      const type = colors.has(name) ? 'color3' : vectors.has(name) ? 'vector3' : strings.has(name) ? 'string' : integers.has(name) ? 'integer' : 'float';
      const [minimum, maximum] = ranges[name] ?? [0, 1];
      const editable = type === 'float' || type === 'integer' ? ` uimin="${minimum}" uimax="${maximum}" engine:editable="true"` : '';
      return `    <input name="${name}" type="${type}" value="${value}"${editable} />`;
    });
    if (example.normal) inputs.push('    <input name="normal" type="vector3" nodename="surface_normal" />');
    nodes.push(`  <LamaGeneralizedSchlick name="${material}_bsdf" type="BSDF">\n${inputs.join('\n')}\n  </LamaGeneralizedSchlick>\n  <LamaSurface name="${material}" type="material">\n    <input name="materialFront" type="BSDF" nodename="${material}_bsdf" />\n    <input name="materialBack" type="BSDF" nodename="${material}_bsdf" />\n    <input name="presence" type="float" value="1" />\n  </LamaSurface>`);
    const stage = template
      .replace('Rough gold base with dielectric top, LamaLayer Rough Coating', `LamaGeneralizedSchlick ${example.label}${example.blocked ? `: ${example.blocked}` : ''}`)
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
  await writeFile(new URL('coverage.json', directory), `${JSON.stringify(GENERALIZED_SCHLICK_CASES.map(example => ({
    parameter: example.id, scene: `generalized_schlick_${example.id}.usda`, label: example.label,
    status: example.blocked ? 'unsupported' : example.equivalent ? 'engine-equivalent' : 'implemented',
    ...(example.blocked ? { reason: example.blocked } : {}),
  })), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildGeneralizedSchlickScenes();
  console.log(`Generated ${GENERALIZED_SCHLICK_CASES.length} LamaGeneralizedSchlick parameter scenes.`);
}
