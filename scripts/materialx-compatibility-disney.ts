import type { ResolvedGraph, ResolvedNode } from '../src/materialx/graph.ts';
import { resolveSurface } from '../src/materialx/surface-graph.ts';
import { disneyMaterialFromStandard } from '../src/render/pathtracing/disney-standard-material.ts';
import type { ScriptPortDef } from '../src/materialx/script-api.ts';
import { SURFACE_IR_UPSTREAM } from '../src/compiler/surface-ir.ts';

export type DisneyProbe =
  | { status: 'rejected'; message: string; diagnostics: readonly string[] }
  | { status: 'accepted'; warnings: readonly string[]; diagnostics: readonly string[] }
  | { status: 'not-tested'; reason: string }
  | { status: 'error'; message: string };

/** Test one direct connection without editor-supplied constant folding or textures. */
export function probeDisneyDirect(definition: {
  category: string;
  outputs: readonly { type: string }[];
  name?: string;
  nodedef?: string;
  inputs?: readonly ScriptPortDef[];
}): DisneyProbe {
  if (definition.outputs.length !== 1 || !['float', 'color3'].includes(definition.outputs[0]!.type)) {
    return { status: 'not-tested', reason: 'requires one float or color3 output' };
  }
  const type = definition.outputs[0]!.type;
  const input = type === 'float' ? 'base' : 'base_color';
  const provenance = { namePath: '/probe' };
  const nodedef = definition.nodedef ?? definition.name;
  const value: ResolvedNode = {
    id: 'value', category: definition.category, type, inputs: [], provenance,
    ...(nodedef && definition.inputs ? { nodeDef: {
      name: nodedef, nodeString: definition.category, type, implementation: { kind: 'sourcecode' as const },
      inputs: definition.inputs.map(port => ({
        name: port.name, type: port.type,
        ...(port.default !== undefined
          ? { value: Array.isArray(port.default) ? port.default.join(', ') : String(port.default) } : {}),
        ...(port.defaultGeomProp !== undefined ? { geomprop: port.defaultGeomProp } : {}),
      })),
    } } : {}),
  };
  const surface: ResolvedNode = {
    id: 'surface', category: 'standard_surface', type: 'surfaceshader', provenance,
    inputs: [{ name: input, type, source: { kind: 'connection', nodeId: 'value' }, provenance }],
  };
  const graph: ResolvedGraph = {
    nodes: new Map([[surface.id, surface], [value.id, value]]),
    terminals: [{ name: 'surfaceshader', type: 'surfaceshader', nodeId: surface.id, provenance }],
  };
  const diagnostics: string[] = [];
  try {
    const resolved = resolveSurface(graph, {
      supportedUpstream: SURFACE_IR_UPSTREAM,
      onDiagnostic: diagnostic => diagnostics.push(`${diagnostic.level}: ${diagnostic.message}`),
    });
    if (!resolved) return { status: 'error', message: `Surface did not resolve: ${diagnostics.join('; ')}` };
    const result = disneyMaterialFromStandard(resolved, graph);
    return { status: 'accepted', warnings: result.warnings, diagnostics };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Unsupported connected standard_surface input base.')
        || message.startsWith('Unsupported Disney texture graph:')) {
      return { status: 'rejected', message, diagnostics };
    }
    return { status: 'error', message: [message, ...diagnostics].join('\n') };
  }
}
