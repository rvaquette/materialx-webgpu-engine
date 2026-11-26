import { describe, expect, it } from 'vitest';
import { imageShaderUniformData, imageShaderWgsl } from '../../src/render/image-shader.ts';
import type { ImageShaderSettings } from '../../src/materialx/engine-shaders.ts';

describe('post-display image shader', () => {
  it('packs its four display controls without modifying render accumulation', () => {
    const settings: ImageShaderSettings = { exposure: 1.5, contrast: 0.8, saturation: 1.2, vignette: 0.3 };
    expect([...imageShaderUniformData(settings)]).toEqual([1.5, 0.8, 1.2, 0.3].map(Math.fround));
    expect(imageShaderWgsl).toContain('textureLoad(source');
    expect(imageShaderWgsl).toContain('texture_2d<f32>');
  });

  it('uses a distinct sampled source and render output in the fullscreen pass', () => {
    expect(imageShaderWgsl).toContain('@group(0) @binding(0) var source');
    expect(imageShaderWgsl).toContain('@fragment fn fs');
    expect(imageShaderWgsl).toContain('return vec4f(color, 1.0)');
  });
});
