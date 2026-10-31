import { MeshStandardMaterial, MeshPhysicalMaterial, RepeatWrapping, MirroredRepeatWrapping, NearestFilter, type Material, type Texture } from 'three';

export type TextureExporter = (texture: Texture, channel?: number) => Promise<string>;
const escapeXml = (value: string): string => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** glTF metallic-roughness inputs mapped to the engine's Disney surface family. */
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
  const textureInput = async (input: string, type: 'float' | 'color3', factor: readonly number[], texture?: Texture | null, channel?: number, invert = false): Promise<void> => {
    if (!texture) {
      value(input, type, invert ? factor.map(n => 1 - n) : factor);
      return;
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
    let connected = product;
    if (invert) {
      connected = `${input}_inverted`;
      nodes.push(`  <subtract name="${connected}" type="float">
    <input name="in1" type="float" value="1" />
    <input name="in2" type="float" nodename="${product}" />
  </subtract>`);
    }
    inputs.push(`    <input name="${input}" type="${type}" nodename="${connected}" />`);
    if (texture.minFilter !== texture.magFilter) warn(`${name}.${input}: texture mip filtering is approximated by the engine's single-level sampler.`);
  };
  await textureInput('baseColor', 'color3', material.color.toArray(), material.map);
  await textureInput('metallic', 'float', [material.metalness], material.metalnessMap, 2);
  await textureInput('roughness', 'float', [material.roughness], material.roughnessMap, 1);
  value('specular', 'float', [1]);
  if (material instanceof MeshPhysicalMaterial) {
    value('ior', 'float', [material.ior]);
    await textureInput('clearcoat', 'float', [material.clearcoat], material.clearcoatMap, 0);
    await textureInput('clearcoatGloss', 'float', [material.clearcoatRoughness], material.clearcoatRoughnessMap, 1, true);
    await textureInput('specTrans', 'float', [material.transmission], material.transmissionMap, 0);
    value('anisotropic', 'float', [material.anisotropy]);
    value('sheen', 'float', [material.sheen]);
    if (material.anisotropyMap || material.anisotropyRotation !== 0) warn(`${name}: anisotropy texture and rotation are not represented.`);
    if (material.sheen > 0) warn(`${name}: sheen color and roughness are approximated by Disney sheen.`);
    if (material.thickness > 0 || material.thicknessMap) warn(`${name}: volume thickness and attenuation are not represented.`);
    if (material.iridescence > 0 || material.iridescenceMap) warn(`${name}: iridescence is not represented.`);
    if (material.specularIntensity !== 1 || material.specularIntensityMap || material.specularColorMap || material.specularColor.r !== 1 || material.specularColor.g !== 1 || material.specularColor.b !== 1) {
      warn(`${name}: KHR_materials_specular is approximated by the Disney dielectric lobe.`);
    }
    if (material.clearcoatNormalMap) warn(`${name}: clearcoat normal map is not represented.`);
  }
  if (material.normalMap || material.bumpMap) warn(`${name}: normal and bump maps are not represented by disney_principled.`);
  if (material.aoMap) warn(`${name}: baked ambient occlusion is not applied.`);
  if (material.alphaTest > 0 || material.transparent || material.opacity !== 1 || material.alphaMap) {
    warn(`${name}: alpha masking/blending is not represented; the material is rendered opaque.`);
  }
  if (material.emissiveIntensity > 0 && (material.emissive.r > 0 || material.emissive.g > 0 || material.emissive.b > 0 || material.emissiveMap)) {
    warn(`${name}: emission is not represented by disney_principled.`);
  }
  return `<?xml version="1.0"?>
<materialx version="1.39" colorspace="lin_rec709">
${nodes.join('\n')}
  <disney_principled name="${name}_surface" type="surfaceshader">
${inputs.join('\n')}
  </disney_principled>
  <surfacematerial name="${name}" type="material">
    <input name="surfaceshader" type="surfaceshader" nodename="${name}_surface" />
  </surfacematerial>
</materialx>`;
}
