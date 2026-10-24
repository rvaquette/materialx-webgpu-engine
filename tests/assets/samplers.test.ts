import { describe, expect, it } from 'vitest';
import { imageSamplerDescriptor } from '../../src/assets/samplers.ts';

describe('MaterialX image sampler descriptors', () => {
  it('retains repeat and linear filtering when settings are omitted', () => {
    expect(imageSamplerDescriptor({})).toEqual({
      addressModeU: 'repeat', addressModeV: 'repeat', magFilter: 'linear', minFilter: 'linear',
    });
  });

  it.each([
    ['clamp', 'clamp-to-edge'],
    ['periodic', 'repeat'],
    ['mirror', 'mirror-repeat'],
    ['constant', 'clamp-to-edge'],
  ])('maps %s independently on each axis', (mode, expected) => {
    const u = imageSamplerDescriptor({ addressU: mode, filter: 'closest' });
    expect(u).toEqual({ addressModeU: expected, addressModeV: 'repeat', magFilter: 'nearest', minFilter: 'nearest' });
    const v = imageSamplerDescriptor({ addressV: mode });
    expect(v.addressModeU).toBe('repeat');
    expect(v.addressModeV).toBe(expected);
  });

  it('rejects unknown address and filter modes explicitly', () => {
    expect(() => imageSamplerDescriptor({ addressU: 'invalid' })).toThrow('address mode');
    expect(() => imageSamplerDescriptor({ addressV: 'invalid' })).toThrow('address mode');
    expect(() => imageSamplerDescriptor({ filter: 'invalid' })).toThrow('filter');
  });
});
