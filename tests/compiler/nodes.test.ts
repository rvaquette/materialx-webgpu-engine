import { describe, it, expect } from 'vitest';
import { coveredCategories, getNodeLowering, isNodeCovered, NODE_REGISTRY } from '../../src/compiler/nodes.ts';

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
  it('covers every source-code leaf of the coverage doc', () => {
    expect(LEAVES).toHaveLength(57);
    const missing = LEAVES.filter((c) => !isNodeCovered(c));
    expect(missing).toEqual([]);
  });

  it('exposes closures and expr lowerings with the correct kind', () => {
    expect(getNodeLowering('add')?.kind).toBe('expr');
    expect(getNodeLowering('dielectric_bsdf')?.kind).toBe('closure');
    expect(getNodeLowering('nonexistent')).toBeUndefined();
  });

  it('coveredCategories lists registry plus primitive-lowered nodes', () => {
    const all = coveredCategories();
    expect(all).toContain('image');
    expect(all).toContain('layer');
    expect(all.length).toBe(NODE_REGISTRY.size + 5);
  });
});
