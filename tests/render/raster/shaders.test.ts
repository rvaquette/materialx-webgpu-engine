import { describe, expect, it } from 'vitest';
import { displayTransformWgsl, tonemapResolveWgsl } from '../../../src/render/raster/shaders.ts';
import { pathTraceDisplayWgsl } from '../../../src/render/pathtracing/display.ts';

describe('tonemapResolveWgsl', () => {
  it('emits a fullscreen pass that samples the HDR target and applies sRGB', () => {
    const code = tonemapResolveWgsl('acesFilmic');
    expect(code).toContain('@vertex');
    expect(code).toContain('@fragment');
    expect(code).toContain('textureSample(hdrTex');
    expect(code).toContain('display_color(hdr, r.exposure)');
    expect(code).toContain('exp2(exposure)');
    expect(code).toContain('fn srgb');
  });

  it('inlines the selected tonemap operator', () => {
    expect(tonemapResolveWgsl('reinhard')).toContain('c / (vec3<f32>(1.0) + c)');
    expect(tonemapResolveWgsl('acesFilmic')).toContain('2.51 * c');
    const none = tonemapResolveWgsl('none');
    expect(none).toContain('c = c;');
  });

  it('uses the runtime selector in viewer displays while retaining static transforms for reference renders', () => {
    expect(tonemapResolveWgsl('acesFilmic', true)).toContain(displayTransformWgsl('acesFilmic', 'r.tonemap'));
    expect(pathTraceDisplayWgsl(false, true)).toContain(displayTransformWgsl('acesFilmic', 'info.constantEnv.w'));
    expect(tonemapResolveWgsl('none', true)).toContain('if (r.tonemap == 1.0)');
    expect(tonemapResolveWgsl('none', true)).toContain('else if (r.tonemap == 2.0)');
    expect(tonemapResolveWgsl('none')).not.toContain('r.tonemap');
  });
});
