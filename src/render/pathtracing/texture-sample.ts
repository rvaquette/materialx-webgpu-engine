// T057k: CPU bilinear sampler over a decoded pixel image. The path tracer oracle
// uses it to mirror the megakernel's textureSample() so CPU and device agree on
// textured surface graphs. Integer samples are normalized to [0,1]; sampling uses
// half-texel centers, repeat addressing and returns RGBA (unfilled channels 0,
// alpha 1) so callers slice to their channel count -- matching how WGSL
// textureSample returns a vec4 the surface lowering then swizzles.

import type { DecodedPixelImage } from '../../assets/images.ts';
import { imageSamplerDescriptor } from '../../assets/samplers.ts';
import type { SamplerResource } from '../../compiler/ir.ts';

/** Bilinear RGBA sampler at normalized uv; returns four components in [0,1]. */
export type ImageSampler = (u: number, v: number) => number[];

function normalize(value: number, componentType: DecodedPixelImage['componentType']): number {
  switch (componentType) {
    case 'uint8':
      return value / 255;
    case 'uint16':
      return value / 65535;
    default:
      // float16/float32 are already stored normalized.
      return value;
  }
}

function wrap(i: number, n: number): number {
  const m = i % n;
  return m < 0 ? m + n : m;
}

/** Build an RGBA sampler; omitted settings retain repeat/linear filtering. */
export function createImageSampler(
  image: DecodedPixelImage,
  sampler: Pick<SamplerResource, 'addressU' | 'addressV' | 'filter'> = {},
  border: readonly number[] = [0, 0, 0, 1],
): ImageSampler {
  const descriptor = imageSamplerDescriptor(sampler);
  const { data, width, height, channels, componentType } = image;
  const address = (i: number, size: number, mode: GPUAddressMode): number => {
    if (mode === 'clamp-to-edge') return Math.min(Math.max(i, 0), size - 1);
    if (mode === 'mirror-repeat') {
      const mirrored = wrap(i, size * 2);
      return mirrored < size ? mirrored : size * 2 - 1 - mirrored;
    }
    return wrap(i, size);
  };
  const texel = (x: number, y: number): number[] => {
    const base = (address(y, height, descriptor.addressModeV) * width + address(x, width, descriptor.addressModeU)) * channels;
    const out = [0, 0, 0, 1];
    for (let c = 0; c < channels && c < 4; c++) {
      const value = normalize(data[base + c]!, componentType);
      out[c] = image.colorSpace === 'srgb_texture' && c < 3
        ? value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)
        : value;
    }
    return out;
  };
  return (u, v) => {
    if ((sampler.addressU === 'constant' && (u < 0 || u > 1)) ||
        (sampler.addressV === 'constant' && (v < 0 || v > 1))) return [...border];
    if (descriptor.magFilter === 'nearest') return texel(Math.floor(u * width), Math.floor(v * height));
    const fx = u * width - 0.5;
    const fy = v * height - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const c00 = texel(x0, y0);
    const c10 = texel(x0 + 1, y0);
    const c01 = texel(x0, y0 + 1);
    const c11 = texel(x0 + 1, y0 + 1);
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const a = c00[c]! * (1 - tx) + c10[c]! * tx;
      const b = c01[c]! * (1 - tx) + c11[c]! * tx;
      out[c] = a * (1 - ty) + b * ty;
    }
    return out;
  };
}
