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

  it('pairs samplers into a sequential group-2 layout', () => {
    const reg = buildTextureRegistry([variant('brick.png', 0), variant('wood.png', 1)]);
    expect(reg.samplers).toHaveLength(2);
    expect(reg.samplers.map((s) => s.group)).toEqual([2, 2]);
    expect(reg.samplers.map((s) => s.binding)).toEqual([0, 1]);
  });

  it('deduplicates images shared across materials by file reference', () => {
    // Two materials sampling the same file share one decoded image.
    const reg = buildTextureRegistry([variant('brick.png', 0), variant('brick.png', 1)]);
    expect(reg.textures).toHaveLength(2);
    expect(reg.images).toEqual(['brick.png']);
    expect(reg.textureImage).toEqual([0, 0]);
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
    expect(reg.textureImage).toEqual([0, 0, 0]);
    expect(reg.textures.map((t) => t.colorSpace)).toEqual(['srgb_texture', 'lin_rec709', undefined]);
  });

  it('is empty for materials without textures', () => {
    const reg = buildTextureRegistry([]);
    expect(reg.textures).toEqual([]);
    expect(reg.samplers).toEqual([]);
    expect(reg.images).toEqual([]);
    expect(reg.textureImage).toEqual([]);
  });
});
