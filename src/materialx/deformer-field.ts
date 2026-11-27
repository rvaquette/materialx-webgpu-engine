import { evaluateIrRef } from '../compiler/ir-eval.ts';
import { IrModuleBuilder, OBJECT_POSITION_INPUT } from '../compiler/ir.ts';
import { lowerValueInputsToIr } from '../compiler/surface-ir.ts';
import { MATERIALX_CLOCK_INPUT, type ResolvedGraph, type ResolvedNode } from './graph.ts';
import type { ScriptNode, ScriptPortDef, ScriptValue } from './script-api.ts';
import type { NormalizedSurfaceInput } from './surface-graph.ts';

const CLOCK_PARAMETER = 'deformer_frame';

export interface FieldSource {
  node: ScriptNode;
  output: ScriptPortDef;
}

export function compileDeformerField(source: FieldSource) {
  if (source.output.type !== 'vector3') throw new Error('Field requires a MaterialX vector3 output.');
  const nodes: ScriptNode[] = [];
  const seen = new Set<ScriptNode>();
  const visiting = new Set<ScriptNode>();
  const visit = (node: ScriptNode): void => {
    if (visiting.has(node)) throw new Error('Field graph contains a cycle.');
    if (seen.has(node)) return;
    visiting.add(node);
    for (const input of node.inputs.values()) if ('node' in input) visit(input.node);
    visiting.delete(node);
    seen.add(node);
    nodes.push(node);
  };
  visit(source.node);
  const ids = new Map(nodes.map((node, index) => [node, `field_${index}`]));
  const valueString = (value: ScriptValue): string => Array.isArray(value) ? value.join(', ') : String(value);
  const resolved = new Map<string, ResolvedNode>();
  for (const node of nodes) {
    if (node.def.category === 'position') {
      const space = node.inputs.get('space');
      const value = space && 'value' in space ? space.value : space ? undefined : node.def.inputs.find(port => port.name === 'space')?.default;
      if (value !== 'object' && value !== 'model') {
        throw new Error('Field graphs support object-space position only.');
      }
    }
    if (['normal', 'tangent', 'bitangent', 'texcoord', 'geompropvalue', 'normalmap', 'bump',
      'viewdirection', 'image', 'tiledimage', 'triplanarprojection'].includes(node.def.category)) {
      throw new Error('Field graphs support object-space position and time, but not textures or other geometry inputs.');
    }
    const id = ids.get(node)!;
    const inputs: ResolvedNode['inputs'] = [];
    for (const [name, input] of node.inputs) {
      const port = node.def.inputs.find(candidate => candidate.name === name);
      if (!port) throw new Error(`Unknown field input ${node.name}.${name}.`);
      inputs.push({
        name, type: port.type, provenance: { namePath: `${id}/${name}` },
        source: 'node' in input
          ? { kind: 'connection', nodeId: ids.get(input.node)!, output: input.output }
          : { kind: 'value', type: port.type, value: valueString(input.value) },
      });
    }
    if (node.def.category === 'time' || node.def.category === 'frame') {
      inputs.push({
        name: MATERIALX_CLOCK_INPUT, type: 'float', parameter: CLOCK_PARAMETER,
        source: { kind: 'value', type: 'float', value: '0' }, provenance: { namePath: `${id}/${MATERIALX_CLOCK_INPUT}` },
      });
    }
    resolved.set(id, {
      id, category: node.def.category, type: node.def.outputs.length === 1 ? node.def.outputs[0]!.type : 'multioutput',
      provenance: { namePath: id }, inputs,
      nodeDef: {
        name: node.def.name, nodeString: node.def.category,
        type: node.def.outputs.length === 1 ? node.def.outputs[0]!.type : 'multioutput',
        implementation: { kind: 'unresolved' },
        inputs: node.def.inputs.map(port => ({
          name: port.name, type: port.type, ...(port.default !== undefined ? { value: valueString(port.default) } : {}),
        })),
        outputs: node.def.outputs.map(port => ({ name: port.name, type: port.type })),
      },
    });
  }
  const graph: ResolvedGraph = { nodes: resolved, terminals: [] };
  const builder = new IrModuleBuilder();
  const input: NormalizedSurfaceInput = {
    name: 'field', type: 'vector3',
    source: { kind: 'connection', nodeId: ids.get(source.node)!, output: source.output.name },
  };
  const ref = lowerValueInputsToIr(graph, new Map([['field', input]]), builder, diagnostic => {
    throw new Error(`Field graph: ${diagnostic.message}`);
  }).get('field');
  if (ref === undefined) throw new Error('Cannot compile Field graph output.');
  const ir = builder.build();
  for (const expr of ir.exprs.values()) {
    if (expr.kind === 'texture' || expr.kind === 'primvar' || expr.kind === 'closure'
        || (expr.kind === 'input' && expr.name !== OBJECT_POSITION_INPUT)
        || (expr.kind === 'param' && expr.name !== CLOCK_PARAMETER)
        || (expr.kind === 'call' && (/^flake[23]d_/.test(expr.op) || [
          'noise2d', 'worleynoise2d', 'cellnoise2d', 'reflect', 'refract', 'splitlr', 'splittb',
          'ramplr', 'ramptb', 'ramp4', 'checkerboard', 'circle', 'cloverleaf', 'line',
        ].includes(expr.op)))) {
      throw new Error('Field graphs support object-space position and time, but not textures or other geometry inputs.');
    }
  }
  const sample = (position: readonly number[], time: number): readonly number[] =>
    evaluateIrRef(ir, ref, { position, inputs: { [OBJECT_POSITION_INPUT]: position }, params: { [CLOCK_PARAMETER]: [time] } });
  return {
    sample,
    ir,
    ref,
    animated: nodes.some(node => node.def.category === 'time' || node.def.category === 'frame'),
    nodes: seen,
    metadata: {
      output: { node: ids.get(source.node)!, output: source.output.name },
      nodes: nodes.map(node => ({
        id: ids.get(node)!, nodeDef: node.def.name, definition: node.def,
        inputs: Object.fromEntries([...node.inputs].map(([name, value]) => [
          name, 'node' in value ? { node: ids.get(value.node)!, output: value.output }
            : { value: Array.isArray(value.value) ? [...value.value] : value.value },
        ])),
      })),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Rebuilds the graph embedded in USD without loading a separate MaterialX library. */
export function compileSerializedDeformerField(metadata: unknown): ReturnType<typeof compileDeformerField> {
  if (!isRecord(metadata) || !Array.isArray(metadata.nodes) || !isRecord(metadata.output)
      || typeof metadata.output.node !== 'string' || typeof metadata.output.output !== 'string') {
    throw new Error('Invalid MaterialX field graph metadata.');
  }
  const nodes = new Map<string, ScriptNode>();
  const records = new Map<string, Record<string, unknown>>();
  for (const record of metadata.nodes) {
    if (!isRecord(record) || typeof record.id !== 'string' || nodes.has(record.id)
        || !isRecord(record.definition) || !isRecord(record.inputs)) {
      throw new Error('Invalid MaterialX field graph node.');
    }
    const def = record.definition;
    const ports = (value: unknown): value is ScriptPortDef[] => Array.isArray(value) && value.every(port =>
      isRecord(port) && typeof port.name === 'string' && typeof port.type === 'string');
    if (typeof def.name !== 'string' || typeof def.category !== 'string' || typeof def.className !== 'string'
        || !ports(def.inputs) || !ports(def.outputs) || record.nodeDef !== def.name) {
      throw new Error('Invalid MaterialX field NodeDef metadata.');
    }
    nodes.set(record.id, { name: record.id, def: { name: def.name, category: def.category, className: def.className,
      inputs: def.inputs, outputs: def.outputs }, inputs: new Map() });
    records.set(record.id, record);
  }
  for (const [id, record] of records) {
    const node = nodes.get(id)!;
    for (const [name, input] of Object.entries(record.inputs as Record<string, unknown>)) {
      if (!isRecord(input)) throw new Error('Invalid MaterialX field input.');
      if (typeof input.node === 'string' && typeof input.output === 'string') {
        const upstream = nodes.get(input.node);
        if (!upstream || !upstream.def.outputs.some(port => port.name === input.output)) throw new Error('Invalid MaterialX field connection.');
        node.inputs.set(name, { node: upstream, output: input.output });
      } else {
        const value = input.value;
        if (!(typeof value === 'number' && Number.isFinite(value)) && typeof value !== 'boolean'
            && typeof value !== 'string' && !(Array.isArray(value) && value.every(item => typeof item === 'number' && Number.isFinite(item)))) {
          throw new Error('Invalid MaterialX field value.');
        }
        node.inputs.set(name, { value: value as ScriptValue });
      }
    }
  }
  const outputName = metadata.output.output;
  const node = nodes.get(metadata.output.node);
  const output = node?.def.outputs.find(port => port.name === outputName);
  if (!node || !output) throw new Error('Invalid MaterialX field output.');
  return compileDeformerField({ node, output });
}
