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
  NormalizedSurfaceInput,
} from '../materialx/surface-graph.ts';
import {
  COLOR3,
  COLOR4,
  FLOAT,
  INT,
  BOOL,
  OBJECT_TO_WORLD_INPUT,
  WORLD_TO_OBJECT_INPUT,
  OBJECT_POSITION_INPUT,
  OBJECT_NORMAL_INPUT,
  OBJECT_TANGENT_INPUT,
  OBJECT_BITANGENT_INPUT,
  closureType,
  IrModuleBuilder,
  irTypeFromMaterialX,
  matrix,
  vector,
  type IrRef,
  type IrType,
} from './ir.ts';
import { coveredCategories, getNodeLowering } from './nodes.ts';
import { lowerHexTiledImage, type HexTileInputs } from './hextile.ts';
import { AssetResolver } from '../assets/resolver.ts';

export interface LoweredSurfaceInputs {
  readonly family: SurfaceFamily;
  readonly nodeId: string;
  /** Per declared surface input: the IR ref feeding that field. */
  readonly inputs: ReadonlyMap<string, IrRef>;
}

const TEXTURE_CATEGORIES: ReadonlySet<string> = new Set(['image', 'tiledimage', 'hextiledimage']);
const NODEGRAPH_TEXTURE_CATEGORIES: ReadonlySet<string> = new Set(['gltf_image', 'gltf_colorimage', 'gltf_normalmap', 'gltf_iridescence_thickness', 'hextilednormalmap', 'latlongimage', 'triplanarprojection']);

/** Upstream node categories this lowering emits (registry + special-cased nodes). */
export const SURFACE_IR_UPSTREAM: ReadonlySet<string> = new Set([
  ...coveredCategories(),
  ...TEXTURE_CATEGORIES,
  ...NODEGRAPH_TEXTURE_CATEGORIES,
  'convert',
  'geompropvalue',
  'flake2d',
  'flake3d',
  'separate2',
  'separate3',
  'separate4',
]);

function isValueType(type: IrType | undefined): type is IrType {
  return type !== undefined && (type.kind === 'scalar' || type.kind === 'vector' || type.kind === 'matrix');
}

function sameShape(a: IrType, b: IrType): boolean {
  if (a.kind === 'scalar' && b.kind === 'scalar') return a.scalar === b.scalar;
  if (a.kind === 'vector' && b.kind === 'vector') return a.size === b.size && a.scalar === b.scalar;
  if (a.kind === 'matrix' && b.kind === 'matrix') return a.size === b.size;
  return false;
}

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
    case 'BSDF':
      return closureType('bsdf');
    case 'EDF':
      return closureType('edf');
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
  if (irt.kind === 'matrix') {
    const n = irt.size * irt.size;
    const comps: number[] = [];
    for (let i = 0; i < n; i++) comps.push(nums.length === n ? nums[i]! : i % (irt.size + 1) === 0 ? 1 : 0);
    return builder.constant(irt, comps);
  }
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
  return { family: surface.family, nodeId: surface.nodeId,
    inputs: lowerValueInputsToIr(graph, surface.inputs, builder, sink) };
}

/** Shared numeric graph lowering for surface and volume coefficients. */
export function lowerValueInputsToIr(
  graph: ResolvedGraph,
  declaredInputs: ReadonlyMap<string, NormalizedSurfaceInput>,
  builder: IrModuleBuilder,
  sink: DiagnosticSink = defaultDiagnosticSink,
): ReadonlyMap<string, IrRef> {
  const nodeMemo = new Map<string, IrRef>();
  const geomMemo = new Map<string, IrRef>();
  const diagnosedFlakeSize = new Set<string>();
  const diagnosedGeometryDefaults = new Set<string>();
  const diagnosedSplit = new Set<string>();
  const diagnosedTransformGeometry = new Set<string>();
  let transformDepth = 0;
  let uvRef: IrRef | undefined;

  const resourceIdentifier = (name: string): string =>
    name.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
  const reservedResources = new Set([...graph.nodes.keys()].flatMap(name => [
    resourceIdentifier(name), resourceIdentifier(`${name}_udim_index`),
  ]));
  const triplanarResources = new Map<string, Record<'x' | 'y' | 'z', string>>();
  for (const id of [...graph.nodes.keys()].filter(key => graph.nodes.get(key)?.category === 'triplanarprojection').sort()) {
    const names: Record<'x' | 'y' | 'z', string> = { x: '', y: '', z: '' };
    for (const axis of ['x', 'y', 'z'] as const) {
      let name = `${id}__triplanar_${axis}`;
      while (reservedResources.has(resourceIdentifier(name)) || reservedResources.has(resourceIdentifier(`${name}_udim_index`))) name += '_';
      reservedResources.add(resourceIdentifier(name));
      reservedResources.add(resourceIdentifier(`${name}_udim_index`));
      names[axis] = name;
    }
    triplanarResources.set(id, names);
  }

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
    const lower = name.toLowerCase();
    const mapped = lower.startsWith('t') ? 'tangent' : lower.startsWith('b') ? 'bitangent' : 'normal';
    const semantic = mapped === 'normal' ? 'normal' : 'vector';
    const ref = builder.add({ kind: 'input', type: vector(3, 'float', semantic), name: mapped });
    geomMemo.set(name, ref);
    return ref;
  };

  const lowerInput = (input: ResolvedInput): IrRef | undefined => {
    switch (input.source.kind) {
      case 'value': {
        const irt = irTypeFromMaterialX(input.type) ?? FLOAT;
        if (irt.kind === 'string' || irt.kind === 'filename') return undefined;
        if (input.parameter) {
          const value = parseNumbers(input.source.value);
          builder.declareParam({ name: input.parameter, type: irt, defaultValue: value.length === 1 ? value[0]! : value, editable: true });
          return builder.add({ kind: 'param', type: irt, name: input.parameter });
        }
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

  /** Insert a conversion when an upstream value does not match the declared type. */
  const coerce = (ref: IrRef, to: IrType | undefined): IrRef => {
    const from = builder.get(ref)?.type;
    if (!isValueType(to) || !isValueType(from) || sameShape(from, to)) return ref;
    return builder.add({ kind: 'convert', type: to, source: ref, from });
  };

  const callRef = (op: string, type: IrType, namedArgs: Record<string, IrRef>): IrRef =>
    builder.add({ kind: 'call', type, op, args: [], namedArgs });

  const declareTextureAndSampler = (nodeId: string, valueType: IrType) => {
    const node = graph.nodes.get(nodeId)!;
    const file = node.inputs.find((i) => i.name === 'file');
    const fileRef = file?.source.kind === 'value' ? file.source.value
      : node.category === 'latlongimage' ? node.nodeDef?.inputs?.find((input) => input.name === 'file')?.value : undefined;
    const udim = AssetResolver.hasUdim(fileRef ?? '');
    // Record the image reference so the PT texture registry can dedup shared files.
    builder.declareTexture({
      name: nodeId,
      valueType,
      ...(file?.colorSpace !== undefined ? { colorSpace: file.colorSpace } : {}),
      ...(fileRef !== undefined ? { fileRef } : {}),
    });
    const stringInput = (name: string): string | undefined => {
      const input = node.inputs.find((candidate) => candidate.name === name);
      if (input?.source.kind === 'value') return input.source.value;
      return node.nodeDef?.inputs?.find((candidate) => candidate.name === name)?.value;
    };
    const addressU = node.category === 'latlongimage' ? 'periodic' : stringInput('uaddressmode');
    const addressV = node.category === 'latlongimage' ? 'mirror' : stringInput('vaddressmode');
    const filter = node.category === 'latlongimage' ? 'linear' : stringInput('filtertype');
    builder.declareSampler({
      name: nodeId,
      ...(udim ? { addressU: 'clamp', addressV: 'clamp' } : node.category === 'tiledimage' ? { addressU: 'periodic', addressV: 'periodic' } : {
        ...(addressU !== undefined ? { addressU } : {}),
        ...(addressV !== undefined ? { addressV } : {}),
      }),
      ...(filter !== undefined ? { filter } : {}),
    });
    return { udim, addressU, addressV };
  };

  const lowerTexture = (nodeId: string, typeOverride?: IrType, uvOverride?: IrRef): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const valueType = typeOverride ?? irTypeFromMaterialX(node.type) ?? COLOR3;
    const { udim, addressU, addressV } = declareTextureAndSampler(nodeId, valueType);
    const texcoord = node.inputs.find((i) => i.name === 'texcoord');
    let uv = uvOverride ?? (texcoord ? lowerInput(texcoord) : undefined) ?? ensureUv();
    if (uvOverride === undefined && node.category === 'hextiledimage') {
      const uvType = vector(2, 'float', 'texcoord');
      const input = (name: keyof HexTileInputs, type: IrType, fallback: readonly number[]): IrRef => {
        const authored = authoredRef(nodeId, name, type);
        if (authored !== undefined) return authored;
        const declared = node.nodeDef?.inputs?.find((candidate) => candidate.name === name)?.value;
        return constOfIrType(builder, type, declared !== undefined ? parseNumbers(declared) : fallback);
      };
      return lowerHexTiledImage(builder, valueType, {
        texcoord: coerce(uv, uvType),
        tiling: input('tiling', uvType, [1, 1]),
        rotation: input('rotation', FLOAT, [1]),
        rotationrange: input('rotationrange', uvType, [0, 360]),
        scale: input('scale', FLOAT, [1]),
        scalerange: input('scalerange', uvType, [0.5, 2]),
        offset: input('offset', FLOAT, [1]),
        offsetrange: input('offsetrange', uvType, [0, 1]),
        falloff: input('falloff', FLOAT, [0.5]),
        falloffcontrast: input('falloffcontrast', FLOAT, [0.5]),
        lumacoeffs: input('lumacoeffs', COLOR3, [0.2722287, 0.6740818, 0.0536895]),
      }, (coord) => builder.add({ kind: 'texture', type: valueType, texture: nodeId, uv: coord, sampler: nodeId }));
    }
    const uvType = vector(2, 'float', 'texcoord');
    if (node.category === 'tiledimage') {
      const input = (name: string, fallback: readonly number[]): IrRef => {
        const authored = authoredRef(nodeId, name, uvType);
        if (authored !== undefined) return authored;
        const declared = node.nodeDef?.inputs?.find((candidate) => candidate.name === name)?.value;
        return constOfIrType(builder, uvType, declared !== undefined ? parseNumbers(declared) : fallback);
      };
      uv = callRef('multiply', uvType, {
        in1: callRef('divide', uvType, {
          in1: callRef('subtract', uvType, {
            in1: callRef('multiply', uvType, { in1: coerce(uv, uvType), in2: input('uvtiling', [1, 1]) }),
            in2: input('uvoffset', [0, 0]),
          }),
          in2: input('realworldimagesize', [1, 1]),
        }),
        in2: input('realworldtilesize', [1, 1]),
      });
    }
    if (node.category === 'image') {
      const tiling = authoredRef(nodeId, 'uvtiling', uvType);
      const tileOffset = authoredRef(nodeId, 'uvoffset', uvType);
      const scale = authoredRef(nodeId, 'uv_scale', uvType);
      const offset = authoredRef(nodeId, 'uv_offset', uvType);
      if (tiling !== undefined) uv = callRef('multiply', uvType, { in1: coerce(uv, uvType), in2: tiling });
      if (tileOffset !== undefined) uv = callRef('subtract', uvType, { in1: coerce(uv, uvType), in2: tileOffset });
      if (scale !== undefined) uv = callRef('multiply', uvType, { in1: coerce(uv, uvType), in2: scale });
      if (offset !== undefined) uv = callRef('add', uvType, { in1: coerce(uv, uvType), in2: offset });
    }
    if (!udim && (node.category === 'image' || node.category === 'tiledimage' || node.category === 'latlongimage')) {
      uv = callRef('add', uvType, {
        in1: callRef('multiply', uvType, { in1: coerce(uv, uvType), in2: builder.constant(uvType, [1, -1]) }),
        in2: builder.constant(uvType, [0, 1]),
      });
    }
    let sample = builder.add({
      kind: 'texture', type: valueType, texture: nodeId, uv: coerce(uv, uvType), sampler: nodeId,
      ...(udim ? { fallback: authoredRef(nodeId, 'default', valueType) ?? constOfIrType(builder, valueType,
        node.category === 'latlongimage'
          ? parseNumbers(node.nodeDef?.inputs?.find((input) => input.name === 'default')?.value ?? '0')
          : [0]) } : {}),
    });
    for (const [axis, mode] of [['x', addressU], ['y', addressV]] as const) {
      if (udim) continue;
      if (mode !== 'constant') continue;
      const coord = builder.add({ kind: 'swizzle', type: FLOAT, source: uv, pattern: axis });
      const fallback = authoredRef(nodeId, 'default', valueType) ?? constOfIrType(builder, valueType, [0]);
      sample = callRef('ifgreater', valueType, {
        value1: coord, value2: builder.constant(FLOAT, 1), in1: fallback, in2: sample,
      });
      sample = callRef('ifgreater', valueType, {
        value1: builder.constant(FLOAT, 0), value2: coord, in1: fallback, in2: sample,
      });
    }
    return sample;
  };

  const authoredRef = (nodeId: string, name: string, type: IrType): IrRef | undefined => {
    const input = graph.nodes.get(nodeId)!.inputs.find((i) => i.name === name);
    const ref = input ? lowerInput(input) : undefined;
    return ref !== undefined ? coerce(ref, type) : undefined;
  };

  const geometryDefault = (nodeId: string, name: 'position' | 'normal', ref: IrRef | undefined): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const authored = node.inputs.find(input => input.name === name);
    const objectProp = name === 'position' ? 'Pobject' : 'Nobject';
    const worldProp = name === 'position' ? 'Pworld' : 'Nworld';
    const geomprop = node.nodeDef?.inputs?.find(input => input.name === name)?.geomprop ?? objectProp;
    const key = JSON.stringify([nodeId, name]);
    if ((authored?.source.kind === 'interface' || (ref === undefined && geomprop !== objectProp && geomprop !== worldProp))
        && !diagnosedGeometryDefaults.has(key)) {
      diagnosedGeometryDefaults.add(key);
      const fallback = ref === undefined ? `${geomprop === worldProp ? 'world' : 'object'}-space` : 'declared';
      sink({
        level: 'warning',
        message: `${node.category} '${nodeId}' has an unsupported or unresolved ${name}; using its ${fallback} default.`,
        detail: { nodeId, geomprop },
      });
    }
    return ref ?? builder.add({
      kind: 'input', type: vector(3, 'float', 'vector'),
      name: geomprop === worldProp ? name : name === 'position' ? OBJECT_POSITION_INPUT : OBJECT_NORMAL_INPUT,
    });
  };

  // Nodegraph-backed texture nodes lower to texture samples and small IR graphs.
  const lowerNodegraphTexture = (nodeId: string, output?: string): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    switch (node.category) {
      case 'triplanarprojection': {
        const type = irTypeFromMaterialX(node.type);
        if (!type || !(type.kind === 'scalar' && type.scalar === 'float'
            || type.kind === 'vector' && type.scalar === 'float')) {
          sink({ level: 'warning', message: `Unsupported triplanarprojection type '${node.type}' on '${nodeId}'; using zero.`, detail: { nodeId } });
          return neutralColor();
        }
        const input = (name: string, inputType: IrType, fallback: readonly number[]): IrRef => {
          const authored = authoredRef(nodeId, name, inputType);
          if (authored !== undefined) return authored;
          const declared = node.nodeDef?.inputs?.find(candidate => candidate.name === name)?.value;
          return constOfIrType(builder, inputType, declared !== undefined ? parseNumbers(declared) : fallback);
        };
        const fallback = input('default', type, [0]);
        const rawFilter = staticStringInput(nodeId, 'filtertype', 'linear');
        const filter = rawFilter === 'closest' || rawFilter === 'linear' || rawFilter === 'cubic' ? rawFilter : 'linear';
        if (rawFilter === undefined || rawFilter !== filter) {
          sink({ level: 'warning', message: `triplanarprojection '${nodeId}' has an unsupported or unresolved filter; using linear.`, detail: { nodeId, filter: rawFilter } });
        } else if (filter === 'cubic') {
          sink({ level: 'warning', message: `triplanarprojection '${nodeId}' approximates cubic filtering with linear filtering.`, detail: { nodeId } });
        }
        const axes = ['x', 'y', 'z'] as const;
        const files = new Map<typeof axes[number], string>();
        for (const axis of axes) {
          const layer = staticStringInput(nodeId, `layer${axis}`);
          if (layer === undefined || layer !== '') {
            sink({ level: 'warning', message: `triplanarprojection '${nodeId}' cannot select layer${axis}; using the base image.`, detail: { nodeId, axis, layer } });
          }
          const file = staticStringInput(nodeId, `file${axis}`, '', true);
          if (file === undefined || /(?:\{(?:frame|0[1-9]\d*frame)\}|%7b|\[[A-Za-z_][A-Za-z0-9_]*\]|%5b)/i.test(file)) {
            sink({ level: 'warning', message: `triplanarprojection '${nodeId}' has an unsupported or unresolved file${axis}; using its default.`, detail: { nodeId, axis } });
          } else if (file !== '') {
            files.set(axis, file);
          }
        }
        if (files.size === 0) return fallback;

        const vec2 = vector(2, 'float', 'texcoord');
        const vec3 = vector(3, 'float', 'vector');
        const geometry = (name: 'position' | 'normal'): IrRef => {
          transformDepth++;
          let authored: IrRef | undefined;
          try { authored = authoredRef(nodeId, name, vec3); } finally { transformDepth--; }
          const declared = node.nodeDef?.inputs?.find(candidate => candidate.name === name)?.value;
          return geometryDefault(nodeId, name, authored ?? (declared === undefined
            ? undefined : constOfIrType(builder, vec3, parseNumbers(declared))));
        };
        const position = geometry('position');
        const normal = geometry('normal');
        const normalExpr = builder.get(normal);
        if (normalExpr?.kind === 'const' && Array.isArray(normalExpr.value) && normalExpr.value.every(component => component === 0)) {
          sink({ level: 'warning', message: `triplanarprojection '${nodeId}' has a zero normal; its blend weights are undefined.`, detail: { nodeId } });
        }
        const component = (source: IrRef, pattern: string): IrRef =>
          builder.add({ kind: 'swizzle', type: FLOAT, source, pattern });
        const combine = (a: IrRef, b: IrRef): IrRef => callRef('combine2', vec2, { in1: a, in2: b });
        const x = component(position, 'x');
        const y = component(position, 'y');
        const z = component(position, 'z');
        const upaxis = input('upaxis', INT, [2]);
        const choose = (a: IrRef, b: IrRef, c: IrRef): IrRef =>
          callRef('switch', vec2, { in1: a, in2: b, in3: c, which: upaxis });
        const xy = combine(x, y);
        const xz = combine(x, z);
        const yz = combine(y, z);
        const coordinates = {
          x: choose(combine(z, y), combine(z, y), yz),
          y: choose(combine(z, x), xz, xz),
          z: choose(combine(callRef('multiply', FLOAT, { in1: y, in2: builder.constant(FLOAT, -1) }), x), xy, xy),
        };
        const names = triplanarResources.get(nodeId)!;
        const samples = axes.map(axis => {
          const file = files.get(axis);
          if (file === undefined) return fallback;
          const udim = AssetResolver.hasUdim(file);
          const texture = names[axis];
          const sampler = udim ? names.y : names.x;
          const source = node.inputs.find(candidate => candidate.name === `file${axis}`);
          builder.declareTexture({
            name: texture, valueType: type, fileRef: file,
            ...(source?.colorSpace !== undefined ? { colorSpace: source.colorSpace } : {}),
          });
          builder.declareSampler({
            name: sampler, addressU: udim ? 'clamp' : 'periodic', addressV: udim ? 'clamp' : 'periodic', filter,
          });
          const uv = udim ? coordinates[axis] : callRef('add', vec2, {
            in1: callRef('multiply', vec2, { in1: coordinates[axis], in2: builder.constant(vec2, [1, -1]) }),
            in2: builder.constant(vec2, [0, 1]),
          });
          return builder.add({
            kind: 'texture', type, texture, uv, sampler, ...(udim ? { fallback } : {}),
          });
        });
        const ones = builder.constant(vec3, [1, 1, 1]);
        const absolute = callRef('absval', vec3, { in: callRef('normalize', vec3, { in: normal }) });
        const sum = (value: IrRef): IrRef => callRef('dotproduct', FLOAT, { in1: value, in2: ones });
        const weights = callRef('divide', vec3, { in1: absolute, in2: sum(absolute) });
        const blend = callRef('clamp', FLOAT, { in: input('blend', FLOAT, [1]), low: builder.constant(FLOAT, 0.03) });
        const power = callRef('power', vec3, {
          in1: weights, in2: callRef('divide', FLOAT, { in1: builder.constant(FLOAT, 1), in2: blend }),
        });
        const normalized = callRef('divide', vec3, { in1: power, in2: sum(power) });
        const weighted = samples.map((sample, index) => callRef('multiply', type, {
          in1: sample, in2: component(normalized, axes[index]!),
        }));
        return callRef('add', type, {
          in1: callRef('add', type, { in1: weighted[0]!, in2: weighted[1]! }), in2: weighted[2]!,
        });
      }
      case 'latlongimage': {
        const file = node.inputs.find((input) => input.name === 'file');
        if (file && file.source.kind !== 'value' && file.source.kind !== 'default') {
          sink({
            level: 'warning',
            message: `Dynamic filename on latlongimage '${nodeId}' is unsupported; using its default color.`,
            detail: { nodeId },
          });
        }
        const fileRef = file?.source.kind === 'value' ? file.source.value
          : file && file.source.kind !== 'default' ? undefined
            : node.nodeDef?.inputs?.find((input) => input.name === 'file')?.value;
        const input = (name: string, type: IrType, fallback: readonly number[]): IrRef => {
          const authored = authoredRef(nodeId, name, type);
          if (authored !== undefined) return authored;
          const declared = node.nodeDef?.inputs?.find((candidate) => candidate.name === name)?.value;
          return constOfIrType(builder, type, declared !== undefined ? parseNumbers(declared) : fallback);
        };
        if (!fileRef?.trim()) return input('default', COLOR3, [0, 0, 0]);

        const vec3 = vector(3, 'float', 'vector');
        const vec2 = vector(2, 'float', 'texcoord');
        const viewdir = input('viewdir', vec3, [0, 0, 1]);
        const component = (pattern: string): IrRef =>
          builder.add({ kind: 'swizzle', type: FLOAT, source: viewdir, pattern });
        const binary = (op: string, in1: IrRef, in2: IrRef): IrRef => callRef(op, FLOAT, { in1, in2 });
        const longitude = binary('add',
          binary('multiply', callRef('atan2', FLOAT, { iny: component('x'), inx: component('z') }), builder.constant(FLOAT, -0.15915494)),
          builder.constant(FLOAT, 0.5));
        const u = binary('add', binary('multiply', input('rotation', FLOAT, [0]), builder.constant(FLOAT, 0.00277778)), longitude);
        const v = binary('add',
          binary('multiply', callRef('asin', FLOAT, { in: component('y') }), builder.constant(FLOAT, 0.31830989)),
          builder.constant(FLOAT, 0.5));
        return lowerTexture(nodeId, COLOR3, callRef('combine2', vec2, { in1: u, in2: v }));
      }
      case 'gltf_colorimage': {
        let color = lowerTexture(nodeId, COLOR4);
        for (const name of ['color', 'geomcolor']) {
          const factor = authoredRef(nodeId, name, COLOR4);
          if (factor !== undefined) color = callRef('multiply', COLOR4, { in1: color, in2: factor });
        }
        return output === 'outa'
          ? builder.add({ kind: 'swizzle', type: FLOAT, source: color, pattern: 'w' })
          : builder.add({ kind: 'swizzle', type: COLOR3, source: color, pattern: 'xyz' });
      }
      case 'gltf_normalmap': {
        const vec3 = vector(3, 'float', 'vector');
        return callRef('normalmap', vec3, { in: lowerTexture(nodeId, vec3) });
      }
      case 'hextilednormalmap': {
        const vec2 = vector(2, 'float', 'texcoord');
        const vec3 = vector(3, 'float', 'vector');
        const uv = authoredRef(nodeId, 'texcoord', vec2) ?? ensureUv();
        const input = (name: string, type: IrType, fallback: readonly number[]): IrRef => {
          const authored = authoredRef(nodeId, name, type);
          if (authored !== undefined) return authored;
          const declared = node.nodeDef?.inputs?.find((candidate) => candidate.name === name)?.value;
          return constOfIrType(builder, type, declared !== undefined ? parseNumbers(declared) : fallback);
        };
        declareTextureAndSampler(nodeId, vec3);
        const flipG = input('flip_g', BOOL, [0]);
        const one = builder.constant(FLOAT, 1);
        const half = builder.constant(FLOAT, 0.5);
        const two = builder.constant(FLOAT, 2);
        const component = (source: IrRef, pattern: string): IrRef =>
          builder.add({ kind: 'swizzle', type: FLOAT, source, pattern });
        const binary = (op: string, in1: IrRef, in2: IrRef): IrRef =>
          callRef(op, FLOAT, { in1, in2 });
        const hexNormal = lowerHexTiledImage(builder, vec3, {
          texcoord: coerce(uv, vec2),
          tiling: input('tiling', vec2, [1, 1]),
          rotation: input('rotation', FLOAT, [1]),
          rotationrange: input('rotationrange', vec2, [0, 360]),
          scale: input('scale', FLOAT, [1]),
          scalerange: input('scalerange', vec2, [0.5, 2]),
          offset: input('offset', FLOAT, [1]),
          offsetrange: input('offsetrange', vec2, [0, 1]),
          falloff: input('falloff', FLOAT, [0.5]),
          falloffcontrast: builder.constant(FLOAT, 0),
          lumacoeffs: builder.constant(COLOR3, [0.2722287, 0.6740818, 0.0536895]),
        }, (coord) => builder.add({ kind: 'texture', type: vec3, texture: nodeId, uv: coord, sampler: nodeId }), (sample, rotation) => {
          const nx = binary('subtract', binary('multiply', two, component(sample, 'x')), one);
          const sampleY = component(sample, 'y');
          const ny = binary('subtract', binary('multiply', two, sampleY), one);
          const flippedY = callRef('ifequal', FLOAT, {
            value1: flipG,
            value2: builder.constant(BOOL, 1),
            in1: binary('multiply', ny, builder.constant(FLOAT, -1)),
            in2: ny,
          });
          const sine = callRef('sin', FLOAT, { in: rotation });
          const cosine = callRef('cos', FLOAT, { in: rotation });
          const rotatedX = binary('subtract', binary('multiply', nx, cosine), binary('multiply', flippedY, sine));
          const rotatedY = binary('add', binary('multiply', nx, sine), binary('multiply', flippedY, cosine));
          const encodedX = binary('add', binary('multiply', half, rotatedX), half);
          const encodedY = binary('add', binary('multiply', half, rotatedY), half);
          return callRef('combine3', vec3, {
            in1: encodedX,
            in2: encodedY,
            in3: component(sample, 'z'),
          });
        });
        const args: Record<string, IrRef> = {
          in: hexNormal,
          scale: input('strength', FLOAT, [1]),
        };
        for (const name of ['normal', 'tangent', 'bitangent']) {
          const ref = authoredRef(nodeId, name, vec3);
          if (ref !== undefined) args[name] = ref;
        }
        return callRef('normalmap', vec3, args);
      }
      case 'gltf_iridescence_thickness': {
        const sample = lowerTexture(nodeId, vector(3, 'float', 'vector'));
        const g = builder.add({ kind: 'swizzle', type: FLOAT, source: sample, pattern: 'y' });
        return callRef('mix', FLOAT, {
          fg: authoredRef(nodeId, 'thicknessMin', FLOAT) ?? builder.constant(FLOAT, 100),
          bg: authoredRef(nodeId, 'thicknessMax', FLOAT) ?? builder.constant(FLOAT, 400),
          mix: g,
        });
      }
      default: {
        const type = irTypeFromMaterialX(node.type) ?? COLOR3;
        const tex = lowerTexture(nodeId);
        const factor = authoredRef(nodeId, 'factor', type);
        return factor !== undefined ? callRef('multiply', type, { in1: tex, in2: factor }) : tex;
      }
    }
  };

  const lowerConvert = (nodeId: string): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const to = irTypeFromMaterialX(node.type) ?? COLOR3;
    const inInput = node.inputs.find((i) => i.name === 'in');
    const def = node.nodeDef?.inputs?.find((input) => input.name === 'in');
    const declared = irTypeFromMaterialX(def?.type ?? inInput?.type ?? '') ?? FLOAT;
    const raw = (inInput ? lowerInput(inInput) : undefined) ?? constOfIrType(builder, declared, parseNumbers(def?.value ?? '0'));
    const source = coerce(raw, declared);
    const from = builder.get(source)?.type ?? declared;
    return builder.add({ kind: 'convert', type: to, source, from });
  };

  const lowerCall = (nodeId: string, output?: string, override?: { op: string; type: IrType }): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const type = override?.type ?? irTypeFromMaterialX(node.type) ?? COLOR3;
    const declaredTypes = new Map<string, IrType | undefined>();
    for (const input of node.nodeDef?.inputs ?? []) declaredTypes.set(input.name, irTypeFromMaterialX(input.type));
    const namedArgs: Record<string, IrRef> = {};
    for (const input of node.inputs) {
      let ref: IrRef | undefined;
      if (node.category === 'worleynoise3d' && input.name === 'position') {
        transformDepth++;
        try { ref = lowerInput(input); } finally { transformDepth--; }
      } else {
        ref = lowerInput(input);
      }
      if (ref !== undefined) namedArgs[input.name] = coerce(ref, declaredTypes.get(input.name) ?? irTypeFromMaterialX(input.type));
    }
    for (const input of node.nodeDef?.inputs ?? []) {
      if (namedArgs[input.name] !== undefined || input.value === undefined) continue;
      const inputType = irTypeFromMaterialX(input.type);
      if (isValueType(inputType)) {
        namedArgs[input.name] = constOfIrType(builder, inputType, parseNumbers(input.value));
      }
    }
    if (node.category === 'flake3d' || node.category === 'worleynoise3d') {
      namedArgs.position = geometryDefault(nodeId, 'position', namedArgs.position);
    }
    const op = override?.op ?? (node.category === 'artistic_ior' && output === 'extinction' ? 'artistic_ior_extinction' : node.category);
    return builder.add(
      node.nodeDef !== undefined
        ? { kind: 'call', type, op, args: [], namedArgs, nodeDef: node.nodeDef }
        : { kind: 'call', type, op, args: [], namedArgs },
    );
  };

  const staticStringInput = (nodeId: string, name: string, fallback = '', resolveFilenameTokens = false): string | undefined => {
    const node = graph.nodes.get(nodeId)!;
    let candidate = node.inputs.find(item => item.name === name);
    let declared = node.nodeDef?.inputs?.find(item => item.name === name)?.value;
    const seen = new Set<string>();
    const tokenSources: Readonly<Record<string, string>>[] = [];
    if (resolveFilenameTokens && candidate?.filenameTokens) tokenSources.push(candidate.filenameTokens);
    while (!candidate?.parameter && candidate?.source.kind === 'connection') {
      const { nodeId: upstreamId, output } = candidate.source;
      const upstream = graph.nodes.get(upstreamId);
      if (!upstream || seen.has(upstreamId) || upstream.category !== 'constant' || !['string', 'filename'].includes(upstream.type)
          || (output !== undefined && output !== 'out')) break;
      seen.add(upstreamId);
      candidate = upstream.inputs.find(item => item.name === 'value');
      declared = upstream.nodeDef?.inputs?.find(item => item.name === 'value')?.value;
      if (resolveFilenameTokens && candidate?.filenameTokens) tokenSources.push(candidate.filenameTokens);
    }
    if (candidate?.parameter || candidate?.source.kind === 'connection' || candidate?.source.kind === 'interface') {
      return undefined;
    }
    let result = (candidate?.source.kind === 'value' ? candidate.source.value : declared ?? fallback).trim();
    for (const tokens of tokenSources) {
      result = result.replace(/(?:\[|%5b)([A-Za-z_][A-Za-z0-9_]*)(?:\]|%5d)/gi,
        (token, key: string) => Object.hasOwn(tokens, key) ? tokens[key]! : token);
    }
    return result;
  };

  const lowerTransformGeometry = (nodeId: string): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const space = staticStringInput(nodeId, 'space', 'object');
    if (node.category === 'tangent' || node.category === 'bitangent') {
      const index = node.inputs.find(input => input.name === 'index');
      const raw = index?.source.kind === 'value' ? index.source.value
        : index && index.source.kind !== 'default' ? undefined
          : node.nodeDef?.inputs?.find(input => input.name === 'index')?.value ?? '0';
      if (index?.parameter || raw === undefined || Number(raw) !== 0) {
        sink({
          level: 'warning',
          message: `Geometric node '${nodeId}' supports tangent index 0 only; using index 0.`,
          detail: { nodeId, index: raw },
        });
      }
    }
    if (space !== 'object' && space !== 'model' && space !== 'world') {
      if (!diagnosedTransformGeometry.has(nodeId)) {
        diagnosedTransformGeometry.add(nodeId);
        sink({
          level: 'warning',
          message: `Geometric node '${nodeId}' has unsupported or unresolved space '${space ?? '<dynamic>'}'; using world-space data.`,
          detail: { nodeId, space },
        });
      }
      return lowerCall(nodeId);
    }
    const type = vector(3, 'float', 'vector');
    if (space === 'world' && node.category === 'position') {
      return builder.add({ kind: 'input', type, name: 'position' });
    }
    const names: Record<string, string> = {
      position: OBJECT_POSITION_INPUT,
      normal: OBJECT_NORMAL_INPUT,
      tangent: OBJECT_TANGENT_INPUT,
      bitangent: OBJECT_BITANGENT_INPUT,
    };
    const source = builder.add({ kind: 'input', type, name: names[node.category]! });
    if (space !== 'world') return source;
    const normal = node.category === 'normal';
    const mat = builder.add({ kind: 'input', type: matrix(4), name: normal ? WORLD_TO_OBJECT_INPUT : OBJECT_TO_WORLD_INPUT });
    const transformed = callRef(normal ? 'transformnormal' : 'transformvector', type, { in: source, mat });
    return normal ? transformed : callRef('normalize', type, { in: transformed });
  };

  const lowerSpaceTransform = (nodeId: string): IrRef => {
    const node = graph.nodes.get(nodeId)!;
    const type = vector(3, 'float', 'vector');
    const input = node.inputs.find(candidate => candidate.name === 'in');
    const defaultInput = node.nodeDef?.inputs?.find(candidate => candidate.name === 'in')?.value;
    const fallback = node.category === 'transformnormal' ? '0,0,1' : '0,0,0';
    transformDepth++;
    let source: IrRef;
    try {
      source = (input ? lowerInput(input) : undefined)
        ?? constOfIrType(builder, type, parseNumbers(defaultInput ?? fallback));
    } finally {
      transformDepth--;
    }
    const namedArgs: Record<string, IrRef> = { in: coerce(source, type) };

    const space = (name: string): string | undefined => {
      const result = staticStringInput(nodeId, name);
      if (result === undefined) {
        sink({
          level: 'warning',
          message: `${node.category} '${nodeId}' has an unresolved ${name}; using the MaterialX identity fallback.`,
          detail: { nodeId, input: name },
        });
        return undefined;
      }
      if (result !== '' && result !== 'object' && result !== 'model' && result !== 'world') {
        sink({
          level: 'warning',
          message: `${node.category} '${nodeId}' does not support ${name} '${result}'; using the MaterialX identity fallback.`,
          detail: { nodeId, input: name, space: result },
        });
        return undefined;
      }
      return result === 'model' ? 'object' : result;
    };

    const from = space('fromspace');
    const to = space('tospace');
    if (from && to && from !== to) {
      const forward = from === 'object' && to === 'world';
      const needsInverse = node.category === 'transformnormal' ? forward : !forward;
      const name = needsInverse ? WORLD_TO_OBJECT_INPUT : OBJECT_TO_WORLD_INPUT;
      namedArgs.mat = builder.add({ kind: 'input', type: matrix(4), name });
    }
    return callRef(node.category, type, namedArgs);
  };

  function lowerNode(nodeId: string, output?: string): IrRef {
    const key = JSON.stringify([nodeId, output, transformDepth > 0]);
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
    if (/^separate[234]$/.test(node.category)) {
      const size = Number(node.category.slice(-1)) as 2 | 3 | 4;
      const channel = output?.match(/^out([xyzwrgba])$/)?.[1];
      if (!channel || !('xyzw'.slice(0, size).includes(channel) || 'rgba'.slice(0, size).includes(channel))) {
        sink({
          level: 'warning',
          message: `Unsupported ${node.category} output '${output ?? '<unspecified>'}' on '${nodeId}'; using zero.`,
          detail: { nodeId, output },
        });
        ref = builder.constant(FLOAT, 0);
      } else {
        const input = node.inputs.find((candidate) => candidate.name === 'in');
        const declared = node.nodeDef?.inputs?.find((candidate) => candidate.name === 'in');
        const type = irTypeFromMaterialX(input?.type ?? declared?.type ?? '') ?? vector(size);
        const raw = (input ? lowerInput(input) : undefined)
          ?? constOfIrType(builder, type, parseNumbers(declared?.value ?? '0'));
        const source = coerce(raw, type);
        ref = builder.add({ kind: 'swizzle', type: FLOAT, source, pattern: channel });
      }
    } else if (node.category === 'splitlr' || node.category === 'splittb') {
      if (!diagnosedSplit.has(nodeId)) {
        diagnosedSplit.add(nodeId);
        sink({
          level: 'warning',
          message: `${node.category} '${nodeId}' uses a hard boundary; MaterialX's GLSL reference antialiases the split.`,
          detail: { nodeId, category: node.category },
        });
      }
      ref = lowerCall(nodeId, output);
    } else if (node.category === 'blur') {
      const input = node.inputs.find((candidate) => candidate.name === 'in');
      const type = irTypeFromMaterialX(node.type) ?? COLOR3;
      const source = input ? lowerInput(input) : undefined;
      const declaredDefault = node.nodeDef?.inputs?.find((candidate) => candidate.name === 'in')?.value;
      ref = source !== undefined
        ? coerce(source, type)
        : constOfIrType(builder, type, parseNumbers(declaredDefault ?? '0'));

      const size = node.inputs.find((candidate) => candidate.name === 'size');
      const authoredSize = size?.source.kind === 'value' ? Number.parseFloat(size.source.value) : undefined;
      const defaultSize = node.nodeDef?.inputs?.find((candidate) => candidate.name === 'size')?.value;
      const parsedDefaultSize = defaultSize !== undefined ? Number.parseFloat(defaultSize) : 0;
      if (size?.parameter !== undefined || size?.source.kind === 'connection' || size?.source.kind === 'interface'
          || authoredSize !== undefined && authoredSize !== 0
          || (size === undefined || size.source.kind === 'default') && parsedDefaultSize !== 0) {
        sink({
          level: 'warning',
          message: `blur '${nodeId}' uses MaterialX's pass-through implementation; nonzero or dynamic size does not blur the input.`,
          detail: { nodeId },
        });
      }
    } else if (node.category === 'flake2d' || node.category === 'flake3d') {
      const size = node.inputs.find((input) => input.name === 'size');
      const rawSize = size?.source.kind === 'value' ? size.source.value
        : !size || size.source.kind === 'default' ? node.nodeDef?.inputs?.find((input) => input.name === 'size')?.value : undefined;
      if (rawSize !== undefined && (!Number.isFinite(Number.parseFloat(rawSize)) || Number.parseFloat(rawSize) === 0)
          && !diagnosedFlakeSize.has(nodeId)) {
        diagnosedFlakeSize.add(nodeId);
        sink({
          level: 'warning',
          message: `${node.category} '${nodeId}' requires a finite, nonzero size; its result is undefined.`,
          detail: { nodeId, size: rawSize },
        });
      }
      if (output === 'id' || output === 'rand' || output === 'presence' || output === 'flakenormal') {
        const type = output === 'id' ? INT : output === 'flakenormal' ? vector(3, 'float', 'vector') : FLOAT;
        ref = lowerCall(nodeId, output, { op: `${node.category}_${output}`, type });
      } else {
        sink({
          level: 'warning',
          message: `Unsupported ${node.category} output '${output ?? '<unspecified>'}' on '${nodeId}'; using zero.`,
          detail: { nodeId, output },
        });
        ref = builder.constant(FLOAT, 0);
      }
    } else if (node.category === 'geompropvalue') {
      const property = node.inputs.find(input => input.name === 'geomprop');
      const name = property?.source.kind === 'value' ? property.source.value : undefined;
      if (node.type === 'vector2' && (name === 'st' || name === 'UV0')) {
        ref = ensureUv();
      } else {
        sink({
          level: 'warning',
          message: `Unsupported geometry property '${name ?? '<dynamic>'}' (${node.type}) on '${nodeId}'; using its declared default.`,
          detail: { nodeId, property: name, type: node.type },
        });
        const type = irTypeFromMaterialX(node.type) ?? FLOAT;
        ref = authoredRef(nodeId, 'default', type)
          ?? constOfIrType(builder, type, parseNumbers(node.nodeDef?.inputs?.find(input => input.name === 'default')?.value ?? '0'));
      }
    } else if (TEXTURE_CATEGORIES.has(node.category)) {
      ref = lowerTexture(nodeId);
    } else if (NODEGRAPH_TEXTURE_CATEGORIES.has(node.category)) {
      ref = lowerNodegraphTexture(nodeId, output);
    } else if (node.category === 'convert') {
      ref = lowerConvert(nodeId);
    } else if (node.category === 'transformpoint' || node.category === 'transformvector' || node.category === 'transformnormal') {
      ref = lowerSpaceTransform(nodeId);
    } else if (transformDepth > 0 && ['position', 'normal', 'tangent', 'bitangent'].includes(node.category)) {
      ref = lowerTransformGeometry(nodeId);
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
  for (const [name, ni] of declaredInputs) {
    let ref: IrRef;
    switch (ni.source.kind) {
      case 'value':
      case 'default':
        if (ni.parameter) {
          const type = surfaceIrType(ni.type);
          builder.declareParam({ name: ni.parameter, type, defaultValue: ni.source.value.length === 1 ? ni.source.value[0]! : [...ni.source.value], editable: true });
          ref = builder.add({ kind: 'param', type, name: ni.parameter });
        } else {
          ref = constOfIrType(builder, surfaceIrType(ni.type), ni.source.value);
        }
        break;
      case 'connection':
        ref = coerce(lowerNode(ni.source.nodeId, ni.source.output), surfaceIrType(ni.type));
        break;
      case 'geomprop':
        ref = geomRef(ni.source.name);
        break;
    }
    inputs.set(name, ref);
  }

  return inputs;
}
