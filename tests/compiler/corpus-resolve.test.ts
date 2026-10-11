import { describe, it, expect } from 'vitest';
import inventory from '../fixtures/materialx-nodes.json' with { type: 'json' };
import { NODE_CASES, NODE_CASES_BY_CATEGORY, type NodeCase } from '../fixtures/node-cases.ts';
import {
  resolveGraph,
  type MxInput,
  type MxNode,
  type MxNodeDef,
  type MxInterfaceElement,
} from '../../src/materialx/graph.ts';
import {
  IrModuleBuilder,
  FLOAT,
  INT,
  COLOR3,
  COLOR4,
  vector,
  closureType,
  shaderType,
  isClosureType,
  typesEqual,
  type IrType,
  type IrRef,
} from '../../src/compiler/ir.ts';
import { isNodeCovered } from '../../src/compiler/nodes.ts';

// --- Fakes mirroring the Embind surface consumed by resolveGraph --------------

interface FakeInputSpec {
  name: string;
  type: string;
  value?: string;
  interfaceName?: string;
  connected?: MxNode;
  output?: string;
  colorSpace?: string;
}

function fakeInput(spec: FakeInputSpec): MxInput {
  return {
    getName: () => spec.name,
    getNamePath: () => `/mat/${spec.name}`,
    getType: () => spec.type,
    getValueString: () => spec.value ?? '',
    hasValue: () => spec.value !== undefined,
    getInterfaceName: () => spec.interfaceName ?? '',
    getConnectedNode: () => spec.connected ?? null,
    getOutputString: () => spec.output ?? '',
    getColorSpace: () => spec.colorSpace ?? '',
    getUnit: () => '',
    getUnitType: () => '',
    validate: () => true,
    delete: () => {},
  } as unknown as MxInput;
}

function fakeImpl(kind: 'nodegraph' | 'implementation', name: string): MxInterfaceElement {
  return {
    getName: () => name,
    getNamePath: () => `/impl/${name}`,
    getCategory: () => kind,
    getTarget: () => (kind === 'implementation' ? 'genglsl' : ''),
    getFunction: () => (kind === 'implementation' ? `mx_${name}` : ''),
    getFile: () => '',
    validate: () => true,
    delete: () => {},
  } as unknown as MxInterfaceElement;
}

function fakeNodeDef(category: string, type: string, impl: MxInterfaceElement): MxNodeDef {
  return {
    getName: () => `ND_${category}`,
    getNamePath: () => `/nd/${category}`,
    getNodeString: () => category,
    getType: () => type,
    getNodeGroup: () => '',
    getVersionString: () => '',
    getImplementation: () => impl,
    getActiveSourceUri: () => 'corpus.mtlx',
    validate: () => true,
    delete: () => {},
  } as unknown as MxNodeDef;
}

function fakeNode(category: string, type: string, impl: MxInterfaceElement, inputs: MxInput[]): MxNode {
  const def = fakeNodeDef(category, type, impl);
  return {
    getName: () => category,
    getNamePath: () => `/mat/${category}`,
    getType: () => type,
    getCategory: () => category,
    getInputs: () => inputs,
    getNodeDef: () => def,
    getActiveSourceUri: () => 'corpus.mtlx',
    validate: () => true,
    delete: () => {},
  } as unknown as MxNode;
}

// Categories whose nodedef expands to a nodegraph implementation (surface + library graphs).
const GRAPH_CATEGORIES = new Set(NODE_CASES.filter((c) => c.exec === 'graph').map((c) => c.category));

function materialxType(kind: string, category: string): string {
  if (kind === 'surface') return 'surfaceshader';
  if (kind === 'bsdf') return 'BSDF';
  if (category === 'texcoord') return 'vector2';
  if (category === 'position') return 'vector3';
  return 'color3';
}

// --- Resolution across the corpus --------------------------------------------

describe('corpus resolution', () => {
  for (const node of inventory.nodes) {
    const category = node.category;
    const type = materialxType(node.kind, category);
    const isGraph = GRAPH_CATEGORIES.has(category);

    it(`resolves ${category} with its nodedef and implementation kind`, () => {
      const impl = fakeImpl(isGraph ? 'nodegraph' : 'implementation', category);
      const mxNode = fakeNode(category, type, impl, [fakeInput({ name: 'in', type: 'float', value: '0.5' })]);
      const graph = resolveGraph({ roots: [{ name: 'out', type, node: mxNode }] });

      const resolved = graph.nodes.get('/mat/' + category);
      expect(resolved).toBeDefined();
      expect(resolved!.category).toBe(category);
      expect(resolved!.type).toBe(type);
      expect(resolved!.nodeDef?.nodeString).toBe(category);
      expect(resolved!.nodeDef?.implementation.kind).toBe(isGraph ? 'nodegraph' : 'sourcecode');
      expect(graph.terminals[0]?.nodeId).toBe('/mat/' + category);
    });
  }

  it('classifies the three input source kinds', () => {
    const impl = fakeImpl('implementation', 'mix');
    const upstream = fakeNode('constant', 'color3', fakeImpl('implementation', 'constant'), []);
    const node = fakeNode('mix', 'color3', impl, [
      fakeInput({ name: 'fg', type: 'color3', value: '0.2, 0.5, 0.8' }),
      fakeInput({ name: 'bg', type: 'color3', connected: upstream }),
      fakeInput({ name: 'mix', type: 'float', interfaceName: 'mixAmount' }),
    ]);
    const graph = resolveGraph({ roots: [{ name: 'out', type: 'color3', node }] });
    const resolved = graph.nodes.get('/mat/mix')!;
    expect(resolved.inputs.map((i) => i.source.kind)).toEqual(['value', 'connection', 'interface']);
  });

  it('warns and omits the nodedef when resolution fails', () => {
    const node = {
      getName: () => 'orphan',
      getNamePath: () => '/mat/orphan',
      getType: () => 'color3',
      getCategory: () => 'orphan',
      getInputs: () => [],
      getNodeDef: () => null,
      getActiveSourceUri: () => 'corpus.mtlx',
      validate: () => true,
      delete: () => {},
    } as unknown as MxNode;
    const messages: string[] = [];
    const graph = resolveGraph({
      roots: [{ name: 'out', type: 'color3', node }],
      onDiagnostic: (d) => messages.push(d.message),
    });
    expect(graph.nodes.get('/mat/orphan')?.nodeDef).toBeUndefined();
    expect(messages.join('\n')).toContain('Unresolved NodeDef');
  });
});

// --- IR construction across the executable leaves ----------------------------

const irTypeByLen = (n: number): IrType =>
  n === 1 ? FLOAT : n === 2 ? vector(2, 'float') : n === 3 ? COLOR3 : COLOR4;

const irTypeByOut = (out: NonNullable<NodeCase['out']>): IrType =>
  out === 'f32' ? FLOAT : out === 'vec2f' ? vector(2, 'float') : out === 'vec3f' ? COLOR3 : COLOR4;

function buildExprIr(b: IrModuleBuilder, c: NodeCase): IrRef {
  const args: IrRef[] = c.inputs.map((v, i) => {
    if (c.category === 'extract' && i === 1) return b.constant(INT, v[0]!);
    const t = irTypeByLen(v.length);
    return b.constant(t, v.length === 1 ? v[0]! : [...v]);
  });
  return b.add({ kind: 'call', type: irTypeByOut(c.out!), op: c.category, args });
}

function buildTextureIr(b: IrModuleBuilder): IrRef {
  b.declareTexture({ name: 'tex', valueType: COLOR3 });
  b.declareSampler({ name: 'samp' });
  const uv = b.add({ kind: 'primvar', type: vector(2, 'float', 'texcoord'), name: 'st' });
  return b.add({ kind: 'texture', type: COLOR3, texture: 'tex', uv, sampler: 'samp' });
}

function buildClosureIr(b: IrModuleBuilder, c: NodeCase): IrRef {
  if (c.category === 'surface') {
    const opacity = b.constant(FLOAT, 1);
    return b.add({ kind: 'closure', type: shaderType('surface'), closure: 'bsdf', op: 'surface', params: { opacity } });
  }
  const weight = b.constant(FLOAT, 0.8);
  const tint = b.constant(COLOR3, [0.6, 0.3, 0.1]);
  const roughness = b.constant(vector(2, 'float'), [0.1, 0.2]);
  return b.add({
    kind: 'closure',
    type: closureType('bsdf'),
    closure: 'bsdf',
    op: c.category,
    params: { weight, tint, roughness },
  });
}

describe('corpus IR construction', () => {
  const runnable = NODE_CASES.filter((c) => c.exec === 'expr' || c.exec === 'texture' || c.exec === 'closure');

  for (const c of runnable) {
    it(`builds a typed IR node for ${c.category}`, () => {
      const b = new IrModuleBuilder();
      let ref: IrRef;
      let expectedType: IrType;

      if (c.exec === 'texture') {
        ref = buildTextureIr(b);
        expectedType = COLOR3;
      } else if (c.exec === 'closure') {
        ref = buildClosureIr(b, c);
        expectedType = c.category === 'surface' ? shaderType('surface') : closureType('bsdf');
      } else {
        ref = buildExprIr(b, c);
        expectedType = irTypeByOut(c.out!);
      }

      const expr = b.get(ref);
      expect(expr).toBeDefined();
      expect(typesEqual(expr!.type, expectedType)).toBe(true);
      expect(isNodeCovered(c.category)).toBe(true);

      b.output({ name: 'out', type: expr!.type, ref });
      const ir = b.build();
      expect(ir.exprs.size).toBeGreaterThan(0);
      expect(ir.outputs).toHaveLength(1);
      if (c.exec === 'closure') expect(isClosureType(expr!.type)).toBe(true);
      if (c.exec === 'texture') expect(ir.textures).toHaveLength(1);
    });
  }

  it('covers every runnable corpus category exactly once', () => {
    const categories = runnable.map((c) => c.category);
    expect(new Set(categories).size).toBe(categories.length);
    for (const c of categories) expect(NODE_CASES_BY_CATEGORY.has(c)).toBe(true);
  });
});
