// T057k: bilinear CPU image sampler used by the path tracer oracle. These tests
// pin the texel-center, interpolation and repeat-addressing behaviour that must
// mirror the megakernel's textureSample().
import { describe, expect, it } from 'vitest';
import { createImageSampler } from '../../../src/render/pathtracing/texture-sample.ts';
import type { DecodedPixelImage } from '../../../src/assets/images.ts';

/** 2x2 RGB image: red, green, blue, white (row-major). */
function checker(): DecodedPixelImage {
  return {
    kind: 'pixels',
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
    componentType: 'uint8',
    channels: 3,
    width: 2,
    height: 2,
    colorSpace: 'lin_rec709',
  };
}

describe('createImageSampler (T057k)', () => {
  it('decodes sRGB RGB texels to linear before interpolation while leaving alpha unchanged', () => {
    const sample = createImageSampler({
      kind: 'pixels', componentType: 'uint8', channels: 4, width: 2, height: 1, colorSpace: 'srgb_texture',
      data: new Uint8Array([128, 10, 0, 128, 255, 255, 255, 255]),
    });
    const first = sample(0.25, 0.5);
    expect(first[0]).toBeCloseTo(0.2158605, 6);
    expect(first[1]).toBeCloseTo(10 / 255 / 12.92, 8);
    expect(first[2]).toBe(0);
    expect(first[3]).toBeCloseTo(128 / 255, 8);
    expect(sample(0.5, 0.5)[0]).toBeCloseTo((0.2158605 + 1) / 2, 6);
  });

  it('returns exact texels at their half-texel centers', () => {
    const s = createImageSampler(checker());
    expect(s(0.25, 0.25)).toEqual([1, 0, 0, 1]);
    expect(s(0.75, 0.25)).toEqual([0, 1, 0, 1]);
    expect(s(0.25, 0.75)).toEqual([0, 0, 1, 1]);
    expect(s(0.75, 0.75)).toEqual([1, 1, 1, 1]);
  });

  it('bilinearly blends the four texels at the image center', () => {
    const s = createImageSampler(checker());
    const [r, g, b, a] = s(0.5, 0.5);
    expect(r).toBeCloseTo(0.5, 5);
    expect(g).toBeCloseTo(0.5, 5);
    expect(b).toBeCloseTo(0.5, 5);
    expect(a).toBeCloseTo(1, 5);
  });

  it('repeats across the unit square (periodic addressing)', () => {
    const s = createImageSampler(checker());
    expect(s(1.25, 0.25)).toEqual(s(0.25, 0.25));
    expect(s(0.25, 1.25)).toEqual(s(0.25, 0.25));
  });

  it('fills missing channels with zero and alpha one', () => {
    const image: DecodedPixelImage = {
      kind: 'pixels',
      data: new Uint8Array([128]),
      componentType: 'uint8',
      channels: 1,
      width: 1,
      height: 1,
      colorSpace: 'lin_rec709',
    };
    const [r, g, b, a] = createImageSampler(image)(0.5, 0.5);
    expect(r).toBeCloseTo(128 / 255, 5);
    expect(g).toBe(0);
    expect(b).toBe(0);
    expect(a).toBe(1);
  });

  it('normalizes uint16 samples to [0,1]', () => {
    const image: DecodedPixelImage = {
      kind: 'pixels',
      data: new Uint16Array([65535, 0, 32768, 65535]),
      componentType: 'uint16',
      channels: 4,
      width: 1,
      height: 1,
      colorSpace: 'lin_rec709',
    };
    const [r, g, b, a] = createImageSampler(image)(0.5, 0.5);
    expect(r).toBeCloseTo(1, 5);
    expect(g).toBeCloseTo(0, 5);
    expect(b).toBeCloseTo(0.5, 4);
    expect(a).toBeCloseTo(1, 5);
  });
});
