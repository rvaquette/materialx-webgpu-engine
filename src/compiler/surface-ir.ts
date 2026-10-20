// T055c: lower a resolved surface's inputs into shader IR so textured/procedural
// inputs emit their node sub-graph into the generated WGSL (texture binding or
// node call) instead of being flattened into a baked constant. Literal inputs
// become IR constants. This reuses the expr/texture lowering registry (nodes.ts,
// real since T014) by emitting 'texture'/'call'/'convert'/'const' IR nodes that
// the WGSL backend (wgsl.ts) already knows how to lower. Unsupported upstream
// nodes are diagnosed (REQ-013) and fall back to a neutral constant. The returned
// map (surface input name -> IrRef) is consumed by T055d to fill a LayeredClosure.

import { defaultDiagnosticSink, type DiagnosticSink } from '../core/diagnostics.ts';
import type { ResolvedGraph, ResolvedInput } from '../materialx/graph.ts';
import type {
  ResolvedSurface,
  SurfaceFamily,
  SurfaceInputType,
} from '../materialx/surface-graph.ts';
import {
  COLOR3,
  FLOAT,
  INT,
  BOOL,
  IrModuleBuilder,
  irTypeFromMaterialX,
  vector,
  type IrRef,
  type IrType,
} from './ir.ts';
import { getNodeLowering } from './nodes.ts';

export interface LoweredSurfaceInputs {
  readonly family: SurfaceFamily;
  readonly nodeId: string;
  /** Per declared surface input: the IR ref feeding that field. */
  readonly inputs: ReadonlyMap<string, IrRef>;
}

const TEXTURE_CATEGORIES: ReadonlySet<string> = new Set(['image', 'tiledimage', 'hextiledimage']);

function surfaceIrType(type: SurfaceInputType): IrType {
  switch (type) {
    case 'float':
      return FLOAT;
    case 'integer':
      return INT;
    case 'boolean':
      return BOOL;
    case 'color3':
      return COLOR3;
    case 'vector3':
      return vector(3, 'float', 'vector');
  }
}

function parseNumbers(raw: string): number[] {
  if (raw.trim() === 'true') return [1];
  if (raw.trim() === 'false') return [0];
  return raw.split(',').map((s) => {
    const n = Number.parseFloat(s.trim());
    return Number.isFinite(n) ? n : 0;
  });
}

function constOfIrType(builder: IrModuleBuilder, irt: IrType, nums: readonly number[]): IrRef {
  if (irt.kind === 'vector') {
    const first = nums[0] ?? 0;
    const comps: number[] = [];
    for (let i = 0; i < irt.size; i++) comps.push(nums[i] ?? first);
    return builder.constant(irt, comps);
  }
  if (irt.kind === 'scalar') return builder.constant(irt, nums[0] ?? 0);
  // Closures/matrices/strings have no literal surface value; fall back to a scalar.
  return builder.constant(FLOAT, nums[0] ?? 0);
}

/**
 * Lower every declared input of a resolved surface into shader IR, attaching the
 * expressions to the given builder. Connected/procedural inputs emit their node
 * sub-graph (texture binding or node call); literal inputs become constants.
 */
export function lowerSurfaceInputsToIr(
  graph: ResolvedGraph,
  surface: ResolvedSurface,
  builder: IrModuleBuilder,
  sink: DiagnosticSink = defaultDiagnosticSink,
): LoweredSurfaceInputs {
  const nodeMemo = new Map<string, IrRef>();
  const geomMemo = new Map<string, IrRef>();
  let uvRef: IrRef | undefined;

  const neutralColor = (): IrRef => builder.constant(COLOR3, [0, 0, 0]);

  const ensureUv = (): IrRef => {
    if (uvRef === undefined) {
      const uvType = vector(2, 'float', 'texcoord');
      builder.declarePrimvar({ name: 'st', type: uvType });
      uvRef = builder.add({ kind: 'primvar', type: uvType, name: 'st' });
    }
    return uvRef;
  };

  const geomRef = (name: string): IrRef => {
    const existing = geomMemo.get(name);
    if (existing !== undefined) return existing;
    const mapped = name.toLowerCase().startsWith('t') ? 'tangent' : 'normal';
    const semantic = mapped === 'tangent' ? 'vector' : 'normal';
    const ref = builder.add({ kind: 'input', type: vector(3, 'float', semantic), name: mapped });
    geomMemo.set(name, ref);
    return ref;
  };

  const lowerInput = (input: ResolvedInput): IrRef | undefined => {
    switch (input.source.kind) {
      case 'value': {
        const irt = irTypeFromMaterialX(input.type) ?? FLOAT;
        return constOfIrType(builder, irt, parseNumbers(input.source.value));
      }
      case 'connection':
        return lowerNode(input.source.nodeId, input.source.output);
      case 'interface':
      case 'default':
        // No literal value available at this layer; let the registry fallback apply.
        return undefined;
    }
  };

  const lowerTexture = (nodeId: string): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const valueType = irTypeFromMaterialX(node.type) ?? COLOR3;
    const file = node.inputs.find((i) => i.name === 'file');
    // Record the image reference so the PT texture registry can dedup shared
    // files across materials (T057j).
    const fileRef = file?.source.kind === 'value' ? file.source.value : undefined;
    builder.declareTexture({
      name: nodeId,
      valueType,
      ...(file?.colorSpace !== undefined ? { colorSpace: file.colorSpace } : {}),
      ...(fileRef !== undefined ? { fileRef } : {}),
    });
    builder.declareSampler({ name: nodeId });
    const texcoord = node.inputs.find((i) => i.name === 'texcoord');
    const uv = (texcoord ? lowerInput(texcoord) : undefined) ?? ensureUv();
    return builder.add({ kind: 'texture', type: valueType, texture: nodeId, uv, sampler: nodeId });
  };

  const lowerConvert = (nodeId: string): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const to = irTypeFromMaterialX(node.type) ?? COLOR3;
    const inInput = node.inputs.find((i) => i.name === 'in');
    const from = inInput ? irTypeFromMaterialX(inInput.type) ?? FLOAT : FLOAT;
    const source = (inInput ? lowerInput(inInput) : undefined) ?? builder.constant(from, 0);
    return builder.add({ kind: 'convert', type: to, source, from });
  };

  const lowerCall = (nodeId: string, output?: string): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const type = irTypeFromMaterialX(node.type) ?? COLOR3;
    const namedArgs: Record<string, IrRef> = {};
    for (const input of node.inputs) {
      const ref = lowerInput(input);
      if (ref !== undefined) namedArgs[input.name] = ref;
    }
    for (const input of node.nodeDef?.inputs ?? []) {
      if (namedArgs[input.name] !== undefined || input.value === undefined) continue;
      const inputType = irTypeFromMaterialX(input.type);
      if (inputType?.kind === 'scalar' || inputType?.kind === 'vector') {
        namedArgs[input.name] = constOfIrType(builder, inputType, parseNumbers(input.value));
      }
    }
    const op = node.category === 'artistic_ior' && output === 'extinction' ? 'artistic_ior_extinction' : node.category;
    return builder.add(
      node.nodeDef !== undefined
        ? { kind: 'call', type, op, args: [], namedArgs, nodeDef: node.nodeDef }
        : { kind: 'call', type, op, args: [], namedArgs },
    );
  };

  function lowerNode(nodeId: string, output?: string): IrRef {
    const key = JSON.stringify([nodeId, output]);
    const memo = nodeMemo.get(key);
    if (memo !== undefined) return memo;
    const node = graph.nodes.get(nodeId);
    if (!node) {
      sink({
        level: 'warning',
        message: `Surface input references missing node '${nodeId}'; substituting a neutral constant (REQ-013).`,
        detail: { nodeId },
      });
      const ref = neutralColor();
      nodeMemo.set(key, ref);
      return ref;
    }
    let ref: IrRef;
    if (/^separate[234]$/.test(node.category) && output && /^out[xyzwrgba]$/.test(output)) {
      const input = node.inputs.find((candidate) => candidate.name === 'in');
      const source = (input ? lowerInput(input) : undefined) ?? neutralColor();
      ref = builder.add({ kind: 'swizzle', type: FLOAT, source, pattern: output.slice(3) });
    } else if (TEXTURE_CATEGORIES.has(node.category)) {
      ref = lowerTexture(nodeId);
    } else if (node.category === 'convert') {
      ref = lowerConvert(nodeId);
    } else if (getNodeLowering(node.category)) {
      ref = lowerCall(nodeId, output);
    } else {
      sink({
        level: 'warning',
        message: `Upstream node '${node.category}' (${nodeId}) has no WGSL lowering; its contribution is baked to a neutral constant (REQ-013).`,
        detail: { nodeId, category: node.category },
      });
      ref = constOfIrType(builder, irTypeFromMaterialX(node.type) ?? COLOR3, [0]);
    }
    nodeMemo.set(key, ref);
    return ref;
  }

  const inputs = new Map<string, IrRef>();
  for (const [name, ni] of surface.inputs) {
    let ref: IrRef;
    switch (ni.source.kind) {
      case 'value':
      case 'default':
        ref = constOfIrType(builder, surfaceIrType(ni.type), ni.source.value);
        break;
      case 'connection':
        ref = lowerNode(ni.source.nodeId, ni.source.output);
        break;
      case 'geomprop':
        ref = geomRef(ni.source.name);
        break;
    }
    inputs.set(name, ref);
  }

  return { family: surface.family, nodeId: surface.nodeId, inputs };
}
