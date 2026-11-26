import { describe, expect, it } from 'vitest';
import {
  PATH_TRACE_VIEWS, customAovView, pathTraceViewIndex, unpackPathTraceAov, pathTraceDisplayWgsl, pathTraceStorageBytesPerPixel, pathTraceViewStoresAov, previewScale,
  PT_DISPLAY_INFO_BYTES, PT_DISPLAY_PIXEL_BYTES, PT_SURFACE_AOV_PIXEL_BYTES,
} from '../../../src/render/pathtracing/display.ts';
import { pathTraceComputeWgsl } from '../../../src/render/pathtracing/compute.ts';
import { displayTransformWgsl, tonemapResolveWgsl } from '../../../src/render/raster/shaders.ts';

describe('path tracing presentation', () => {
  it('stores named data AOVs separately and unpacks hit-conditioned raw values', () => {
    const position = customAovView({ name: 'world', kind: 'position', parameter: 0 });
    const scalar = customAovView({ name: 'mask', kind: 'material_mask', parameter: 7 });
    expect(PATH_TRACE_VIEWS.map(view => pathTraceViewIndex(view.value))).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(pathTraceViewIndex(position)).toBe(7);
    expect(pathTraceViewIndex(scalar)).toBe(13);
    expect(pathTraceViewIndex('custom:bad:material_mask:-1')).toBe(-1);
    expect(pathTraceStorageBytesPerPixel(scalar)).toBe(48);
    const source = new Float32Array([
      0, 0, 0, 4, 0, 0, 0, 0,
      0, 0, 0, 1, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0,
      1, -2, 3, 0.5, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect([...unpackPathTraceAov(position, 3, 1, source).values]).toEqual([2, -4, 6, 0, 0, 0, NaN, NaN, NaN]);
    const data = unpackPathTraceAov(scalar, 3, 1, source);
    expect(data.channels).toBe(1);
    expect([...data.values]).toEqual([2, 0, NaN]);
    expect(pathTraceDisplayWgsl(false, false, true)).toContain('clamp(aov.xyz / aov.w, vec3f(0.0), vec3f(1.0))');
  });
  it('uses the same exposure, ACES and sRGB transform as raster', () => {
    const transform = displayTransformWgsl('acesFilmic');
    expect(tonemapResolveWgsl('acesFilmic')).toContain(transform);
    expect(pathTraceDisplayWgsl(true)).toContain(transform);
    expect(PT_DISPLAY_INFO_BYTES).toBe(144);
    expect(PT_DISPLAY_PIXEL_BYTES).toBe(2 * 16);
    expect(PT_SURFACE_AOV_PIXEL_BYTES).toBe(16);
    expect(pathTraceStorageBytesPerPixel('beauty')).toBe(32);
    expect(pathTraceStorageBytesPerPixel('variance')).toBe(32);
    expect(pathTraceStorageBytesPerPixel('transmission')).toBe(48);
    expect(pathTraceViewStoresAov('variance')).toBe(false);
    expect(pathTraceViewStoresAov('normal')).toBe(true);
    expect(PATH_TRACE_VIEWS.find(view => view.value === 'emission')).toEqual({ value: 'emission', label: 'Émission primaire' });
    expect(PATH_TRACE_VIEWS.at(-1)).toEqual({ value: 'transmission', label: 'Transmission matériau' });
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
    expect(code).toContain('info.env.w > 0.0');
    expect(code).toContain('if (frag.x < split) { return raw; }');
    expect(code).toContain('return vec4f(denoisedComposite, 1.0)');
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
    expect(viewer).toContain('if (cameraSegment) {');
    expect(viewer).toContain('if (U.lens.x < 0.5 && U.lens.y == 0.0) { break; }');
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

  it('captures primary surface guides after opacity without changing the reference integrator', () => {
    const reference = pathTraceComputeWgsl();
    const viewer = pathTraceComputeWgsl({ displayAovs: true });
    expect(reference).not.toContain('surfaceAov');
    const capture = viewer.indexOf('(*surfaceAov).value = vec4f(mx_closure_diffuse_albedo(c, aovWo), 1.0)');
    expect(capture).toBeGreaterThan(viewer.indexOf('rng_next(state) >= opacity'));
    expect(capture).toBeLessThan(viewer.indexOf('cameraSegment = false;', capture));
    expect(viewer).toContain('mx_closure_diffuse_albedo(c, aovWo)');
    expect(viewer).toContain('mx_closure_transmission_albedo(c)');
    expect(viewer).toContain('let aovMode = u32(U.envTexture.w)');
    expect(viewer).toContain('if (aovMode != 0u && aovMode != 4u)');
    expect(viewer).toContain('if (l.kind == MX_LOBE_TRANSLUCENT || l.kind == MX_LOBE_DIELECTRIC_TRANSMISSION)');
    expect(viewer).toContain('a = a + l.color * max(l.weight, 0.0)');
    expect(viewer).toContain('(*surfaceAov).value = vec4f(mx_closure_transmission_albedo(c), 1.0)');
    expect(viewer).toContain('(*surfaceAov).value = vec4f(c.emission, 1.0)');
    expect(viewer).toContain('width * height * 2u + pixel');
    expect(viewer).toContain('(accum[aovPixel] * count + surfaceSum.value) / totalCount');
    expect(viewer).toContain('(*surfaceAov).value = vec4f(pos, 1.0)');
    expect(viewer).toContain('tri_material(hit.tri) == u32(U.lensExtra.y)');
    expect(viewer.indexOf('(*surfaceAov).value = vec4f(pos, 1.0)')).toBeGreaterThan(viewer.indexOf('rng_next(state) >= opacity'));
  });

  it('displays raw AOVs ahead of denoising with preview fallback and per-pixel sample variance', () => {
    const shader = pathTraceDisplayWgsl(false, true, true);
    expect(pathTraceDisplayWgsl(false)).not.toContain('fn aov_color');
    expect(shader).toContain('aov = preview[aovIndex]');
    expect(shader).toContain('aov.xyz / aov.w');
    expect(shader).toContain('aov.x / aov.w');
    expect(shader).toContain('srgb(clamp(aov.xyz, vec3f(0.0), vec3f(1.0)))');
    expect(shader).toContain('srgb(emitted / (vec3f(1.0) + emitted))');
    expect(shader).toContain('normalize(n) * 0.5 + 0.5');
    expect(shader).toContain('dims.x * dims.y * 2u + xy.y * dims.x + xy.x');
    expect(shader).toContain('moments.y, 0.0) / (pixel.w - 1.0)');
    expect(shader.indexOf('return aov_color(frag)')).toBeLessThan(shader.indexOf('let raw = raw_color(frag)'));
  });
});
