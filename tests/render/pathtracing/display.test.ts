import { describe, expect, it } from 'vitest';
import { pathTraceDisplayWgsl, previewScale, PT_DISPLAY_INFO_BYTES, PT_DISPLAY_PIXEL_BYTES } from '../../../src/render/pathtracing/display.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';
import { displayTransformWgsl, tonemapResolveWgsl } from '../../../src/render/raster/shaders.ts';

describe('path tracing presentation', () => {
  it('uses the same exposure, ACES and sRGB transform as raster', () => {
    const transform = displayTransformWgsl('acesFilmic');
    expect(tonemapResolveWgsl('acesFilmic')).toContain(transform);
    expect(pathTraceDisplayWgsl(true)).toContain(transform);
    expect(PT_DISPLAY_INFO_BYTES).toBe(144);
    expect(PT_DISPLAY_PIXEL_BYTES).toBe(2 * 16);
  });

  it('reconstructs previews, falls back only for unrendered tiles, and samples the dome at output resolution', () => {
    const code = pathTraceDisplayWgsl(true);
    expect(code).toContain('if (pixels[i].w == 0.0)');
    expect(code).toContain('load_preview((vec2f(xy) + 0.5) / vec2f(info.size))');
    expect(code).toContain('let uv = frag.xy / vec2f(info.outputSize)');
    expect(code).toContain('textureSampleLevel(dome, domeSampler, texcoord, 0.0)');
    expect(code).toContain('(1.0 - clamp(center.coverage, 0.0, 1.0)) * background(uv)');
    expect(pathTraceDisplayWgsl(false)).not.toContain('textureSampleLevel');
  });

  it('removes the spatial filter and gates the neural output without changing the visible dome', () => {
    const code = pathTraceDisplayWgsl(false);
    expect(code).toContain('info.neuralEnabled == 0u');
    expect(code).toContain('textureLoad(neuralOutput');
    expect(code).toContain('mix(raw.xyz, denoised, clamp(coverage');
    expect(code).not.toContain('fn filtered');
    expect(code).not.toContain('guide');
  });

  it('emits viewer AOVs without changing the reference layout or clamping transport', () => {
    const reference = pathTraceComputeWgsl({ environment: true });
    const viewer = pathTraceComputeWgsl({ environment: true, displayAovs: true });
    expect(reference).not.toContain('pixel * 2u');
    expect(reference).not.toContain('camera_jitter');
    expect(viewer).toContain('pixel * 2u');
    expect(viewer).toContain('coverage += hitCoverage');
    expect(viewer).toContain('if (cameraSegment) { break; }');
    expect(viewer).toContain('reverseBits(index + 1u)');
    expect(viewer).toContain('var state = pcg_hash');
    expect(viewer).toContain('let fireflyMax = U.eye.w');
  });

  it('adapts only outside the hysteresis window and bounds memory/quality', () => {
    expect(previewScale(4, 80)).toBe(8);
    expect(previewScale(8, 80)).toBe(8);
    expect(previewScale(4, 15)).toBe(2);
    expect(previewScale(2, 15)).toBe(2);
    expect(previewScale(4, 35)).toBe(4);
    expect(previewScale(4, 55)).toBe(4);
    expect(previewScale(4, 22)).toBe(4);
  });
});
