import { MeshStandardMaterial, MeshPhysicalMaterial, RepeatWrapping, MirroredRepeatWrapping, NearestFilter, type Material, type Texture } from 'three';

export type TextureExporter = (texture: Texture, channel?: number) => Promise<string>;
const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** glTF inputs mapped to the matching MaterialX gltf_pbr surface family. */
export async function gltfMaterialToMaterialX(
  material: Material,
  name: string,
  exportTexture: TextureExporter,
  warn: (message: string) => void,
): Promise<string> {
  if (!(material instanceof MeshStandardMaterial)) {
    throw new Error(`Unsupported glTF material type: ${material.type} (${material.name})`);
  }
  const nodes: string[] = [];
  const inputs: string[] = [];
  const value = (input: string, type: string, numbers: readonly number[]): void => {
    if (!numbers.every(Number.isFinite)) throw new Error(`Invalid glTF material value: ${name}.${input}`);
    inputs.push(`    <input name="${input}" type="${type}" value="${numbers.join(', ')}" />`);
  };
  const textureInput = async (input: string, type: 'float' | 'color3' | 'vector3', factor: readonly number[], texture?: Texture | null, channel?: number, connect = true): Promise<string | undefined> => {
    if (!texture) {
      if (connect) value(input, type, factor);
      return undefined;
    }
    if (!factor.every(Number.isFinite)) throw new Error(`Invalid texture factor: ${name}.${input}`);
    if (texture.channel !== 0) warn(`${name}.${input}: UV${texture.channel} approximated by UV0.`);
    if (texture.rotation !== 0) warn(`${name}.${input}: texture rotation is not supported; offset and scale are preserved.`);
    const file = await exportTexture(texture, channel);
    const address = (mode: number): string => mode === RepeatWrapping ? 'periodic' : mode === MirroredRepeatWrapping ? 'mirror' : 'clamp';
    const image = `${input}_image`;
    nodes.push(`  <image name="${image}" type="${type}"${type === 'color3' ? ' colorspace="srgb_texture"' : ''}>
    <input name="file" type="filename" value="${escapeXml(file)}" />
    <input name="uvtiling" type="vector2" value="${texture.repeat.x}, ${texture.repeat.y}" />
    <input name="uvoffset" type="vector2" value="${-texture.offset.x}, ${texture.offset.y + texture.repeat.y - 1}" />
    <input name="uaddressmode" type="string" value="${address(texture.wrapS)}" />
    <input name="vaddressmode" type="string" value="${address(texture.wrapT)}" />
    <input name="filtertype" type="string" value="${texture.magFilter === NearestFilter ? 'closest' : 'linear'}" />
  </image>`);
    const product = `${input}_factor`;
    nodes.push(`  <multiply name="${product}" type="${type}">
    <input name="in1" type="${type}" nodename="${image}" />
    <input name="in2" type="${type}" value="${factor.join(', ')}" />
  </multiply>`);
    if (connect) inputs.push(`    <input name="${input}" type="${type}" nodename="${product}" />`);
    if (texture.minFilter !== texture.magFilter) warn(`${name}.${input}: texture mip filtering is approximated by the engine's single-level sampler.`);
    return product;
  };
  const normalInput = async (input: string, texture: Texture | null, scale: readonly number[]): Promise<void> => {
    if (!texture) return;
    if (!scale.every(Number.isFinite)) throw new Error(`Invalid normal scale: ${name}`);
    const sample = await textureInput(input, 'vector3', [1, 1, 1], texture, undefined, false);
    nodes.push(`  <subtract name="${input}_centered" type="vector3">
    <input name="in1" type="vector3" nodename="${sample}" />
    <input name="in2" type="vector3" value="0.5, 0.5, 0.5" />
  </subtract>
  <multiply name="${input}_scaled" type="vector3">
    <input name="in1" type="vector3" nodename="${input}_centered" />
    <input name="in2" type="vector3" value="${scale[0]}, ${scale[1]}, 1" />
  </multiply>
  <add name="${input}_encoded" type="vector3">
    <input name="in1" type="vector3" nodename="${input}_scaled" />
    <input name="in2" type="vector3" value="0.5, 0.5, 0.5" />
  </add>
  <normalmap name="${input}_mapped" type="vector3">
    <input name="in" type="vector3" nodename="${input}_encoded" />
  </normalmap>`);
    inputs.push(`    <input name="${input}" type="vector3" nodename="${input}_mapped" />`);
  };
  await textureInput('base_color', 'color3', material.color.toArray(), material.map);
  await textureInput('metallic', 'float', [material.metalness], material.metalnessMap, 2);
  await textureInput('roughness', 'float', [material.roughness], material.roughnessMap, 1);
  await normalInput('normal', material.normalMap, material.normalScale.toArray());
  await textureInput('emissive', 'color3', material.emissive.toArray().map(n => n * material.emissiveIntensity), material.emissiveMap);
  const alphaMode = material.alphaTest > 0 ? 1 : material.transparent ? 2 : 0;
  value('alpha_mode', 'integer', [alphaMode]);
  value('alpha_cutoff', 'float', [material.alphaTest > 0 ? material.alphaTest : 0.5]);
  if (alphaMode !== 0) {
    const alpha = await textureInput('alpha', 'float', [material.opacity], material.map, 3, !material.alphaMap);
    if (material.alphaMap) {
      const mask = await textureInput('alpha_mask', 'float', [1], material.alphaMap, 1, false);
      nodes.push(`  <multiply name="alpha_combined" type="float">
    <input name="in1" type="float" ${alpha ? `nodename="${alpha}"` : `value="${material.opacity}"`} />
    <input name="in2" type="float" nodename="${mask}" />
  </multiply>`);
      inputs.push('    <input name="alpha" type="float" nodename="alpha_combined" />');
    }
  } else value('alpha', 'float', [1]);
  if (material instanceof MeshPhysicalMaterial) {
    value('ior', 'float', [material.ior]);
    await textureInput('clearcoat', 'float', [material.clearcoat], material.clearcoatMap, 0);
    await textureInput('clearcoat_roughness', 'float', [material.clearcoatRoughness], material.clearcoatRoughnessMap, 1);
    await textureInput('transmission', 'float', [material.transmission], material.transmissionMap, 0);
    value('anisotropy_strength', 'float', [material.anisotropy]);
    value('anisotropy_rotation', 'float', [material.anisotropyRotation]);
    await textureInput('sheen_color', 'color3', material.sheenColor.toArray().map(n => n * material.sheen), material.sheenColorMap);
    await textureInput('sheen_roughness', 'float', [material.sheenRoughness], material.sheenRoughnessMap, 3);
    await textureInput('specular', 'float', [material.specularIntensity], material.specularIntensityMap, 3);
    await textureInput('specular_color', 'color3', material.specularColor.toArray(), material.specularColorMap);
    await textureInput('iridescence', 'float', [material.iridescence], material.iridescenceMap, 0);
    const thickness = await textureInput('iridescence_range', 'float', [material.iridescenceThicknessRange[1] - material.iridescenceThicknessRange[0]], material.iridescenceThicknessMap, 1, false);
    if (thickness) {
      nodes.push(`  <add name="iridescence_thickness_offset" type="float">
    <input name="in1" type="float" nodename="${thickness}" />
    <input name="in2" type="float" value="${material.iridescenceThicknessRange[0]}" />
  </add>`);
      inputs.push('    <input name="iridescence_thickness" type="float" nodename="iridescence_thickness_offset" />');
    } else value('iridescence_thickness', 'float', [material.iridescenceThicknessRange[1]]);
    value('dispersion', 'float', [material.dispersion]);
    if (material.anisotropyMap) warn(`${name}: anisotropy texture is not represented; scalar strength and rotation are preserved.`);
    if (material.thickness > 0 || material.thicknessMap) warn(`${name}: volume thickness and attenuation are not represented.`);
    if (material.iridescence > 0 && material.iridescenceIOR !== 1.3) warn(`${name}: iridescence IOR uses the engine's fixed value 1.3.`);
    if (material.clearcoatNormalMap) warn(`${name}: the engine does not evaluate a separate clearcoat normal map.`);
  } else {
    value('specular', 'float', [1]);
  }
  if (material.bumpMap) warn(`${name}: height/bump maps are not supported by this glTF conversion.`);
  if (material.aoMap) warn(`${name}: the engine does not apply baked ambient occlusion.`);
  return `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
${nodes.join('\n')}
  <gltf_pbr name="${name}_surface" type="surfaceshader">
${inputs.join('\n')}
  </gltf_pbr>
  <surfacematerial name="${name}" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="${name}_surface" />
  </surfacematerial>
</materialx>`;
}
