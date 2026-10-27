import { describe, it, expect, vi } from 'vitest';
import {
  resolveGraph,
  type MxNode,
  type MxInput,
  type MxNodeDef,
  type MxInterfaceElement,
} from '../../src/materialx/graph.ts';

interface FakeInputSpec {
  name: string;
  type: string;
  value?: string;
  interfaceName?: string;
  connected?: FakeNode;
  output?: string;
  colorSpace?: string;
  unit?: string;
  unitType?: string;
}

function fakeInput(spec: FakeInputSpec): MxInput {
  return {
    getName: () => spec.name,
    getNamePath: () => `/mat/${spec.name}`,
    getType: () => spec.type,
    getValueString: () => spec.value ?? '',
    hasValue: () => spec.value !== undefined,
    getInterfaceName: () => spec.interfaceName ?? '',
    getConnectedNode: () => (spec.connected ? (spec.connected as unknown as MxNode) : null),
    getOutputString: () => spec.output ?? '',
    getColorSpace: () => spec.colorSpace ?? '',
    getUnit: () => spec.unit ?? '',
    getUnitType: () => spec.unitType ?? '',
    validate: () => true,
    delete: () => {},
  };
}

interface FakeNode {
  getName(): string;
  getNamePath(): string;
  getType(): string;
  getCategory(): string;
  getInputs(): MxInput[];
  getNodeDef(target?: string): MxNodeDef | null;
  getActiveSourceUri(): string;
  validate(): boolean;
  delete(): void;
}

function fakeImpl(category: 'nodegraph' | 'implementation', opts: { name: string; target?: string; fn?: string }): MxInterfaceElement {
  return {
    getName: () => opts.name,
    getNamePath: () => `/impl/${opts.name}`,
    getCategory: () => category,
    getTarget: () => opts.target ?? '',
    getFunction: () => opts.fn ?? '',
    getFile: () => '',
    validate: () => true,
    delete: () => {},
  };
}

function fakeNodeDef(opts: { name: string; nodeString: string; type: string; impl?: MxInterfaceElement | null }): MxNodeDef {
  return {
    getName: () => opts.name,
    getNamePath: () => `/nd/${opts.name}`,
    getNodeString: () => opts.nodeString,
    getType: () => opts.type,
    getNodeGroup: () => '',
    getVersionString: () => '',
    getImplementation: () => opts.impl ?? null,
    getActiveSourceUri: () => 'stdlib.mtlx',
    validate: () => true,
    delete: () => {},
  };
}

function fakeNode(opts: {
  name: string;
  category: string;
  type: string;
  inputs?: MxInput[];
  nodeDef?: MxNodeDef | null;
  sourceUri?: string;
}): FakeNode {
  return {
    getName: () => opts.name,
    getNamePath: () => `/mat/${opts.name}`,
    getType: () => opts.type,
    getCategory: () => opts.category,
    getInputs: () => opts.inputs ?? [],
    getNodeDef: () => opts.nodeDef ?? null,
    getActiveSourceUri: () => opts.sourceUri ?? '',
    validate: () => true,
    delete: () => {},
  };
}

describe('resolveGraph', () => {
  it('preserves active NodeDef inputs and their typed defaults, including inherited inputs', () => {
    const definition = fakeNodeDef({ name: 'ND_mix_color3', nodeString: 'mix', type: 'color3' });
    definition.getInputs = () => [fakeInput({ name: 'mix', type: 'float', value: '0.25' })];
    definition.getActiveInputs = () => [
      fakeInput({ name: 'bg', type: 'color3', value: '0.2, 0.4, 0.6' }),
      fakeInput({ name: 'fg', type: 'color3', value: '1, 0, 0' }),
      fakeInput({ name: 'mix', type: 'float', value: '0.25' }),
      fakeInput({ name: 'normal', type: 'vector3' }),
    ];
    const node = fakeNode({ name: 'blend', category: 'mix', type: 'color3', nodeDef: definition });
    const graph = resolveGraph({ roots: [{ name: 'color', type: 'color3', node: node as unknown as MxNode }], onDiagnostic: () => {} });
    expect(graph.nodes.get('/mat/blend')?.nodeDef?.inputs).toEqual([
      { name: 'bg', type: 'color3', value: '0.2, 0.4, 0.6' },
      { name: 'fg', type: 'color3', value: '1, 0, 0' },
      { name: 'mix', type: 'float', value: '0.25' },
      { name: 'normal', type: 'vector3' },
    ]);
  });

  it('walks connected nodes, resolves inputs, nodedef and provenance', () => {
    const texDef = fakeNodeDef({
      name: 'ND_image_color3',
      nodeString: 'image',
      type: 'color3',
      impl: fakeImpl('implementation', { name: 'IM_image', target: 'genglsl', fn: 'mx_image' }),
    });
    const tex = fakeNode({
      name: 'base_tex',
      category: 'image',
      type: 'color3',
      nodeDef: texDef,
      sourceUri: 'floor.mtlx',
      inputs: [fakeInput({ name: 'file', type: 'filename', value: 'textures/c.<UDIM>.tif', colorSpace: 'srgb_tx' })],
    });
    const surfDef = fakeNodeDef({
      name: 'ND_open_pbr_surface',
      nodeString: 'open_pbr_surface',
      type: 'surfaceshader',
      impl: fakeImpl('nodegraph', { name: 'NG_open_pbr' }),
    });
    const surface = fakeNode({
      name: 'surface',
      category: 'open_pbr_surface',
      type: 'surfaceshader',
      nodeDef: surfDef,
      inputs: [fakeInput({ name: 'base_color', type: 'color3', connected: tex, output: 'out' })],
    });

    const graph = resolveGraph({
      roots: [{ name: 'surfaceshader', type: 'surfaceshader', node: surface as unknown as MxNode }],
      target: 'genglsl',
    });

    expect(graph.terminals).toEqual([
      expect.objectContaining({ name: 'surfaceshader', nodeId: '/mat/surface' }),
    ]);
    expect(graph.nodes.size).toBe(2);

    const surf = graph.nodes.get('/mat/surface');
    expect(surf?.nodeDef?.implementation).toEqual({ kind: 'nodegraph', name: 'NG_open_pbr' });
    expect(surf?.inputs[0]?.source).toEqual({ kind: 'connection', nodeId: '/mat/base_tex', output: 'out' });

    const img = graph.nodes.get('/mat/base_tex');
    expect(img?.provenance).toEqual({ namePath: '/mat/base_tex', sourceUri: 'floor.mtlx' });
    expect(img?.inputs[0]?.colorSpace).toBe('srgb_tx');
    expect(img?.inputs[0]?.source).toEqual({ kind: 'value', value: 'textures/c.<UDIM>.tif', type: 'filename' });
    expect(img?.nodeDef?.implementation).toEqual({ kind: 'sourcecode', target: 'genglsl', function: 'mx_image' });
  });

  it('uses the upstream output carried by a nodegraph output connection', () => {
    const split = fakeNode({ name: 'split', category: 'separate2', type: 'multioutput' });
    const roughness = fakeInput({ name: 'specular_roughness', type: 'float', connected: split, output: 'out_roughness' });
    roughness.getNodeGraphString = () => 'NG_helpers';
    roughness.getConnectedOutput = () => fakeInput({ name: 'out_roughness', type: 'float', output: 'outy' });
    const surface = fakeNode({ name: 'surface', category: 'standard_surface', type: 'surfaceshader', inputs: [roughness] });
    const graph = resolveGraph({ roots: [{ name: 'surfaceshader', type: 'surfaceshader', node: surface as unknown as MxNode }], onDiagnostic: () => {} });
    expect(graph.nodes.get('/mat/surface')?.inputs[0]?.source).toEqual({ kind: 'connection', nodeId: '/mat/split', output: 'outy' });
  });

  it('classifies interface-bound inputs', () => {
    const node = fakeNode({
      name: 'mul',
      category: 'multiply',
      type: 'color3',
      inputs: [fakeInput({ name: 'in2', type: 'float', interfaceName: 'gain' })],
    });
    const graph = resolveGraph({ roots: [{ name: 'surfaceshader', type: 'surfaceshader', node: node as unknown as MxNode }] });
    expect(graph.nodes.get('/mat/mul')?.inputs[0]?.source).toEqual({ kind: 'interface', name: 'gain' });
  });

  it('retains the interface binding when it resolves to a literal value', () => {
    const input = fakeInput({ name: 'in2', type: 'float', interfaceName: 'gain' });
    input.getInterfaceInput = () => fakeInput({ name: 'gain', type: 'float', value: '0.5' });
    const node = fakeNode({ name: 'mul', category: 'multiply', type: 'float', inputs: [input] });
    const graph = resolveGraph({
      roots: [{ name: 'value', type: 'float', node: node as unknown as MxNode }],
      onDiagnostic: () => {},
    });
    expect(graph.nodes.get('/mat/mul')?.inputs[0]).toMatchObject({
      interfaceName: 'gain', source: { kind: 'value', type: 'float', value: '0.5' },
    });
  });

  it('diagnoses an unresolved NodeDef without throwing', () => {
    const onDiagnostic = vi.fn();
    const node = fakeNode({ name: 'mystery', category: 'mystery', type: 'color3', nodeDef: null });
    const graph = resolveGraph({
      roots: [{ name: 'surfaceshader', type: 'surfaceshader', node: node as unknown as MxNode }],
      onDiagnostic,
    });
    expect(graph.nodes.get('/mat/mystery')?.nodeDef).toBeUndefined();
    expect(onDiagnostic).toHaveBeenCalledWith(expect.objectContaining({ level: 'warning' }));
  });

  it('records unconnected terminals and tolerates cycles', () => {
    const a = fakeNode({ name: 'a', category: 'add', type: 'float' });
    const b = fakeNode({ name: 'b', category: 'add', type: 'float', inputs: [fakeInput({ name: 'in', type: 'float', connected: a })] });
    // Close the cycle: a <- b and b <- a.
    a.getInputs = () => [fakeInput({ name: 'in', type: 'float', connected: b })];

    const graph = resolveGraph({
      roots: [
        { name: 'surfaceshader', type: 'surfaceshader', node: b as unknown as MxNode },
        { name: 'displacementshader', type: 'displacementshader', node: null },
      ],
    });
    expect(graph.nodes.size).toBe(2);
    expect(graph.terminals.find((t) => t.name === 'displacementshader')?.nodeId).toBeUndefined();
  });
});
