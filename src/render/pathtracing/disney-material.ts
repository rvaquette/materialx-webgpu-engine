import { GpuLimitError } from '../../gpu/device.ts';
import type { ResolvedSurface } from '../../materialx/surface-graph.ts';
import type { MaterialParameter } from '../material-parameters.ts';

type Color = readonly [number, number, number];

/** Parameters in the WebGL renderer's eight-texel Disney material layout. */
export interface DisneyMaterial {
  baseColor: Color;
  anisotropic: number;
  emission: Color;
  metallic: number;
  roughness: number;
  subsurface: number;
  specularTint: number;
  sheen: number;
  sheenTint: number;
  clearcoat: number;
  clearcoatGloss: number;
  specTrans: number;
  ior: number;
  mediumType: 0 | 1 | 2 | 3;
  mediumDensity: number;
  mediumColor: Color;
  mediumAnisotropy: number;
  textures: readonly [number, number, number, number];
  opacity: number;
  alphaMode: 0 | 1 | 2;
  alphaCutoff: number;
}

/**
 * Converts a literal Disney MaterialX surface. Connected graphs require a
 * separate texture/procedural conversion and are deliberately rejected.
 */
export function disneyMaterialFromPrincipled(
  surface: ResolvedSurface, parameters: readonly MaterialParameter[] = [],
): { material: DisneyMaterial; warnings: string[] } {
  if (surface.family !== 'disney_principled') throw new Error(`Unsupported Disney material family: ${surface.family}.`);
  const read = (name: string, count: number): readonly number[] => {
    const input = surface.inputs.get(name);
    if (!input || (input.source.kind !== 'value' && input.source.kind !== 'default')) {
      throw new Error(`Disney material input ${name} is missing or connected; conversion is not supported.`);
    }
    const parameter = parameters.find(p => !p.nodeId && p.input === name);
    if (input.parameter && !parameter) throw new Error(`Missing editable Disney material parameter: ${name}.`);
    const values = parameter?.value ?? input.source.value;
    if (values.length !== count || values.some(value => !Number.isFinite(value))) {
      throw new Error(`Invalid Disney material input ${name}.`);
    }
    return values;
  };
  const number = (name: string): number => read(name, 1)[0]!;
  const color = (name: string): Color => {
    const value = read(name, 3);
    return [value[0]!, value[1]!, value[2]!];
  };
  const warnings = ['MaterialX disney_principled is approximated by the WebGL Disney model; BRDF parameter conventions may differ.'];
  if (number('specular') !== 0.5) warnings.push('Disney WebGL uses IOR rather than the MaterialX specular input.');
  const subsurface = number('subsurface');
  const distance = color('subsurfaceDistance');
  if (subsurface !== 0) warnings.push(`Disney WebGL does not represent subsurfaceDistance (${distance.join(', ')}).`);
  return {
    material: {
      baseColor: color('baseColor'), anisotropic: number('anisotropic'), emission: [0, 0, 0],
      metallic: number('metallic'), roughness: number('roughness'), subsurface,
      specularTint: number('specularTint'), sheen: number('sheen'), sheenTint: number('sheenTint'),
      clearcoat: number('clearcoat'), clearcoatGloss: number('clearcoatGloss'),
      specTrans: number('specTrans'), ior: number('ior'),
      mediumType: 0, mediumDensity: 0, mediumColor: [1, 1, 1], mediumAnisotropy: 0,
      textures: [-1, -1, -1, -1], opacity: 1, alphaMode: 0, alphaCutoff: 0,
    },
    warnings,
  };
}

/** Pack Disney materials into RGBA texels matching the source material texture. */
export function packDisneyMaterials(materials: readonly DisneyMaterial[]): Float32Array {
  const result = new Float32Array(materials.length * 32);
  for (const [index, material] of materials.entries()) {
    const unit = [
      material.anisotropic, material.metallic, material.roughness, material.subsurface,
      material.specularTint, material.sheen, material.sheenTint, material.clearcoat,
      material.clearcoatGloss, material.specTrans, material.opacity, material.alphaCutoff,
    ];
    if (unit.some(value => !Number.isFinite(value) || value < 0 || value > 1) ||
        !Number.isFinite(material.ior) || Math.fround(material.ior) <= 0 ||
        !Number.isFinite(material.mediumDensity) || material.mediumDensity < 0 ||
        !Number.isFinite(material.mediumAnisotropy) || Math.abs(material.mediumAnisotropy) > 1 ||
        ![0, 1, 2, 3].includes(material.mediumType) || ![0, 1, 2].includes(material.alphaMode) ||
        material.textures.length !== 4 || material.textures.some(id => !Number.isInteger(id) || id < -1 || id > 0xffffff)) {
      throw new Error(`Invalid Disney material parameters at index ${index}.`);
    }
    const colors = [material.baseColor, material.emission, material.mediumColor];
    if (colors.some(color => color.length !== 3 || color.some(value => !Number.isFinite(value) || !Number.isFinite(Math.fround(value))))) {
      throw new Error(`Invalid Disney material color at index ${index}.`);
    }
    const record = [
      ...material.baseColor, material.anisotropic,
      ...material.emission, 0,
      material.metallic, material.roughness, material.subsurface, material.specularTint,
      material.sheen, material.sheenTint, material.clearcoat, material.clearcoatGloss,
      material.specTrans, material.ior, material.mediumType, material.mediumDensity,
      ...material.mediumColor, material.mediumAnisotropy,
      ...material.textures,
      material.opacity, material.alphaMode, material.alphaCutoff, 0,
    ];
    if (record.some(value => !Number.isFinite(Math.fround(value)))) throw new Error(`Disney material exceeds float32 range at index ${index}.`);
    result.set(record, index * 32);
  }
  return result;
}

/** Upload complete records after validating their texture-array references. */
export function uploadDisneyMaterials(device: GPUDevice, materials: readonly DisneyMaterial[], textureCount: number): GPUBuffer {
  if (!Number.isSafeInteger(textureCount) || textureCount < 0 || textureCount > device.limits.maxTextureArrayLayers) {
    throw new Error('Invalid Disney texture count.');
  }
  if (!materials.length) throw new Error('Disney material buffer requires at least one material.');
  const data = packDisneyMaterials(materials);
  if (materials.some(material => material.textures.some(id => id >= textureCount))) {
    throw new Error('Disney material references a missing texture layer.');
  }
  if (data.byteLength > device.limits.maxStorageBufferBindingSize || data.byteLength > device.limits.maxBufferSize) {
    throw new GpuLimitError('Disney material buffer exceeds device limits.', 'maxStorageBufferBindingSize', data.byteLength, Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize));
  }
  const buffer = device.createBuffer({
    label: 'Disney materials', size: data.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  try {
    device.queue.writeBuffer(buffer, 0, data);
    return buffer;
  } catch (error) {
    buffer.destroy();
    throw error;
  }
}
