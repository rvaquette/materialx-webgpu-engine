import { describe, expect, it } from 'vitest';
import { forwardOpaqueWgsl, openPbrSurfaceWgsl, tonemapResolveWgsl } from '../../../src/render/raster/shaders.ts';

describe('forwardOpaqueWgsl', () => {
  it('declares vertex and fragment entry points and the uniform block', () => {
    const code = forwardOpaqueWgsl();
    expect(code).toContain('@vertex');
    expect(code).toContain('@fragment');
    expect(code).toContain('fn vs_main');
    expect(code).toContain('fn fs_main');
    expect(code).toContain('@group(0) @binding(0) var<uniform> u : Uniforms');
    expect(code).toContain('u.viewProj *');
  });

  it('evaluates the composed OpenPBR surface with a view direction (T045)', () => {
    const code = forwardOpaqueWgsl();
    // The forward fragment no longer uses the Lambert + ambient placeholder.
    expect(code).not.toContain('let ambient = 0.03;');
    // Vertex forwards the world position so the fragment can build V = eye - pos.
    expect(code).toContain('out.worldPos = position;');
    expect(code).toContain('normalize(u.eye.xyz - in.worldPos)');
    // The shared OpenPBR entry point is embedded and called.
    expect(code).toContain('fn mx_openpbr_surface');
    expect(code).toContain('mx_openpbr_surface(m, n, v, lit)');
  });
});

describe('openPbrSurfaceWgsl', () => {
  it('composes the five canonical lobes via mix and layer (T045)', () => {
    const code = openPbrSurfaceWgsl();
    expect(code).toContain('fn mx_burley_diffuse');
    expect(code).toContain('fn mx_translucent');
    expect(code).toContain('fn mx_subsurface');
    expect(code).toContain('fn mx_dielectric');
    expect(code).toContain('fn mx_conductor_schlick');
    expect(code).toContain('fn mx_ggx_reflection');
    expect(code).toContain('fn mx_closure_mix');
    expect(code).toContain('fn mx_layer');
    expect(code).toContain('fn mx_openpbr_surface');
  });
});

describe('tonemapResolveWgsl', () => {
  it('emits a fullscreen pass that samples the HDR target and applies sRGB', () => {
    const code = tonemapResolveWgsl('acesFilmic');
    expect(code).toContain('@vertex');
    expect(code).toContain('@fragment');
    expect(code).toContain('textureSample(hdrTex');
    expect(code).toContain('exp2(r.exposure)');
    expect(code).toContain('fn srgb');
  });

  it('inlines the selected tonemap operator', () => {
    expect(tonemapResolveWgsl('reinhard')).toContain('c / (vec3<f32>(1.0) + c)');
    expect(tonemapResolveWgsl('acesFilmic')).toContain('2.51 * c');
    const none = tonemapResolveWgsl('none');
    expect(none).toContain('c = c;');
  });
});
