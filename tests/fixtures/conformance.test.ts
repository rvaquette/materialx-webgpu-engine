import { describe, expect, it } from 'vitest';
import inventory from './materialx-nodes.json' with { type: 'json' };
import control from './control-scenes.json' with { type: 'json' };

const KNOWN_FAMILIES = ['StandardSurface', 'OpenPbr', 'DisneyPrincipled', 'GltfPbr', 'UsdPreviewSurface', 'SimpleHair'];

// Node categories observed in the corpus (structural XML elements excluded).
const EXPECTED_CATEGORIES = [
  'standard_surface', 'open_pbr_surface', 'disney_principled', 'gltf_pbr', 'UsdPreviewSurface', 'surface', 'simple_hair',
  'chiang_hair_bsdf', 'chiang_hair_absorption_from_color', 'chiang_hair_roughness', 'deon_hair_absorption_from_melanin',
  'image', 'tiledimage', 'hextiledimage', 'gltf_image', 'gltf_colorimage', 'normalmap', 'gltf_normalmap',
  'place2d', 'texcoord', 'position',
  'add', 'subtract', 'multiply', 'divide', 'power', 'max', 'clamp', 'sin', 'dotproduct', 'mix',
  'hsvtorgb', 'rgbtohsv', 'convert', 'constant',
  'combine3', 'separate3', 'extract',
  'fractal3d',
].sort();

const LEVELS = new Set(['supported', 'reference', 'approximated']);

describe('MaterialX node inventory', () => {
  it('declares the known corpus families', () => {
    expect([...inventory.families].sort()).toEqual([...KNOWN_FAMILIES].sort());
  });

  it('covers exactly the corpus node categories without duplicates', () => {
    const categories = inventory.nodes.map((n) => n.category);
    expect(new Set(categories).size).toBe(categories.length);
    expect([...categories].sort()).toEqual(EXPECTED_CATEGORIES);
  });

  it('assigns each node to known families and valid support levels', () => {
    for (const node of inventory.nodes) {
      expect(node.families.length).toBeGreaterThan(0);
      for (const fam of node.families) expect(KNOWN_FAMILIES).toContain(fam);
      expect(LEVELS.has(node.raster)).toBe(true);
      expect(LEVELS.has(node.pathtracing)).toBe(true);
    }
  });

  it('never marks a node as raster reference (reference is path tracing only)', () => {
    for (const node of inventory.nodes) expect(node.raster).not.toBe('reference');
  });

  it('keeps hair BSDF as a declared raster approximation and a path-tracing reference', () => {
    const hair = inventory.nodes.find((n) => n.category === 'chiang_hair_bsdf');
    expect(hair?.raster).toBe('approximated');
    expect(hair?.pathtracing).toBe('reference');
  });
});

describe('control scenes', () => {
  it('uses a fixed deterministic camera, light and sampler', () => {
    expect(control.resolution.width).toBeGreaterThan(0);
    expect(control.sampler.seed).toBeTypeOf('number');
    expect(control.sampler.samplesPerPixel).toBeGreaterThan(0);
    expect(control.light.type).toBe('directional');
  });

  it('has unique scene ids referencing known families', () => {
    const ids = control.scenes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scene of control.scenes) expect(KNOWN_FAMILIES).toContain(scene.family);
  });

  it('references corpus materials under the correct family folder', () => {
    for (const scene of control.scenes) {
      expect(scene.material.startsWith(`${scene.family}/`)).toBe(true);
      expect(scene.material.endsWith('.mtlx')).toBe(true);
    }
  });

  it('declares at least one valid backend per scene', () => {
    const backends = new Set(['raster', 'pathtracing', 'hybrid']);
    for (const scene of control.scenes) {
      expect(scene.backends.length).toBeGreaterThan(0);
      for (const b of scene.backends) expect(backends.has(b)).toBe(true);
    }
  });

  it('covers every corpus family with a control scene', () => {
    const covered = new Set(control.scenes.map((s) => s.family));
    for (const fam of KNOWN_FAMILIES) expect(covered.has(fam)).toBe(true);
  });

  it('routes spectral thin-film and hair controls through the path tracer', () => {
    const special = control.scenes.filter(
      (s) => s.focus.includes('thin_film') || s.focus.includes('spectral') || s.focus.includes('hair'),
    );
    expect(special.length).toBeGreaterThan(0);
    for (const scene of special) expect(scene.backends).toContain('pathtracing');
  });
});
