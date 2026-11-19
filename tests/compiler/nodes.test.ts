import { describe, it, expect } from 'vitest';
import { coveredCategories, getNodeLowering, isNodeCovered, NODE_REGISTRY } from '../../src/compiler/nodes.ts';
import { DEFAULT_SUPPORTED_UPSTREAM } from '../../src/materialx/surface-graph.ts';

// The 57 source-code leaves from docs/materialx-node-coverage.md (T014 work list).
const LEAVES = [
  'absval', 'add', 'anisotropic_vdf', 'artistic_ior', 'burley_diffuse_bsdf',
  'chiang_hair_absorption_from_color', 'chiang_hair_bsdf', 'chiang_hair_roughness',
  'clamp', 'combine2', 'combine3', 'conductor_bsdf', 'constant',
  'deon_hair_absorption_from_melanin', 'dielectric_bsdf', 'divide', 'dot', 'dotproduct',
  'extract', 'fractal3d', 'generalized_schlick_bsdf', 'generalized_schlick_edf',
  'hextiledimage', 'hsvtorgb', 'ifequal', 'ifgreater', 'ifgreatereq', 'image', 'invert', 'layer',
  'ln', 'luminance', 'max', 'min', 'mix', 'multiply', 'normalize', 'normalmap',
  'oren_nayar_diffuse_bsdf', 'position', 'power', 'rgbtohsv', 'rotate2d', 'rotate3d',
  'roughness_anisotropy', 'roughness_dual', 'sheen_bsdf', 'sign', 'sin', 'sqrt',
  'subsurface_bsdf', 'subtract', 'surface', 'surfacematerial', 'texcoord',
  'translucent_bsdf', 'uniform_edf',
];

describe('node coverage', () => {
  it.each(['sign', 'invert'])('reports %s as supported for surface graphs', category => {
    expect(isNodeCovered(category)).toBe(true);
    expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
  });

  it.each([
    'g18_rec709_to_lin_rec709', 'g22_rec709_to_lin_rec709', 'rec709_display_to_lin_rec709',
    'acescg_to_lin_rec709', 'g22_ap1_to_lin_rec709', 'srgb_texture_to_lin_rec709',
    'lin_adobergb_to_lin_rec709', 'adobergb_to_lin_rec709',
    'srgb_displayp3_to_lin_rec709', 'lin_displayp3_to_lin_rec709',
  ])('reports color transform %s as supported', category => {
    expect(isNodeCovered(category)).toBe(true);
    expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
  });

  it.each(['creatematrix', 'determinant', 'transpose', 'invertmatrix', 'transformmatrix'])(
    'reports matrix operation %s as supported',
    category => {
      expect(isNodeCovered(category)).toBe(true);
      expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
    },
  );

  it.each(['bump', 'heighttonormal', 'ramp', 'ramp_gradient', 'luminance', 'viewdirection'])(
    'reports %s as supported for surface graph diagnostics',
    category => {
      expect(isNodeCovered(category)).toBe(true);
      expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
    },
  );

  it('recognizes hextilednormalmap in surface graph diagnostics', () => {
    expect(DEFAULT_SUPPORTED_UPSTREAM.has('hextilednormalmap')).toBe(true);
  });

  it.each(['mincomponent', 'maxcomponent', 'trianglewave'])(
    'reports %s as supported for graph diagnostics and editing',
    category => {
      expect(isNodeCovered(category)).toBe(true);
      expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
    },
  );

  it.each(['over', 'in', 'out', 'mask', 'matte', 'disjointover', 'inside', 'outside'])(
    'reports %s as supported for graph diagnostics and editing',
    category => {
      expect(isNodeCovered(category)).toBe(true);
      expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
    },
  );

  it.each(['premult', 'unpremult', 'plus', 'minus', 'difference', 'screen', 'overlay', 'burn', 'dodge'])(
    'reports compositing node %s as supported for surface graphs',
    category => {
      expect(isNodeCovered(category)).toBe(true);
      expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
    },
  );

  it.each(['hsvadjust', 'saturate', 'contrast', 'colorcorrect'])(
    'reports color adjustment %s as supported for surface graphs',
    category => {
      expect(isNodeCovered(category)).toBe(true);
      expect(DEFAULT_SUPPORTED_UPSTREAM.has(category)).toBe(true);
    },
  );

  it('reports randomfloat as supported for surface graphs', () => {
    expect(isNodeCovered('randomfloat')).toBe(true);
    expect(DEFAULT_SUPPORTED_UPSTREAM.has('randomfloat')).toBe(true);
  });

  it('covers every source-code leaf of the coverage doc', () => {
    expect(LEAVES).toHaveLength(57);
    const missing = LEAVES.filter((c) => !isNodeCovered(c));
    expect(missing).toEqual([]);
  });

  it('exposes closures and expr lowerings with the correct kind', () => {
    expect(getNodeLowering('add')?.kind).toBe('expr');
    expect(getNodeLowering('dielectric_bsdf')?.kind).toBe('closure');
    expect(getNodeLowering('randomcolor')?.kind).toBe('expr');
    expect(getNodeLowering('grid')?.kind).toBe('expr');
    expect(getNodeLowering('crosshatch')?.kind).toBe('expr');
    expect(getNodeLowering('tiledcircles')?.kind).toBe('expr');
    expect(getNodeLowering('tiledcloverleafs')?.kind).toBe('expr');
    expect(getNodeLowering('hexagon')?.kind).toBe('expr');
    expect(getNodeLowering('tiledhexagons')?.kind).toBe('expr');
    expect(getNodeLowering('line')?.kind).toBe('expr');
    expect(getNodeLowering('cloverleaf')?.kind).toBe('expr');
    expect(getNodeLowering('nonexistent')).toBeUndefined();
  });

  it('coveredCategories lists registry plus primitive-lowered nodes', () => {
    const all = coveredCategories();
    expect(all).toContain('image');
    expect(all).toContain('layer');
    expect(all).toContain('displacement');
    expect(all.length).toBe(NODE_REGISTRY.size + 6);
  });
});
