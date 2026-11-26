import { describe, expect, it } from 'vitest';
import { ScriptLibrary } from '../../src/materialx/script-api.ts';
import { nodePreviewScript } from '../../src/materialx/node-preview.ts';
import type { ResolvedGraph, ResolvedNode } from '../../src/materialx/graph.ts';

const library = ScriptLibrary.fromXml([`<materialx version="1.39">
  <nodedef name="ND_constant_float" node="constant" type="float">
    <input name="value" type="float" value="0.5"/><output name="out" type="float"/>
  </nodedef>
  <nodedef name="ND_mix_float" node="mix" type="float">
    <input name="fg" type="float"/><input name="bg" type="float"/><output name="out" type="float"/>
  </nodedef>
  <nodedef name="ND_standard_surface" node="standard_surface" type="surfaceshader">
    <input name="base" type="float" value="1"/><output name="out" type="surfaceshader"/>
  </nodedef>
  <nodedef name="ND_surfacematerial" node="surfacematerial" type="material">
    <input name="surfaceshader" type="surfaceshader"/><output name="out" type="material"/>
  </nodedef>
</materialx>`]);

function node(
  id: string, category: string, def: string, type: string, inputs: ResolvedNode['inputs'],
): ResolvedNode {
  return {
    id, category, type,
    nodeDef: {
      name: def, nodeString: category, type, implementation: { kind: 'unresolved' },
      inputs: inputs.map(input => ({ name: input.name, type: input.type })),
      outputs: [{ name: 'out', type }],
    },
    inputs,
    provenance: { namePath: id },
  };
}

describe('node output previews', () => {
  it('rebuilds the selected output and its ancestors, excluding unrelated graph nodes', () => {
    const graph: ResolvedGraph = {
      terminals: [],
      nodes: new Map([
        ['/mat/constant', node('/mat/constant', 'constant', 'ND_constant_float', 'float', [
          { name: 'value', type: 'float', source: { kind: 'value', type: 'float', value: '0.25' }, provenance: { namePath: '/mat/constant/value' } },
        ])],
        ['/mat/mix', node('/mat/mix', 'mix', 'ND_mix_float', 'float', [
          { name: 'fg', type: 'float', source: { kind: 'connection', nodeId: '/mat/constant' }, provenance: { namePath: '/mat/mix/fg' } },
          { name: 'bg', type: 'float', source: { kind: 'value', type: 'float', value: '0.75' }, provenance: { namePath: '/mat/mix/bg' } },
        ])],
        ['/mat/unrelated', node('/mat/unrelated', 'constant', 'ND_constant_float', 'float', [
          { name: 'value', type: 'float', source: { kind: 'value', type: 'float', value: '0.9' }, provenance: { namePath: '/mat/unrelated/value' } },
        ])],
      ]),
    };

    const script = nodePreviewScript(graph, '/mat/mix', 'out', library);
    expect(script).toContain('constant = new Constant();');
    expect(script).toContain('mix.fg = constant.out;');
    expect(script).toContain('mxPreviewShader.base = mix.out;');
    expect(script).toContain('mxPreviewSphere.material = mxPreviewMaterial;');
    expect(script).not.toContain('unrelated');
  });
});
