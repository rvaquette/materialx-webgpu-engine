import { describe, expect, it } from 'vitest';
import { resolvedGraphFromParsedSurface } from '../../../src/materialx/surface-from-inputs.ts';
import { resolveSurface } from '../../../src/materialx/surface-graph.ts';
import { disneyMaterialFromStandard } from '../../../src/render/pathtracing/disney-standard-material.ts';
import { packDisneyMaterials } from '../../../src/render/pathtracing/disney-material.ts';
import type { MaterialParameter } from '../../../src/render/material-parameters.ts';

function convert(inputs: Record<string, number | readonly number[] | boolean>) {
  const graph = resolvedGraphFromParsedSurface({ category: 'standard_surface', inputs });
  return disneyMaterialFromStandard(resolveSurface(graph)!, graph);
}

describe('standard_surface to Disney', () => {
  it('maps perceptual roughness, coat, emission and alpha into the material record', () => {
    const result = convert({
      base_color: [1, 0.37, 0.013], specular_roughness: Math.sqrt(0.1), diffuse_roughness: 0.1,
      coat: 1, coat_roughness: Math.sqrt(0.001), emission: 2, emission_color: [1, 0.5, 0],
      opacity: [0.25, 0.5, 0.75],
    });
    expect(result.material.roughness).toBeCloseTo(0.1);
    expect(result.material.clearcoatGloss).toBeCloseTo(1);
    expect(result.material.emission).toEqual([2, 1, 0]);
    expect(result.material.opacity).toBe(0.5);
    expect(result.material.alphaMode).toBe(1);
    expect(result.warnings.join(' ')).toContain('Colored opacity');
    expect(packDisneyMaterials([result.material])).toHaveLength(32);
  });

  it('retains edited surface parameter values', () => {
    const graph = resolvedGraphFromParsedSurface({ category: 'standard_surface', inputs: {} });
    const surface = resolveSurface(graph)!;
    const result = disneyMaterialFromStandard(surface, graph, [{
      id: 'roughness', label: 'Roughness', type: 'float', value: [0.4], initial: [0.2],
      update: 'uniform', input: 'specular_roughness',
    }]);
    expect(result.material.roughness).toBeCloseTo(0.16);
  });

  it('uses the interpolated Mix value when converting editor nodes to Disney', () => {
    const graph = resolvedGraphFromParsedSurface({ category: 'standard_surface', inputs: { specular_roughness: 0.2 } });
    const rootId = graph.terminals.find(terminal => terminal.name === 'surfaceshader')!.nodeId!;
    const root = graph.nodes.get(rootId)!;
    const nodeId = 'specular_roughness_mix';
    graph.nodes.set(rootId, {
      ...root,
      inputs: root.inputs.map(input => input.name === 'specular_roughness'
        ? { ...input, source: { kind: 'connection', nodeId } } : input),
    });
    graph.nodes.set(nodeId, {
      id: nodeId, category: 'mix', type: 'float', provenance: { namePath: nodeId },
      inputs: [
        { name: 'bg', type: 'float', source: { kind: 'value', type: 'float', value: '0.2' }, provenance: { namePath: `${nodeId}/bg` } },
        { name: 'fg', type: 'float', source: { kind: 'value', type: 'float', value: '0.8' }, provenance: { namePath: `${nodeId}/fg` } },
        { name: 'mix', type: 'float', source: { kind: 'value', type: 'float', value: '0.5' }, provenance: { namePath: `${nodeId}/mix` } },
      ],
    });
    const original: MaterialParameter = {
      id: 'surface:specular_roughness', label: 'specular_roughness', type: 'float', value: [0.2], initial: [0.2],
      update: 'uniform', input: 'specular_roughness',
    };
    const parameters: MaterialParameter[] = [
      {
        id: `node:${nodeId}/fg`, label: `${nodeId} / fg`, type: 'float', value: [0.8], initial: [1],
        update: 'uniform', input: 'fg', uniform: 'mix_fg', nodeId,
        arithmeticFor: { kind: 'mix', original, role: 'fg' },
      },
      {
        id: `node:${nodeId}/mix`, label: `${nodeId} / mix`, type: 'float', value: [0.5], initial: [0],
        update: 'uniform', input: 'mix', uniform: 'mix_factor', nodeId,
        arithmeticFor: { kind: 'mix', original, role: 'mix' },
      },
    ];
    const result = disneyMaterialFromStandard(resolveSurface(graph)!, graph, parameters);
    expect(result.material.roughness).toBeCloseTo(0.25);
  });

  it('rejects unsupported film, thin surfaces and participating transmission', () => {
    expect(() => convert({ thin_film_thickness: 100 })).toThrow('thin-walled surfaces or thin film');
    expect(() => convert({ thin_walled: true })).toThrow('thin-walled surfaces or thin film');
    expect(() => convert({ transmission: 1, transmission_depth: 2 })).toThrow('transmission medium');
  });

  it('reports independent diffuse roughness and unsupported active lobes', () => {
    const result = convert({ specular_roughness: 0.5, diffuse_roughness: 0.1, sheen: 1, subsurface: 0.2 });
    expect(result.warnings.join(' ')).toContain('Independent diffuse roughness');
    expect(result.warnings.join(' ')).toContain('Sheen color');
    expect(result.warnings.join(' ')).toContain('Subsurface');
  });
});
