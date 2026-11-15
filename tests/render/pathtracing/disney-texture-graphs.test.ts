import { describe, expect, it } from 'vitest';
import type { ResolvedGraph, ResolvedInput, ResolvedNode } from '../../../src/materialx/graph.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import { disneyAlbedoTexture, disneyMetallicRoughnessTexture } from '../../../src/render/pathtracing/disney-texture-graphs.ts';
import { disneyMaterialFromStandard } from '../../../src/render/pathtracing/disney-standard-material.ts';

const provenance = { namePath: 'fixture' };
const value = (name: string, type: string, text: string): ResolvedInput => ({
  name, type, source: { kind: 'value', type, value: text }, provenance,
});
const link = (name: string, type: string, nodeId: string, output?: string): ResolvedInput => ({
  name, type, source: { kind: 'connection', nodeId, ...(output ? { output } : {}) }, provenance,
});
function graphFixture(): ResolvedGraph {
  const make = (id: string, category: string, type: string, inputs: ResolvedInput[]): ResolvedNode => ({
    id, category, type, inputs, provenance,
  });
  const image = (id: string): ResolvedNode => ({
    ...make(id, 'image', 'color3', [value('file', 'filename', `${id}.png`)]),
    nodeDef: {
      name: 'image', nodeString: 'image', type: 'color3', implementation: { kind: 'unresolved' },
      inputs: [
        { name: 'texcoord', type: 'vector2', geomprop: 'UV0' },
        { name: 'uaddressmode', type: 'string', value: 'periodic' },
        { name: 'vaddressmode', type: 'string', value: 'periodic' },
        { name: 'filtertype', type: 'string', value: 'linear' },
      ],
    },
  });
  const nodes = [
    make('surface', 'standard_surface', 'surfaceshader', [
      link('base_color', 'color3', 'factor'), link('metalness', 'float', 'channels', 'outz'),
      link('specular_roughness', 'float', 'floor'), link('diffuse_roughness', 'float', 'square'),
    ]),
    make('factor', 'multiply', 'color3', [link('in1', 'color3', 'gamma'), value('in2', 'color3', '0.5, 0.7, 1')]),
    make('gamma', 'power', 'color3', [link('in1', 'color3', 'albedo'), value('in2', 'color3', '2.2, 2.2, 2.2')]),
    image('albedo'), image('metalrough'),
    make('channels', 'separate3', 'multioutput', [link('in', 'color3', 'metalrough')]),
    make('floor', 'max', 'float', [link('in1', 'float', 'channels', 'outy'), value('in2', 'float', '0.0316227766017')]),
    make('square', 'multiply', 'float', [link('in1', 'float', 'floor'), link('in2', 'float', 'floor')]),
  ];
  return { terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: 'surface', provenance }], nodes: new Map(nodes.map(n => [n.id, n])) };
}

describe('Disney texture graph conversion', () => {
  it('recognizes the albedo and metallic/roughness graphs of the compiled pathtracer scenes', () => {
    const graph = graphFixture();
    const surface = resolveSurface(graph)!;
    const albedo = surface.inputs.get('base_color')!.source;
    if (albedo.kind !== 'connection') throw new Error('Invalid test fixture');
    expect(disneyAlbedoTexture(graph, albedo)).toEqual({ file: 'albedo.png', factor: [0.5, 0.7, 1] });
    expect(disneyMetallicRoughnessTexture(graph, surface)).toBe('metalrough.png');
  });

  it('converts the graph into a Disney material with assigned texture layers', () => {
    const graph = graphFixture();
    const layers: string[] = [];
    const result = disneyMaterialFromStandard(resolveSurface(graph)!, graph, [], (file, usage) => {
      layers.push(`${usage}:${file}`);
      return layers.length - 1;
    });
    expect(layers).toEqual(['albedo:albedo.png', 'metallic-roughness:metalrough.png']);
    expect(result.material.baseColor).toEqual([0.5, 0.7, 1]);
    expect(result.material.textures).toEqual([0, 1, -1, -1]);
    expect(result.warnings.join(' ')).toContain('approximated');
    expect(result.warnings.join(' ')).toContain('nearest-texel');
    expect(() => disneyMaterialFromStandard(resolveSurface(graph)!, graph)).toThrow('Missing Disney texture layer');
  });

  it('does not silently mix opacity with the albedo texture alpha', () => {
    const graph = graphFixture();
    graph.nodes.get('surface')!.inputs.push(value('opacity', 'color3', '0.5, 0.5, 0.5'));
    expect(() => disneyMaterialFromStandard(resolveSurface(graph)!, graph, [], () => 0)).toThrow('albedo texture alpha');
  });

  it('rejects altered channel wiring or roughness floors', () => {
    const graph = graphFixture();
    const floor = graph.nodes.get('floor')!;
    floor.inputs[0] = link('in1', 'float', 'channels', 'outz');
    expect(() => disneyMetallicRoughnessTexture(graph, resolveSurface(graph)!)).toThrow('channels or roughness floor differ');
    floor.inputs[0] = link('in1', 'float', 'channels', 'outy');
    floor.inputs[1] = value('in2', 'float', '0.5');
    expect(() => disneyMetallicRoughnessTexture(graph, resolveSurface(graph)!)).toThrow('channels or roughness floor differ');
  });

  it('rejects a separate diffuse roughness or unexpected image color conversion', () => {
    const graph = graphFixture();
    graph.nodes.get('square')!.inputs[1] = link('in2', 'float', 'channels', 'outy');
    expect(() => disneyMetallicRoughnessTexture(graph, resolveSurface(graph)!)).toThrow('diffuse roughness differs');
    const albedo = graph.nodes.get('albedo')!.inputs[0]!;
    albedo.colorSpace = 'srgb_texture';
    expect(() => disneyAlbedoTexture(graph, { kind: 'connection', nodeId: 'factor' })).toThrow('unsupported file or color space');
  });

  it('rejects URL-encoded UDIM textures', () => {
    const graph = graphFixture();
    graph.nodes.get('albedo')!.inputs[0] = value('file', 'filename', 'texture.%3CUDIM%3E.png');
    expect(() => disneyAlbedoTexture(graph, { kind: 'connection', nodeId: 'factor' })).toThrow('unsupported file');
  });

  it('rejects changed gamma, sampling, and live graph parameters', () => {
    const graph = graphFixture();
    const source = { kind: 'connection' as const, nodeId: 'factor' };
    const power = graph.nodes.get('gamma')!;
    power.inputs[1] = value('in2', 'color3', '1, 1, 1');
    expect(() => disneyAlbedoTexture(graph, source)).toThrow('unexpected albedo exponent');
    power.inputs[1] = value('in2', 'color3', '2.2, 2.2, 2.2');
    graph.nodes.get('albedo')!.inputs.push(value('uaddressmode', 'string', 'clamp'));
    expect(() => disneyAlbedoTexture(graph, source)).toThrow('unexpected inputs');
    graph.nodes.get('albedo')!.inputs.pop();
    graph.nodes.get('factor')!.inputs[1]!.parameter = 'factor';
    expect(() => disneyAlbedoTexture(graph, source)).toThrow('editable input');
  });
});
