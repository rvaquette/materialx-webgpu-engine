import { describe, expect, it } from 'vitest';
import { buildRasterFrameGraph, type RenderItem } from '../../../src/render/raster/renderer.ts';
import type { FeatureFlags } from '../../../src/compiler/features.ts';

function flags(overrides: Partial<FeatureFlags> = {}): FeatureFlags {
  return {
    hasBsdf: true,
    hasEdf: false,
    hasVdf: false,
    hasBssrdf: false,
    transparency: false,
    transmission: false,
    coat: false,
    anisotropy: false,
    thinFilm: false,
    subsurface: false,
    volume: false,
    displacement: false,
    needsTangentFrame: false,
    ...overrides,
  };
}

function item(id: string, overrides: Partial<FeatureFlags> = {}): RenderItem {
  return { id, flags: flags(overrides) };
}

function kinds(graph: ReturnType<typeof buildRasterFrameGraph>): string[] {
  return graph.passes.map((p) => p.kind);
}

describe('buildRasterFrameGraph', () => {
  it('emits only depth, opaque and HDR for a plain opaque scene', () => {
    const graph = buildRasterFrameGraph({ items: [item('a')] });
    expect(kinds(graph)).toEqual(['depthPrepass', 'opaque', 'hdrResolve']);
    expect(graph.colorFormat).toBe('rgba16float');
    expect(graph.shadows).toHaveLength(0);
  });

  it('adds a cascaded shadow pass for a distant light', () => {
    const graph = buildRasterFrameGraph({
      items: [item('a')],
      lights: [{ path: '/Sun', type: 'distant' }],
      shadowCascades: 3,
    });
    expect(kinds(graph)).toContain('shadow');
    expect(graph.shadows).toEqual([{ light: '/Sun', type: 'distant', cascades: 3 }]);
  });

  it('does not create shadows for a dome light', () => {
    const graph = buildRasterFrameGraph({ items: [item('a')], lights: [{ path: '/Env', type: 'dome' }] });
    expect(kinds(graph)).not.toContain('shadow');
  });

  it('orders feature passes after opaque and declares approximations', () => {
    const graph = buildRasterFrameGraph({
      items: [
        item('op'),
        item('glass', { transmission: true }),
        item('leaf', { transparency: true }),
        item('skin', { subsurface: true }),
        item('smoke', { volume: true }),
      ],
    });
    expect(kinds(graph)).toEqual([
      'depthPrepass',
      'opaque',
      'subsurface',
      'transmission',
      'transparency',
      'volume',
      'hdrResolve',
    ]);
    expect(graph.approximations.length).toBeGreaterThan(0);
    expect(graph.approximations).toEqual([...graph.approximations].sort());
  });

  it('keeps subsurface items in the opaque pass but volume items out of it', () => {
    const graph = buildRasterFrameGraph({ items: [item('skin', { subsurface: true }), item('smoke', { volume: true })] });
    const opaque = graph.passes.find((p) => p.kind === 'opaque')!;
    const depth = graph.passes.find((p) => p.kind === 'depthPrepass')!;
    expect(opaque.draws).toContain('skin');
    expect(opaque.draws).not.toContain('smoke');
    expect(depth.draws).not.toContain('smoke');
  });
});
