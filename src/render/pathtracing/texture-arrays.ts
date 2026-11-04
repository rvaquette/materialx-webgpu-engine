import { UDIM_COLUMNS, UDIM_ROWS } from '../../assets/udim.ts';
import type { WgslBinding } from '../../compiler/wgsl.ts';
import type { PtDeviceBindings, PtTextureBinding } from './device-bindings.ts';
import type { PtMaterialDispatch } from './material-variant.ts';

/** Pack only equal-sized, equal-format views. No resampling or color conversion. */
export function packPtTextureArrays(
  dispatch: PtMaterialDispatch, bindings: PtDeviceBindings, maxLayers: number,
): { dispatch: PtMaterialDispatch; bindings: PtDeviceBindings } {
  if (!Number.isInteger(maxLayers) || maxLayers < 1) throw new Error('Invalid texture array layer limit.');
  const groups = new Map<string, PtTextureBinding[]>();
  const singles: PtTextureBinding[][] = [];
  for (const texture of bindings.textures) {
    const image = bindings.images[texture.imageIndex];
    const index = texture.textureKind === 'udim-index';
    const eligible = image && (index || !texture.textureKind)
      && image.componentType === 'uint8' && image.channels === 4;
    if (!eligible) {
      singles.push([texture]);
      continue;
    }
    const key = JSON.stringify([texture.format, index ? UDIM_COLUMNS : image.width, index ? UDIM_ROWS : image.height, index]);
    let group = groups.get(key);
    if (!group || group.length === maxLayers) {
      group = [];
      groups.set(key, group);
      singles.push(group);
    }
    group.push(texture);
  }
  const textures: WgslBinding[] = [];
  const packed: PtTextureBinding[] = [];
  const helpers: string[] = [];
  let surface = dispatch.dispatcherWgsl;
  let opacity = dispatch.opacityDispatcherWgsl;
  const replace = (pattern: RegExp, replacement: string): void => {
    surface = surface.replace(pattern, replacement);
    opacity = opacity.replace(pattern, replacement);
  };
  for (const group of singles) {
    const first = group[0]!;
    const binding = packed.length;
    const original = dispatch.textures.find(texture => texture.binding === first.binding)!;
    if (group.length === 1) {
      textures.push({ ...original, binding });
      packed.push({ ...first, binding });
      continue;
    }
    const index = first.textureKind === 'udim-index';
    const handle = `pt_array_${binding}`;
    const textureKind = index ? 'index-array' : 'array';
    textures.push({ ...original, binding, handle, textureKind });
    packed.push({ ...first, binding, handle, textureKind, arrayImages: group.map(texture => texture.imageIndex) });
    group.forEach((texture, layer) => {
      const escaped = texture.handle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const helper = `pt_array_${binding}_layer_${layer}`;
      if (index) {
        replace(new RegExp(`\\bmx_sample_udim\\(\\s*([^,]+),\\s*${escaped}\\s*,`, 'g'), `${helper}($1,`);
        helpers.push(`fn ${helper}(tex: texture_2d_array<f32>, samp: sampler, uv: vec2f, level: f32, fallback: vec4f) -> vec4f {
  if (!(uv.x >= 0.0 && uv.x < 10.0 && uv.y >= 0.0 && uv.y < 100.0)) { return fallback; }
  let mapped = textureLoad(${handle}, vec2i(floor(uv)), ${layer}, 0).r;
  if (mapped == 0u) { return fallback; }
  let local = fract(uv);
  return textureSampleLevel(tex, samp, vec2f(local.x, 1.0 - local.y), i32(mapped - 1u), level);
}`);
      } else {
        replace(new RegExp(`\\btextureSampleLevel\\(\\s*${escaped}\\s*,`, 'g'), `${helper}(`);
        replace(new RegExp(`\\btextureDimensions\\(\\s*${escaped}\\s*,`, 'g'), `${helper}_dimensions(`);
        helpers.push(`fn ${helper}(samp: sampler, uv: vec2f, level: f32) -> vec4f {
  return textureSampleLevel(${handle}, samp, uv, ${layer}, level);
}
fn ${helper}_dimensions(level: i32) -> vec2u { return textureDimensions(${handle}, level); }`);
      }
      if (new RegExp(`\\b${escaped}\\b`).test(surface) || new RegExp(`\\b${escaped}\\b`).test(opacity)) {
        throw new Error(`Unsupported texture operation while packing ${texture.handle}.`);
      }
    });
  }
  const registry = {
    ...dispatch.textureRegistry, textures, textureImage: packed.map(texture => texture.imageIndex),
    textureArrayImages: packed.map(texture => texture.arrayImages),
  };
  return {
    dispatch: {
      ...dispatch, textures, textureRegistry: registry,
      preludes: [...dispatch.preludes, ...helpers],
      dispatcherWgsl: surface, opacityDispatcherWgsl: opacity,
    },
    bindings: { ...bindings, textures: packed },
  };
}
