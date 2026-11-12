import { describe, expect, it } from 'vitest';
import { composeSurfaceLayered, evaluateSurfaceToLayered, prepareSurface } from '../../src/compiler/surface-eval.ts';
import { surfaceGraphToLayered } from '../../src/compiler/surface-lower.ts';
import { resolveSurface } from '../../src/materialx/surface-graph.ts';
import type { ResolvedGraph, ResolvedNode } from '../../src/materialx/graph.ts';
import { createImageSampler } from '../../src/render/pathtracing/texture-sample.ts';
import type { DecodedPixelImage } from '../../src/assets/images.ts';

const BRICK: [number, number, number] = [0.661876, 0.19088, 0];

/** standard_surface whose base_color is driven by a connected constant node. */
function brickGraph(): ResolvedGraph {
  const surfaceNode: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'connection', nodeId: 'brick' }, provenance: { namePath: '/mat/base_color' } },
    ],
    provenance: { namePath: '/mat/SR' },
  };
  const brick: ResolvedNode = {
    id: 'brick',
    category: 'constant',
    type: 'color3',
    inputs: [
      { name: 'value', type: 'color3', source: { kind: 'value', value: '0.661876, 0.19088, 0', type: 'color3' }, provenance: { namePath: '/mat/brick/value' } },
    ],
    provenance: { namePath: '/mat/brick' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode], ['brick', brick]]),
  };
}

/** standard_surface with a constant literal base_color (no connection). */
function constantGraph(): ResolvedGraph {
  const surfaceNode: ResolvedNode = {
    id: 'SR',
    category: 'standard_surface',
    type: 'surfaceshader',
    inputs: [
      { name: 'base_color', type: 'color3', source: { kind: 'value', value: '0.2, 0.4, 0.6', type: 'color3' }, provenance: { namePath: '/mat/base_color' } },
    ],
    provenance: { namePath: '/mat/SR' },
  };
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode]]),
  };
}

const diffuse = (c: ReturnType<typeof surfaceGraphToLayered>) => c.lobes.find((l) => l.kind === 'burley_diffuse')!;

describe('evaluateSurfaceToLayered (T057i3)', () => {
  it('keeps a connected LamaDiffuse closure intact through CPU preparation', () => {
    const root: ResolvedNode = {
      id: 'SR', category: 'surface', type: 'surfaceshader',
      inputs: [
        { name: 'bsdf', type: 'BSDF', source: { kind: 'connection', nodeId: 'diffuse' }, provenance: { namePath: '/mat/bsdf' } },
      ],
      provenance: { namePath: '/mat/SR' },
    };
    const diffuseNode: ResolvedNode = {
      id: 'diffuse', category: 'LamaDiffuse', type: 'BSDF',
      inputs: [
        { name: 'color', type: 'color3', source: { kind: 'value', value: '0.2, 0.3, 0.4', type: 'color3' }, provenance: { namePath: '/mat/diffuse/color' } },
        { name: 'roughness', type: 'float', source: { kind: 'value', value: '0.6', type: 'float' }, provenance: { namePath: '/mat/diffuse/roughness' } },
      ],
      provenance: { namePath: '/mat/diffuse' },
    };
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
      nodes: new Map([['SR', root], ['diffuse', diffuseNode]]),
    };
    const surface = resolveSurface(graph)!;
    const closure = evaluateSurfaceToLayered(graph, surface);
    expect(closure.lobes[0]).toMatchObject({ kind: 'oren_nayar_diffuse', color: [0.2, 0.3, 0.4], roughness: 0.18, energyCompensation: 1 });
  });

  it('evaluates a connected Lama BSDF color on the CPU', () => {
    const root: ResolvedNode = {
      id: 'SR', category: 'surface', type: 'surfaceshader',
      inputs: [{ name: 'bsdf', type: 'BSDF', source: { kind: 'connection', nodeId: 'diffuse' }, provenance: { namePath: '/mat/bsdf' } }],
      provenance: { namePath: '/mat/SR' },
    };
    const diffuseNode: ResolvedNode = {
      id: 'diffuse', category: 'LamaDiffuse', type: 'BSDF',
      inputs: [
        { name: 'color', type: 'color3', source: { kind: 'connection', nodeId: 'albedo' }, provenance: { namePath: '/mat/diffuse/color' } },
        { name: 'roughness', type: 'float', source: { kind: 'value', value: '0.25', type: 'float' }, provenance: { namePath: '/mat/diffuse/roughness' } },
      ],
      provenance: { namePath: '/mat/diffuse' },
    };
    const albedo: ResolvedNode = {
      id: 'albedo', category: 'constant', type: 'color3',
      inputs: [{ name: 'value', type: 'color3', source: { kind: 'value', value: '0.7, 0.2, 0.1', type: 'color3' }, provenance: { namePath: '/mat/albedo/value' } }],
      provenance: { namePath: '/mat/albedo' },
    };
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
      nodes: new Map([['SR', root], ['diffuse', diffuseNode], ['albedo', albedo]]),
    };
    const closure = evaluateSurfaceToLayered(graph, resolveSurface(graph)!);
    expect(closure.lobes[0]).toMatchObject({ kind: 'oren_nayar_diffuse', color: [0.7, 0.2, 0.1], roughness: 0.03125, energyCompensation: 1 });
  });

  it('selects LamaSurface materialBack for a back-facing CPU view', () => {
    const front: ResolvedNode = {
      id: 'front', category: 'LamaDiffuse', type: 'BSDF',
      inputs: [{ name: 'color', type: 'color3', source: { kind: 'value', value: '0.8, 0.1, 0.1', type: 'color3' }, provenance: { namePath: '/mat/front/color' } }],
      provenance: { namePath: '/mat/front' },
    };
    const back: ResolvedNode = {
      id: 'back', category: 'LamaSheen', type: 'BSDF',
      inputs: [{ name: 'color', type: 'color3', source: { kind: 'value', value: '0.1, 0.2, 0.8', type: 'color3' }, provenance: { namePath: '/mat/back/color' } }],
      provenance: { namePath: '/mat/back' },
    };
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'front', provenance: { namePath: '/mat/front' } }],
      nodes: new Map([['front', front], ['back', back]]), lamaSurface: { backNodeId: 'back' },
    };
    const surface = resolveSurface(graph)!;
    const closure = evaluateSurfaceToLayered(graph, surface, { normal: [0, 0, 1], viewDir: [0, 0, -1] });
    expect(closure.sheen).toMatchObject({ color: [0.1, 0.2, 0.8] });
  });

  it('rotates Lama anisotropyDirection relative to the evaluated tangent', () => {
    const root: ResolvedNode = {
      id: 'SR', category: 'surface', type: 'surfaceshader',
      inputs: [{ name: 'bsdf', type: 'BSDF', source: { kind: 'connection', nodeId: 'metal' }, provenance: { namePath: '/mat/bsdf' } }],
      provenance: { namePath: '/mat/SR' },
    };
    const metal: ResolvedNode = {
      id: 'metal', category: 'LamaConductor', type: 'BSDF',
      inputs: [
        { name: 'anisotropy', type: 'float', source: { kind: 'value', value: '0.5', type: 'float' }, provenance: { namePath: '/mat/metal/aniso' } },
        { name: 'anisotropyDirection', type: 'vector3', source: { kind: 'value', value: '0, 1, 0', type: 'vector3' }, provenance: { namePath: '/mat/metal/direction' } },
      ],
      provenance: { namePath: '/mat/metal' },
    };
    const graph: ResolvedGraph = {
      terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
      nodes: new Map([['SR', root], ['metal', metal]]),
    };
    const closure = evaluateSurfaceToLayered(graph, resolveSurface(graph)!, {
      normal: [0, 0, 1], tangent: [1, 0, 0],
    });
    expect(closure.lobes[0]?.rotation).toBeCloseTo(0.25, 6);
  });

  it('evaluates a connected procedural base_color instead of the nodedef default', () => {
    const graph = brickGraph();
    const surface = resolveSurface(graph, {})!;
    expect(surface).not.toBeNull();
    const closure = evaluateSurfaceToLayered(graph, surface);
    const lobe = diffuse(closure);
    expect(lobe.color[0]).toBeCloseTo(BRICK[0], 5);
    expect(lobe.color[1]).toBeCloseTo(BRICK[1], 5);
    expect(lobe.color[2]).toBeCloseTo(BRICK[2], 5);
    // Not the white nodedef default that the pre-i3 constant lowering fell back to.
    expect(lobe.color[0]).not.toBeCloseTo(1, 3);
  });

  it('lowers a constant surface byte-identically to surfaceGraphToLayered (non-regression)', () => {
    const graph = constantGraph();
    const surface = resolveSurface(graph, {})!;
    const composed = composeSurfaceLayered(prepareSurface(graph, surface));
    const direct = surfaceGraphToLayered(surface);
    expect(composed).toEqual(direct);
  });

  it('prepares once and composes at several shading points', () => {
    const graph = brickGraph();
    const surface = resolveSurface(graph, {})!;
    const prepared = prepareSurface(graph, surface);
    const a = composeSurfaceLayered(prepared, { texcoord: [0, 0] });
    const b = composeSurfaceLayered(prepared, { texcoord: [1, 1] });
    // base_color is constant math here, so the two points agree.
    expect(diffuse(a).color).toEqual(diffuse(b).color);
    expect(diffuse(a).color[0]).toBeCloseTo(BRICK[0], 5);
  });
});

/** standard_surface whose base_color samples an image node reading `file`. */
function imageGraph(): ResolvedGraph {
  const tex: ResolvedNode = {
    id: 'tex',
    category: 'image',
    type: 'color3',
    inputs: [
      { name: 'file', type: 'filename', source: { kind: 'value', value: 'brick.png', type: 'filename' }, provenance: { namePath: '/mat/tex/file' } },
    ],
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
  return {
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'SR', provenance: { namePath: '/mat/SR' } }],
    nodes: new Map<string, ResolvedNode>([['SR', surfaceNode], ['tex', tex]]),
  };
}

/** 2x2 RGB image: red, green, blue, white (row-major). */
function checker(): DecodedPixelImage {
  return {
    kind: 'pixels',
    data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]),
    componentType: 'uint8',
    channels: 3,
    width: 2,
    height: 2,
    colorSpace: 'lin_rec709',
  };
}

describe('composeSurfaceLayered texture sampling (T057k)', () => {
  it.each(['direct', 'surface'] as const)('evaluates LamaSheen image color and procedural roughness on a %s terminal', terminal => {
    const graph = imageGraph();
    const provenance = { namePath: '/mat/sheen' };
    const sheenNode: ResolvedNode = {
      id: 'sheen', category: 'LamaSheen', type: 'BSDF', provenance,
      nodeDef: {
        name: 'ND_lama_sheen', nodeString: 'LamaSheen', type: 'BSDF',
        implementation: { kind: 'nodegraph', name: 'IMPL_lama_sheen' },
        inputs: [
          { name: 'color', type: 'color3', value: '1, 1, 1' },
          { name: 'roughness', type: 'float', value: '0.1' },
        ],
      },
      inputs: [
        { name: 'color', type: 'color3', source: { kind: 'connection', nodeId: 'tex' }, provenance },
        { name: 'roughness', type: 'float', source: { kind: 'connection', nodeId: 'roughness' }, provenance },
      ],
    };
    graph.nodes.set('roughness', {
      id: 'roughness', category: 'extract', type: 'float', provenance,
      inputs: [
        { name: 'in', type: 'color3', source: { kind: 'connection', nodeId: 'tex' }, provenance },
        { name: 'index', type: 'integer', source: { kind: 'value', type: 'integer', value: '0' }, provenance },
      ],
    });
    if (terminal === 'direct') {
      graph.nodes.set('SR', { ...sheenNode, id: 'SR' });
    } else {
      graph.nodes.set('sheen', sheenNode);
      graph.nodes.set('SR', {
        id: 'SR', category: 'surface', type: 'surfaceshader', provenance,
        inputs: [{ name: 'bsdf', type: 'BSDF', source: { kind: 'connection', nodeId: 'sheen' }, provenance }],
      });
    }
    const prepared = prepareSurface(graph, resolveSurface(graph)!);
    const textures = { tex: createImageSampler(checker()) };
    const red = composeSurfaceLayered(prepared, { texcoord: [0.25, 0.75], textures });
    const green = composeSurfaceLayered(prepared, { texcoord: [0.75, 0.75], textures });
    expect(red.sheen?.color).toEqual([1, 0, 0]);
    expect(red.sheen?.roughness).toBeCloseTo(1, 12);
    expect(green.sheen?.color).toEqual([0, 1, 0]);
    expect(green.sheen?.roughness).toBeCloseTo(0.01, 12);

    graph.nodes.set('tex', {
      id: 'tex', category: 'convert', type: 'color3', provenance,
      inputs: [{ name: 'in', type: 'vector3', source: { kind: 'connection', nodeId: 'position' }, provenance }],
    });
    graph.nodes.set('position', { id: 'position', category: 'position', type: 'vector3', inputs: [], provenance });
    const procedural = prepareSurface(graph, resolveSurface(graph)!);
    const a = composeSurfaceLayered(procedural, { position: [0.2, 0.4, 0.8] });
    const b = composeSurfaceLayered(procedural, { position: [0.8, 0.6, 0.2] });
    expect(a.sheen?.color).toEqual([0.2, 0.4, 0.8]);
    expect(a.sheen?.roughness).toBeCloseTo(0.0784, 12);
    expect(b.sheen?.color).toEqual([0.8, 0.6, 0.2]);
    expect(b.sheen?.roughness).toBeCloseTo(0.6724, 12);
  });

  it('drives base_color from a decoded texture sampled at the shading point', () => {
    const graph = imageGraph();
    const surface = resolveSurface(graph, {})!;
    expect(surface).not.toBeNull();
    const prepared = prepareSurface(graph, surface);
    const sampler = createImageSampler(checker());
    // Image-space V is inverted relative to the MaterialX texcoord.
    const red = composeSurfaceLayered(prepared, { texcoord: [0.25, 0.75], textures: { tex: sampler } });
    expect(diffuse(red).color[0]).toBeCloseTo(1, 5);
    expect(diffuse(red).color[1]).toBeCloseTo(0, 5);
    expect(diffuse(red).color[2]).toBeCloseTo(0, 5);
    // A different texcoord samples a different texel -> a different base_color.
    const green = composeSurfaceLayered(prepared, { texcoord: [0.75, 0.75], textures: { tex: sampler } });
    expect(diffuse(green).color[0]).toBeCloseTo(0, 5);
    expect(diffuse(green).color[1]).toBeCloseTo(1, 5);
  });

  it('falls back to the neutral value when no sampler is bound', () => {
    const graph = imageGraph();
    const surface = resolveSurface(graph, {})!;
    const prepared = prepareSurface(graph, surface);
    // Without a bound texture the sampled base_color collapses to zero (black).
    const closure = composeSurfaceLayered(prepared, { texcoord: [0.25, 0.25] });
    expect(diffuse(closure).color[0]).toBeCloseTo(0, 5);
    expect(diffuse(closure).color[1]).toBeCloseTo(0, 5);
    expect(diffuse(closure).color[2]).toBeCloseTo(0, 5);
  });
});
