// T057j: the PT texture registry collects every graph-backed material's
// texture/sampler bindings into one sequential layout and deduplicates the
// underlying images by file reference, so materials that sample the same file
// share a single decoded GPU texture. These tests build image-backed surface
// variants as plain data and assert the dedup and binding layout.
import { describe, expect, it } from 'vitest';
import { buildTextureRegistry } from '../../../src/render/pathtracing/texture-registry.ts';
import { emitSurfaceVariant } from '../../../src/compiler/surface-wgsl.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedInput, ResolvedNode } from '../../../src/materialx/graph.ts';
import type { WgslBinding } from '../../../src/compiler/wgsl.ts';

/** standard_surface whose base_color samples an image node reading `file`. */
function imageSurface(file: string, colorSpace?: string): { graph: ResolvedGraph; surface: ReturnType<typeof resolveSurface> } {
  const fileInput: ResolvedInput = {
    name: 'file',
    type: 'filename',
    source: { kind: 'value', value: file, type: 'filename' },
    provenance: { namePath: '/mat/tex/file' },
    ...(colorSpace !== undefined ? { colorSpace } : {}),
  };
  const tex: ResolvedNode = {
    id: 'tex',
    category: 'image',
    type: 'color3',
    inputs: [fileInput],
    provenance: { namePath: '/mat/tex' },
  };
  const surfaceNode: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'tex' }, provenance: { namePath: '/mat/base_color' } },
    ],
    provenance: { namePath: '/mat/SR' },
  };
  const graph: ResolvedGraph = {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode], ['tex', tex]]),
  };
  return { graph, surface: resolveSurface(graph) };
}

function variant(file: string, index: number, colorSpace?: string) {
  const { graph, surface } = imageSurface(file, colorSpace);
  expect(surface).not.toBeNull();
  return emitSurfaceVariant(graph, surface!, index);
}

describe('buildTextureRegistry (T057j)', () => {
  it('does not share fileless resources or views with incompatible texture kinds', () => {
    const a = variant('shared.png', 0);
    const b = variant('shared.png', 1);
    const c = variant('shared.png', 2);
    const d = variant('shared.png', 3);
    const e = variant('shared.png', 4);
    b.textures[0]!.textureKind = 'udim';
    c.textures[0]!.textureKind = 'udim-index';
    delete d.textures[0]!.fileRef;
    delete e.textures[0]!.fileRef;
    const reg = buildTextureRegistry([a, b, c, d, e]);
    expect(reg.textures).toHaveLength(5);
    expect(reg.images).toEqual(['shared.png', undefined, undefined]);
    expect(reg.textureImage).toEqual([0, 0, 0, 1, 2]);
    expect(reg.bindingAliases?.has(b.textures[0]!.handle)).toBe(false);
    expect(reg.bindingAliases?.has(e.textures[0]!.handle)).toBe(false);
  });

  it('shares samplers by effective GPU settings while preserving incompatible modes', () => {
    const modes: Array<WgslBinding['sampler']> = [
      undefined, { addressU: 'periodic', addressV: 'periodic', filter: 'linear' },
      { addressU: 'periodic', filter: 'cubic' },
      { addressU: 'clamp' }, { addressU: 'constant' },
      { addressV: 'mirror' }, { filter: 'closest' },
    ];
    const variants = modes.map((mode, index) => {
      const v = variant(`image-${index}.jpg`, index);
      if (mode === undefined) delete v.samplers[0]!.sampler;
      else v.samplers[0]!.sampler = mode;
      return v;
    });
    const reg = buildTextureRegistry(variants);
    expect(reg.textures).toHaveLength(7);
    expect(reg.samplers).toHaveLength(4);
    expect(reg.samplers.map(s => s.binding)).toEqual([0, 1, 2, 3]);
    expect(reg.bindingAliases?.get('m1_samp_tex')).toBe('m0_samp_tex');
    expect(reg.bindingAliases?.get('m2_samp_tex')).toBe('m0_samp_tex');
    expect(reg.bindingAliases?.get('m4_samp_tex')).toBe('m3_samp_tex');
    expect(reg.bindingAliases?.has('m5_samp_tex')).toBe(false);
    expect(reg.bindingAliases?.has('m6_samp_tex')).toBe(false);
  });

  it('collects every variant texture into a sequential group-1 layout', () => {
    const reg = buildTextureRegistry([variant('brick.png', 0), variant('wood.png', 1)]);
    expect(reg.textures).toHaveLength(2);
    expect(reg.textures.map((t) => t.group)).toEqual([1, 1]);
    expect(reg.textures.map((t) => t.binding)).toEqual([0, 1]);
    // Per-material handles stay namespaced so the variant fill functions keep
    // referencing their own bindings.
    expect(reg.textures[0]!.handle).toBe('m0_tex_tex');
    expect(reg.textures[1]!.handle).toBe('m1_tex_tex');
  });

  it('shares identical samplers even across different images', () => {
    const reg = buildTextureRegistry([variant('brick.png', 0), variant('wood.png', 1)]);
    expect(reg.samplers).toHaveLength(1);
    expect(reg.samplers.map((s) => s.group)).toEqual([2]);
    expect(reg.samplers.map((s) => s.binding)).toEqual([0]);
    expect(reg.bindingAliases?.get('m1_samp_tex')).toBe('m0_samp_tex');
  });

  it('deduplicates images shared across materials by file reference', () => {
    // Two materials sampling the same file share one decoded image.
    const reg = buildTextureRegistry([variant('brick.png', 0), variant('brick.png', 1)]);
    expect(reg.textures).toHaveLength(1);
    expect(reg.images).toEqual(['brick.png']);
    expect(reg.textureImage).toEqual([0]);
    expect(reg.bindingAliases?.get('m1_tex_tex')).toBe('m0_tex_tex');
  });

  it('keeps distinct files on separate image slots', () => {
    const reg = buildTextureRegistry([variant('brick.png', 0), variant('wood.png', 1)]);
    expect(reg.images).toEqual(['brick.png', 'wood.png']);
    expect(reg.textureImage).toEqual([0, 1]);
  });

  it('preserves per-binding color spaces when the same file is sampled as color and data', () => {
    const reg = buildTextureRegistry([
      variant('shared.png', 0, 'srgb_texture'),
      variant('shared.png', 1, 'lin_rec709'),
      variant('shared.png', 2),
    ]);
    expect(reg.images).toEqual(['shared.png']);
    expect(reg.textureImage).toEqual([0, 0]);
    expect(reg.textures.map((t) => t.colorSpace)).toEqual(['srgb_texture', 'lin_rec709']);
    expect(reg.bindingAliases?.get('m2_tex_tex')).toBe('m1_tex_tex');
  });

  it('is empty for materials without textures', () => {
    const reg = buildTextureRegistry([]);
    expect(reg.textures).toEqual([]);
    expect(reg.samplers).toEqual([]);
    expect(reg.images).toEqual([]);
    expect(reg.textureImage).toEqual([]);
  });
});
