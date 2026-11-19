import type { ResolvedGraph } from '../../materialx/graph.ts';
import type { NormalizedSurfaceInput, ResolvedSurface } from '../../materialx/surface-graph.ts';
import { editorArithmeticValue, type MaterialParameter } from '../material-parameters.ts';
import { packDisneyMaterials, type DisneyMaterial } from './disney-material.ts';
import { disneyAlbedoTexture, disneyMetallicRoughnessTexture } from './disney-texture-graphs.ts';

type Color = readonly [number, number, number];
type TextureUsage = 'albedo' | 'metallic-roughness';

export interface DisneyStandardConversion {
  material: DisneyMaterial;
  warnings: string[];
}

/**
 * The texture callback must return an array-layer index for raw RGBA8 data.
 * Albedo must not be decoded as sRGB: the Disney shader applies the graph's
 * 2.2 exponent. The WebGL source uses manual nearest-texel lookups.
 */
export function disneyMaterialFromStandard(
  surface: ResolvedSurface,
  graph: ResolvedGraph,
  parameters: readonly MaterialParameter[] = [],
  textureIndex?: (file: string, usage: TextureUsage) => number,
): DisneyStandardConversion {
  if (surface.family !== 'standard_surface') throw new Error(`Unsupported Disney material family: ${surface.family}.`);
  if (graph.nodes.get(surface.nodeId)?.category !== 'standard_surface') throw new Error('Standard surface does not belong to the supplied graph.');
  if (surface.backNodeId || graph.lamaSurface || graph.terminals.some(t =>
    (t.name === 'volumeshader' || t.name === 'displacementshader') && t.nodeId)) {
    throw new Error('Disney standard material does not support back, volume, or displacement terminals.');
  }
  const editorValues = new Map<string, readonly number[]>();
  for (const parameter of parameters) {
    if (!parameter.nodeId) continue;
    const value = parameter.constantFor !== undefined ? parameter.value : editorArithmeticValue(parameter, parameters);
    if (value) editorValues.set(parameter.nodeId, value);
  }
  if (editorValues.size) {
    const inputs = new Map(surface.inputs);
    for (const [name, input] of inputs) {
      if (input.source.kind !== 'connection') continue;
      const value = editorValues.get(input.source.nodeId);
      if (value) inputs.set(name, { ...input, source: { kind: 'value', value } });
    }
    surface = { ...surface, inputs };
  }
  const field = (name: string): NormalizedSurfaceInput => {
    const item = surface.inputs.get(name);
    if (!item) throw new Error(`Missing standard_surface input ${name}.`);
    return item;
  };
  const read = (name: string, count: number): readonly number[] => {
    const item = field(name);
    if (item.source.kind !== 'value' && item.source.kind !== 'default') {
      throw new Error(`Unsupported connected standard_surface input ${name}.`);
    }
    const parameter = parameters.find(p => !p.nodeId && !p.linkedSource && p.input === name);
    if (item.parameter && !parameter) throw new Error(`Missing editable standard_surface parameter ${name}.`);
    const values = parameter?.value ?? item.source.value;
    if (values.length !== count || values.some(value => !Number.isFinite(value))) {
      throw new Error(`Invalid standard_surface input ${name}.`);
    }
    return values;
  };
  const number = (name: string) => read(name, 1)[0]!;
  const color = (name: string): Color => {
    const values = read(name, 3);
    return [values[0]!, values[1]!, values[2]!];
  };
  const unit = (name: string): number => {
    const value = number(name);
    if (value < 0 || value > 1) throw new Error(`Invalid standard_surface input ${name}: expected 0 to 1.`);
    return value;
  };
  const geom = (name: string, expected: string) => {
    const item = field(name);
    if (item.parameter || item.source.kind !== 'geomprop' || item.source.name !== expected) {
      throw new Error(`Unsupported standard_surface ${name}.`);
    }
  };
  const warnings = ['MaterialX standard_surface is approximated by the Disney BRDF.'];
  const weight = unit('base');
  const baseInput = field('base_color');
  let baseColor: Color;
  let albedoFile: string | undefined;
  if (baseInput.source.kind === 'connection') {
    if (baseInput.parameter) throw new Error('Unsupported editable base_color connection.');
    const albedo = disneyAlbedoTexture(graph, baseInput.source);
    albedoFile = albedo.file;
    baseColor = albedo.factor;
  } else {
    baseColor = color('base_color');
  }
  baseColor = [baseColor[0] * weight, baseColor[1] * weight, baseColor[2] * weight];
  if (weight !== 1) warnings.push('base weight is folded into base_color, including the metallic and transmission lobes.');

  const metallicInput = field('metalness');
  const roughnessInput = field('specular_roughness');
  const diffuseInput = field('diffuse_roughness');
  let metallic: number;
  let roughness: number;
  let metalRoughFile: string | undefined;
  if (metallicInput.source.kind === 'connection' || roughnessInput.source.kind === 'connection' || diffuseInput.source.kind === 'connection') {
    metalRoughFile = disneyMetallicRoughnessTexture(graph, surface);
    metallic = 0;
    roughness = 0;
  } else {
    metallic = unit('metalness');
    const perceptual = unit('specular_roughness');
    roughness = perceptual * perceptual;
    if (Math.abs(unit('diffuse_roughness') - roughness) > 1e-6) {
      warnings.push('Independent diffuse roughness is replaced by the squared specular roughness.');
    }
  }

  geom('normal', 'Nworld');
  geom('tangent', 'Tworld');
  if (number('thin_walled') !== 0 || number('thin_film_thickness') !== 0) {
    throw new Error('Disney standard material does not support thin-walled surfaces or thin film.');
  }
  const transmission = unit('transmission');
  if (transmission > 0) {
    if (number('transmission_depth') !== 0 || color('transmission_scatter').some(v => v !== 0) ||
        number('transmission_dispersion') !== 0 || number('transmission_extra_roughness') !== 0) {
      throw new Error('Disney standard material does not support this transmission medium.');
    }
    color('transmission_color');
    warnings.push('Transmission color is approximated using the Disney base color.');
  }
  const subsurface = unit('subsurface');
  if (subsurface > 0) {
    const input = field('subsurface_color');
    if (input.source.kind === 'connection') {
      if (baseInput.source.kind !== 'connection' || input.source.nodeId !== baseInput.source.nodeId ||
          input.source.output !== baseInput.source.output) throw new Error('Unsupported connected subsurface_color.');
    } else color('subsurface_color');
    warnings.push('Subsurface is approximated by the Disney surface model; color, radius, scale and anisotropy are not preserved.');
    color('subsurface_radius');
    number('subsurface_scale');
    number('subsurface_anisotropy');
  }
  const specular = unit('specular');
  const specularColor = color('specular_color');
  if (specular !== 1 || specularColor.some(v => v !== 1)) warnings.push('Specular weight and color are approximated by the Disney IOR.');
  if (number('specular_rotation') !== 0) warnings.push('Specular anisotropy rotation is not represented.');
  const sheen = unit('sheen');
  if (sheen > 0) {
    color('sheen_color');
    number('sheen_roughness');
    warnings.push('Sheen color and roughness are approximated by the Disney sheen model.');
  }
  const coat = unit('coat');
  let coatGloss = 0;
  if (coat > 0) {
    geom('coat_normal', 'Nworld');
    color('coat_color');
    const coatRoughness = unit('coat_roughness');
    const gloss = (0.1 - coatRoughness * coatRoughness) / 0.099;
    coatGloss = Math.max(0, Math.min(1, gloss));
    if (gloss < -1e-6 || gloss > 1 + 1e-6) warnings.push('Coat roughness is clamped to the Disney clearcoat range.');
    number('coat_anisotropy');
    number('coat_rotation');
    number('coat_IOR');
    number('coat_affect_color');
    number('coat_affect_roughness');
    warnings.push('Coat color, IOR, anisotropy and effects are approximated by the Disney clearcoat model.');
  }
  const emissionWeight = number('emission');
  if (emissionWeight < 0) throw new Error('Invalid standard_surface emission.');
  const emissionColor = color('emission_color');
  const opacity = color('opacity');
  if (opacity.some(value => value < 0 || value > 1)) throw new Error('Invalid standard_surface opacity.');
  const alpha = (opacity[0] + opacity[1] + opacity[2]) / 3;
  if (opacity.some(value => value !== opacity[0])) warnings.push('Colored opacity is approximated by its mean.');
  if (alpha < 1 && albedoFile) throw new Error('Disney albedo texture alpha would alter standard_surface opacity.');
  if (albedoFile || metalRoughFile) warnings.push('Disney uses nearest-texel sampling with periodic addressing rather than MaterialX linear filtering.');
  const material: DisneyMaterial = {
    baseColor, anisotropic: unit('specular_anisotropy'),
    emission: [emissionWeight * emissionColor[0], emissionWeight * emissionColor[1], emissionWeight * emissionColor[2]],
    metallic, roughness, subsurface, specularTint: 0, sheen, sheenTint: 0,
    clearcoat: coat, clearcoatGloss: coatGloss, specTrans: transmission, ior: number('specular_IOR'),
    mediumType: 0, mediumDensity: 0, mediumColor: [1, 1, 1], mediumAnisotropy: 0,
    textures: [-1, -1, -1, -1], opacity: alpha, alphaMode: alpha < 1 ? 1 : 0, alphaCutoff: 0,
  };
  packDisneyMaterials([material]);
  const index = (file: string | undefined, usage: TextureUsage): number => {
    if (!file) return -1;
    if (!textureIndex) throw new Error(`Missing Disney texture layer for ${file}.`);
    const result = textureIndex(file, usage);
    if (!Number.isInteger(result) || result < 0 || result > 0xffffff) throw new Error(`Invalid Disney texture layer for ${file}.`);
    return result;
  };
  material.textures = [index(albedoFile, 'albedo'), index(metalRoughFile, 'metallic-roughness'), -1, -1];
  return { material, warnings };
}
