import {
  IrModuleBuilder, irTypeFromMaterialX, OBJECT_TO_WORLD_INPUT, WORLD_TO_OBJECT_INPUT,
  OBJECT_POSITION_INPUT, OBJECT_NORMAL_INPUT, OBJECT_TANGENT_INPUT, OBJECT_BITANGENT_INPUT,
  type ShaderIr,
} from '../src/compiler/ir.ts';
import { evaluateIrRef } from '../src/compiler/ir-eval.ts';
import { lowerValueInputsToIr } from '../src/compiler/surface-ir.ts';
import type { ResolvedGraph } from '../src/materialx/graph.ts';
import type { NormalizedSurfaceInput, SurfaceInputType } from '../src/materialx/surface-graph.ts';
import type { ScriptPortDef } from '../src/materialx/script-api.ts';

export type CpuProbe = { status: 'evaluated'; value: readonly number[] }
  | { status: 'not-tested'; reason: string }
  | { status: 'diagnostic'; messages: readonly string[] }
  | { status: 'error'; message: string };

const TYPES: Readonly<Record<string, { surface: SurfaceInputType; width: number }>> = {
  float: { surface: 'float', width: 1 },
  integer: { surface: 'integer', width: 1 },
  boolean: { surface: 'boolean', width: 1 },
  color3: { surface: 'color3', width: 3 },
  vector3: { surface: 'vector3', width: 3 },
  color4: { surface: 'color3', width: 4 },
  vector2: { surface: 'color3', width: 2 },
  vector4: { surface: 'color3', width: 4 },
  matrix33: { surface: 'color3', width: 9 },
  matrix44: { surface: 'color3', width: 16 },
};

/** Exercise one unconnected numeric node; this is not a MaterialX reference comparison. */
export function prepareCpuValueProbe(definition: {
  nodedef: string;
  category: string;
  inputs: readonly ScriptPortDef[];
  outputs: readonly ScriptPortDef[];
}): Exclude<CpuProbe, { status: 'evaluated' }> | { status: 'evaluated'; value: readonly number[]; ir: ShaderIr } {
  if (definition.outputs.length !== 1) return { status: 'not-tested', reason: 'multi-output or missing output' };
  const output = definition.outputs[0]!;
  const shape = TYPES[output.type];
  if (!shape) return { status: 'not-tested', reason: `output type ${output.type} is not a numeric CPU value` };
  if (definition.inputs.some(input => input.type === 'filename')) {
    return { status: 'not-tested', reason: 'filename input requires an explicit resource test' };
  }

  const inputs = definition.inputs.map(input => ({
    name: input.name, type: input.type,
    ...(input.default !== undefined
      ? { value: Array.isArray(input.default) ? input.default.join(', ') : String(input.default) }
      : {}),
    ...(input.defaultGeomProp !== undefined ? { geomprop: input.defaultGeomProp } : {}),
  }));
  const graph: ResolvedGraph = {
    terminals: [],
    nodes: new Map([['probe', {
      id: 'probe', category: definition.category, type: output.type,
      nodeDef: {
        name: definition.nodedef, nodeString: definition.category, type: output.type,
        implementation: { kind: 'sourcecode' }, inputs,
      },
      inputs: [], provenance: { namePath: '/probe' },
    }]]),
  };
  const source: NormalizedSurfaceInput = {
    name: 'result', type: shape.surface, source: { kind: 'connection', nodeId: 'probe' },
  };
  const diagnostics: string[] = [];
  try {
    const builder = new IrModuleBuilder();
    let ref = lowerValueInputsToIr(graph, new Map([['result', source]]), builder, diagnostic => {
      diagnostics.push(`${diagnostic.level}: ${diagnostic.message}`);
    }).get('result');
    if (diagnostics.length) return { status: 'diagnostic', messages: diagnostics };
    if (ref === undefined) return { status: 'error', message: 'Lowering did not return a result.' };
    const result = builder.get(ref);
    if (result?.kind === 'convert' && shape.width !== 1 && shape.width !== 3) ref = result.source;
    const type = irTypeFromMaterialX(output.type);
    if (!type) return { status: 'error', message: `No IR type for ${output.type}.` };
    builder.output({ name: 'result', type, ref });
    const ir = builder.build();
    if (ir.textures.length) return { status: 'not-tested', reason: 'texture sampler and decoded file required' };
    const value = evaluateIrRef(ir, ref, {
      position: [0.25, 0.5, 0.75], normal: [0, 0, 1], tangent: [1, 0, 0],
      bitangent: [0, 1, 0], texcoord: [0.25, 0.5], viewDir: [0, 0, 1],
      inputs: {
        [OBJECT_TO_WORLD_INPUT]: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        [WORLD_TO_OBJECT_INPUT]: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
        [OBJECT_POSITION_INPUT]: [0.25, 0.5, 0.75],
        [OBJECT_NORMAL_INPUT]: [0, 0, 1],
        [OBJECT_TANGENT_INPUT]: [1, 0, 0],
        [OBJECT_BITANGENT_INPUT]: [0, 1, 0],
      },
    });
    if (value.length !== shape.width || value.some(component => !Number.isFinite(component))) {
      return { status: 'error', message: `Unexpected or non-finite result: ${value.join(', ')}.` };
    }
    return { status: 'evaluated', value: value.map(component => component === 0 ? 0 : component), ir };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

export function probeCpuValue(definition: Parameters<typeof prepareCpuValueProbe>[0]): CpuProbe {
  const result = prepareCpuValueProbe(definition);
  return result.status === 'evaluated' ? { status: 'evaluated', value: result.value } : result;
}
