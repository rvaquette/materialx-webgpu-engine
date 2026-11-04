import { describe, expect, it } from 'vitest';
import type { DecodedPixelImage } from '../../../src/assets/images.ts';
import { buildMaterialDispatch } from '../../../src/render/pathtracing/material-variant.ts';
import type { PtDeviceBindings } from '../../../src/render/pathtracing/device-bindings.ts';
import { packPtTextureArrays } from '../../../src/render/pathtracing/texture-arrays.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';

function fixture(count = 3) {
  const dispatch = buildMaterialDispatch([]);
  dispatch.textures = Array.from({ length: count }, (_, binding) => ({
    name: `image${binding}`, handle: `tex_${binding}`, group: 1, binding,
  }));
  dispatch.textureRegistry = {
    textures: dispatch.textures, samplers: [], images: dispatch.textures.map(t => `${t.name}.jpg`),
    textureImage: dispatch.textures.map(t => t.binding),
  };
  dispatch.dispatcherWgsl = dispatch.textures.map(t => `textureSampleLevel(${t.handle}, samp, vec2f(0.5), 0.0)`).join('\n');
  dispatch.opacityDispatcherWgsl = 'textureSampleLevel(tex_1, samp, vec2f(0.2), 0.0)';
  const pixel = (value: number): DecodedPixelImage => ({
    kind: 'pixels', componentType: 'uint8', channels: 4, width: 1, height: 1,
    colorSpace: 'raw', data: new Uint8Array([value, 0, 0, 255]),
  });
  const bindings: PtDeviceBindings = {
    group0: [], samplers: [],
    textures: dispatch.textures.map(t => ({ binding: t.binding, handle: t.handle, imageIndex: t.binding, format: 'rgba8unorm' })),
    images: dispatch.textures.map(t => pixel(t.binding)),
  };
  return { dispatch, bindings };
}

describe('path-tracer texture arrays', () => {
  it('shares compatible images, rewrites surface/opacity/dimensions and retains exact layer pixels', () => {
    const { dispatch, bindings } = fixture();
    dispatch.dispatcherWgsl += '\ntextureDimensions(tex_2, 0)';
    const result = packPtTextureArrays(dispatch, bindings, 256);
    expect(result.dispatch.textures).toHaveLength(1);
    expect(result.bindings.textures[0]?.arrayImages).toEqual([0, 1, 2]);
    expect(result.bindings.images).toBe(bindings.images);
    expect(result.dispatch.dispatcherWgsl).toContain('pt_array_0_layer_2_dimensions( 0)');
    expect(result.dispatch.opacityDispatcherWgsl).toContain('pt_array_0_layer_1(');
    expect(result.dispatch.preludes.join('\n')).toContain('textureSampleLevel(pt_array_0, samp, uv, 2, level)');
    expect(pathTraceComputeWgsl({ dispatch: result.dispatch })).toContain('var pt_array_0: texture_2d_array<f32>');
    expect(dispatch.textures).toHaveLength(3);
    expect(dispatch.dispatcherWgsl).toContain('textureSampleLevel(tex_0,');
  });

  it('separates sRGB and linear formats, different dimensions, missing images and UDIM color arrays', () => {
    const { dispatch, bindings } = fixture(5);
    bindings.textures[1]!.format = 'rgba8unorm-srgb';
    bindings.images[2]!.width = 2;
    bindings.images[3] = undefined;
    bindings.textures[4]!.textureKind = 'udim';
    dispatch.textures[4]!.textureKind = 'udim';
    const result = packPtTextureArrays(dispatch, bindings, 256);
    expect(result.dispatch.textures).toHaveLength(5);
    expect(result.bindings.textures.every(t => !t.arrayImages)).toBe(true);
  });

  it('splits arrays at the adapter layer limit, including single-layer remainders', () => {
    const { dispatch, bindings } = fixture(5);
    const result = packPtTextureArrays(dispatch, bindings, 2);
    expect(result.bindings.textures.map(t => t.arrayImages)).toEqual([[0, 1], [2, 3], undefined]);
    expect(result.dispatch.textures.map(t => t.binding)).toEqual([0, 1, 2]);
    expect(result.dispatch.dispatcherWgsl).toContain('textureSampleLevel(tex_4,');
    expect(() => packPtTextureArrays(dispatch, bindings, 0)).toThrow('layer limit');
  });

  it('packs sparse UDIM lookup maps as integer layers without changing tile indices or fallbacks', () => {
    const { dispatch, bindings } = fixture(2);
    bindings.textures.forEach(t => { t.textureKind = 'udim-index'; t.format = 'r32uint'; });
    dispatch.textures.forEach(t => { t.textureKind = 'udim-index'; });
    dispatch.dispatcherWgsl = 'mx_sample_udim(colors_0, tex_0, samp, uv, 0.0, fallback)';
    dispatch.opacityDispatcherWgsl = 'mx_sample_udim(colors_1, tex_1, samp, uv, lod, fallback)';
    const result = packPtTextureArrays(dispatch, bindings, 256);
    expect(result.dispatch.textures).toHaveLength(1);
    expect(result.dispatch.textures[0]!.textureKind).toBe('index-array');
    expect(result.dispatch.opacityDispatcherWgsl).toBe('pt_array_0_layer_1(colors_1, samp, uv, lod, fallback)');
    expect(result.dispatch.preludes.join('\n')).toContain('textureLoad(pt_array_0, vec2i(floor(uv)), 1, 0).r');
    expect(result.dispatch.preludes.join('\n')).toContain('if (mapped == 0u) { return fallback; }');
    expect(pathTraceComputeWgsl({ dispatch: result.dispatch })).toContain('var pt_array_0: texture_2d_array<u32>');
  });

  it('reports unsupported texture operations rather than emitting dangling bindings', () => {
    const { dispatch, bindings } = fixture();
    dispatch.dispatcherWgsl += '\ntextureLoad(tex_0, vec2i(0), 0)';
    expect(() => packPtTextureArrays(dispatch, bindings, 256)).toThrow('Unsupported texture operation');
  });
});
