import type { ResolvedVolume } from '../materialx/volume-graph.ts';
import { IrModuleBuilder, FLOAT, vector, shaderType, type IrRef, type IrExpr, type ShaderIr } from './ir.ts';
import { evaluateIrRef, type IrEvalVaryings } from './ir-eval.ts';
import { lowerValueInputsToIr } from './surface-ir.ts';
import type { ResolvedGraph } from '../materialx/graph.ts';
import type { NormalizedSurfaceInput } from '../materialx/surface-graph.ts';

export interface VolumeMedium {
  absorption: readonly [number, number, number];
  scattering: readonly [number, number, number];
  anisotropy: number;
  /** Emitted radiance per unit world-space distance. */
  emission?: readonly [number, number, number];
}

/** Preserve procedural coefficient inputs rather than baking them at the origin. */
export function lowerVolumeInputsToIr(volume: ResolvedVolume, builder: IrModuleBuilder, graph?: ResolvedGraph): Record<string, IrRef> {
  const inputs: Record<string, IrRef> = {};
  for (const [name, input] of volume.inputs) {
    if (input.source.kind === 'connection') {
      if (!graph) throw new Error(`Volume input '${name}' requires its resolved graph.`);
      validateVolumeCoordinates(graph,input.source.nodeId);
      const declared = new Map<string, NormalizedSurfaceInput>([[name, input]]);
      const lowered = lowerValueInputsToIr(graph, declared, builder, diagnostic => {
        if (diagnostic.level === 'warning' || diagnostic.level === 'error') throw new Error(diagnostic.message);
      });
      inputs[name] = lowered.get(name)!;
      continue;
    }

    function validateVolumeCoordinates(graph: ResolvedGraph, root: string): void {
      const visited = new Set<string>();
      const visit = (id: string): void => {
        if (visited.has(id)) return;
        visited.add(id);
        const node = graph.nodes.get(id);
        if (!node) throw new Error(`Missing volume node '${id}'.`);
        if (['normal','tangent','bitangent','texcoord','geompropvalue'].includes(node.category)) {
          throw new Error(`Volume node '${node.category}' needs per-instance geometric data; only world-space fields are supported.`);
        }
        if (node.category === 'position') {
          const input = node.inputs.find(i => i.name === 'space');
          const space = input?.source.kind === 'value' ? input.source.value
            : node.nodeDef?.inputs?.find(i => i.name === 'space')?.value ?? 'world';
          if (space !== 'world') throw new Error(`Volume position space '${space}' is unsupported; use world.`);
        }
        for (const input of node.inputs) if (input.source.kind === 'connection') visit(input.source.nodeId);
      };
      visit(root);
    }
    const value = input.source.value;
    if (value.length !== (input.type === 'float' ? 1 : 3) || value.some(n => !Number.isFinite(n)) ||
        (name === 'anisotropy' ? Math.abs(value[0]!) >= 1 : value.some(n => n < 0))) {
      throw new Error(`Invalid volume coefficient '${name}'.`);
    }
    inputs[name] = builder.constant(
      input.type === 'float' ? FLOAT : vector(3),
      input.type === 'float' ? value[0]! : value,
    );
  }
  return inputs;
}

export function appendVolumeIr(volume: ResolvedVolume, builder: IrModuleBuilder, graph?: ResolvedGraph): void {
  const params = lowerVolumeInputsToIr(volume, builder, graph);
  const ref = builder.add({
    kind: 'closure', type: shaderType('volume'), closure: 'vdf', op: 'anisotropic_vdf', params,
  });
  builder.output({ name: 'volumeshader', type: shaderType('volume'), ref });
}

export function evaluateVolumeIr(ir: ShaderIr, varyings: IrEvalVaryings = {}): VolumeMedium {
  const output = ir.outputs.find(o => o.name === 'volumeshader');
  const closure = output ? ir.exprs.get(output.ref) : undefined;
  if (closure?.kind !== 'closure' || closure.closure !== 'vdf') {
    throw new Error('Missing volume closure in compiled IR.');
  }
  const cache = new Map<IrRef, readonly number[]>();
  const value = (name: string): readonly number[] => {
    const ref = closure.params[name];
    if (!ref) throw new Error(`Missing compiled volume input '${name}'.`);
    return evaluateIrRef(ir, ref, varyings, cache);
  };
  const rgb = (name: string): readonly [number, number, number] => {
    const v = value(name);
    if (v.length !== 3 || v.some(n => !Number.isFinite(n) || n < 0)) {
      throw new Error(`Invalid compiled volume input '${name}'.`);
    }
    return [v[0]!, v[1]!, v[2]!];
  };
  const g = value('anisotropy')[0];
  if (g === undefined || !Number.isFinite(g) || Math.abs(g) >= 1) {
    throw new Error('Invalid compiled volume anisotropy.');
  }
  return { absorption: rgb('absorption'), scattering: rgb('scattering'), anisotropy: g,
    ...(closure.params.emission ? { emission: rgb('emission') } : {}) };
}

export function isSpatialVolumeIr(ir: ShaderIr): boolean {
  return [...volumeExpressions(ir).values()].some(e => ['input', 'primvar', 'texture', 'call'].includes(e.kind));
}

/** Surface dependencies must not change how an independent volume is evaluated. */
export function volumeExpressions(ir: ShaderIr): ReadonlyMap<IrRef, IrExpr> {
  const expressions = new Map<IrRef, IrExpr>();
  const visit = (ref: IrRef): void => {
    if (expressions.has(ref)) return;
    const expr = ir.exprs.get(ref);
    if (!expr) throw new Error(`Missing volume expression '${ref}'.`);
    expressions.set(ref,expr);
    switch (expr.kind) {
      case 'convert': case 'swizzle': visit(expr.source); break;
      case 'call': expr.args.forEach(visit); Object.values(expr.namedArgs ?? {}).forEach(visit); break;
      case 'closure': Object.values(expr.params).forEach(visit); break;
      case 'combine': expr.operands.forEach(visit); if (expr.weight) visit(expr.weight); break;
      case 'texture': visit(expr.uv); break;
    }
  };
  const output = ir.outputs.find(o => o.name === 'volumeshader');
  if (!output) throw new Error('Missing volume output.');
  visit(output.ref);
  return expressions;
}
