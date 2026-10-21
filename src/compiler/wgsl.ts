// WGSL backend (plan section 7, T014). Walks a ShaderIr and emits a complete,
// deterministic WGSL module: a uniform block for editable parameters, texture and
// sampler bindings, a varyings struct, and an `mx_shade` function that evaluates
// every reachable expression once (CSE is already applied upstream) and returns
// the shader outputs. Per-node math/closure lowering comes from nodes.ts.

import type {
  IrConstValue,
  IrExpr,
  IrRef,
  IrType,
  ShaderIr,
} from './ir.ts';
import {
  CLOSURE_PRELUDE,
  LIGHTING_PRELUDE,
  closureUsesLighting,
  getNodeLowering,
  type NodeEmitContext,
  type NodeInputs,
} from './nodes.ts';

export class WgslEmitError extends Error {
  override readonly name = 'WgslEmitError';
}

export interface WgslUniformField {
  name: string;
  field: string;
  wgslType: string;
}

export interface WgslBinding {
  name: string;
  handle: string;
  group: number;
  binding: number;
  /** Image reference (textures only); the PT registry dedups shared files. */
  fileRef?: string;
}

export interface WgslOutput {
  name: string;
  field: string;
  wgslType: string;
}

export interface WgslModule {
  code: string;
  entryPoint: string;
  uniforms: WgslUniformField[];
  textures: WgslBinding[];
  samplers: WgslBinding[];
  outputs: WgslOutput[];
  /** Present when the module declares the lighting context uniform (surface node). */
  lighting?: { group: number; binding: number };
}

const ENTRY_POINT = 'mx_shade';

function ident(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;
}

export function wgslType(type: IrType): string {
  switch (type.kind) {
    case 'scalar':
      return type.scalar === 'float' ? 'f32' : type.scalar === 'int' ? 'i32' : 'bool';
    case 'vector': {
      const suffix = type.scalar === 'float' ? 'f' : type.scalar === 'int' ? 'i' : 'u';
      return `vec${type.size}${suffix}`;
    }
    case 'matrix':
      return `mat${type.size}x${type.size}f`;
    case 'closure':
    case 'shader':
      return 'Closure';
    case 'string':
    case 'filename':
      throw new WgslEmitError(`type ${type.kind} has no WGSL representation`);
  }
}

export function litFloat(n: number): string {
  if (!Number.isFinite(n)) throw new WgslEmitError(`non-finite float literal ${n}`);
  return Number.isInteger(n) ? `${n}.0` : `${n}`;
}

function litConst(type: IrType, value: IrConstValue): string {
  switch (type.kind) {
    case 'scalar':
      if (type.scalar === 'bool') return value ? 'true' : 'false';
      if (type.scalar === 'int') return `${Math.trunc(value as number)}`;
      return litFloat(value as number);
    case 'vector': {
      const comps = value as readonly number[];
      return `${wgslType(type)}(${comps.map(litFloat).join(', ')})`;
    }
    case 'matrix': {
      const comps = Array.isArray(value) ? (value as readonly number[]) : [];
      if (comps.length !== type.size * type.size) return identityMatrix(type.size);
      return `${wgslType(type)}(${comps.map(litFloat).join(', ')})`;
    }
    default:
      throw new WgslEmitError(`cannot emit constant of type ${type.kind}`);
  }
}

function childRefs(expr: IrExpr): IrRef[] {
  switch (expr.kind) {
    case 'const':
    case 'param':
    case 'input':
    case 'primvar':
      return [];
    case 'convert':
    case 'swizzle':
      return [expr.source];
    case 'texture': {
      const refs = [expr.uv];
      if (expr.lod) refs.push(expr.lod);
      if (expr.bias) refs.push(expr.bias);
      if (expr.gradient) refs.push(expr.gradient.ddx, expr.gradient.ddy);
      return refs;
    }
    case 'call':
      return [...expr.args, ...Object.values(expr.namedArgs ?? {})];
    case 'closure':
      return Object.values(expr.params);
    case 'combine':
      return expr.weight ? [...expr.operands, expr.weight] : [...expr.operands];
  }
}

function topoOrder(ir: ShaderIr): IrRef[] {
  const order: IrRef[] = [];
  const state = new Map<IrRef, 'visiting' | 'done'>();
  const visit = (ref: IrRef): void => {
    const s = state.get(ref);
    if (s === 'done') return;
    if (s === 'visiting') throw new WgslEmitError(`cycle in IR at ${ref}`);
    const expr = ir.exprs.get(ref);
    if (!expr) throw new WgslEmitError(`dangling IR reference ${ref}`);
    state.set(ref, 'visiting');
    for (const child of childRefs(expr)) visit(child);
    state.set(ref, 'done');
    order.push(ref);
  };
  for (const out of ir.outputs) visit(out.ref);
  return order;
}

function makeInputs(
  positional: readonly string[],
  named: Readonly<Record<string, string>>,
  namedCall = false,
  types: Readonly<Record<string, IrType>> = {},
): NodeInputs {
  return {
    at(index, fallback) {
      const v = positional[index];
      if (v !== undefined) return v;
      if (fallback !== undefined) return fallback;
      throw new WgslEmitError(`missing positional argument ${index}`);
    },
    named(name, fallback, legacyIndex) {
      const v = named[name] ?? (!namedCall && legacyIndex !== undefined ? positional[legacyIndex] : undefined);
      if (v !== undefined) return v;
      if (fallback !== undefined) return fallback;
      throw new WgslEmitError(`missing named input '${name}'`);
    },
    has(name) {
      return named[name] !== undefined;
    },
    typeOf(name) {
      return types[name];
    },
  };
}

function addPreludes(preludes: Set<string>, prelude: string | readonly string[] | undefined): void {
  if (prelude === undefined) return;
  if (typeof prelude === 'string') preludes.add(prelude);
  else for (const p of prelude) preludes.add(p);
}

function identityMatrix(size: number): string {
  const comps: string[] = [];
  for (let c = 0; c < size; c++) for (let r = 0; r < size; r++) comps.push(c === r ? '1.0' : '0.0');
  return `mat${size}x${size}f(${comps.join(', ')})`;
}

function emitConvert(src: string, from: IrType, to: IrType): string {
  if (to.kind === 'matrix') {
    return from.kind === 'matrix' && from.size === to.size ? src : identityMatrix(to.size);
  }
  if (to.kind === 'vector') {
    const target = wgslType(to);
    if (from.kind === 'scalar') {
      const scalar = from.scalar === to.scalar ? src : `${wgslType({ kind: 'scalar', scalar: to.scalar })}(${src})`;
      return `${target}(${scalar})`;
    }
    if (from.kind === 'vector') {
      const cast = (s: string, size: number): string =>
        from.scalar === to.scalar ? s : `${wgslType({ kind: 'vector', scalar: to.scalar, size: size as 2 | 3 | 4 })}(${s})`;
      if (from.size === to.size) return cast(src, to.size);
      if (from.size < to.size) {
        // MaterialX convert pads the 3rd component with 0 and the 4th with 1.
        const pads: string[] = [];
        for (let i = from.size; i < to.size; i++) pads.push(i === 3 ? '1.0' : '0.0');
        return `${target}(${cast(src, from.size)}, ${pads.join(', ')})`;
      }
      return cast(`${src}.${'xyzw'.slice(0, to.size)}`, to.size);
    }
    return `${target}(0.0)`;
  }
  if (to.kind === 'scalar') {
    const component = from.kind === 'vector' ? `${src}.x` : src;
    const fromScalar = from.kind === 'vector' || from.kind === 'scalar' ? from.scalar : to.scalar;
    if (from.kind !== 'vector' && from.kind !== 'scalar') return to.scalar === 'bool' ? 'false' : `${wgslType(to)}(0)`;
    if (fromScalar === to.scalar) return component;
    if (to.scalar === 'bool') return `(${component} != ${fromScalar === 'float' ? '0.0' : '0'})`;
    return `${wgslType(to)}(${component})`;
  }
  return src;
}

function emitTexture(
  expr: Extract<IrExpr, { kind: 'texture' }>,
  varName: (r: IrRef) => string,
  prefix: string,
  computeStage: boolean,
): string {
  const tex = `${prefix}tex_${ident(expr.texture)}`;
  const samp = `${prefix}samp_${ident(expr.sampler)}`;
  const uv = varName(expr.uv);
  let sample: string;
  if (expr.gradient) {
    sample = `textureSampleGrad(${tex}, ${samp}, ${uv}, ${varName(expr.gradient.ddx)}, ${varName(expr.gradient.ddy)})`;
  } else if (expr.lod) {
    sample = `textureSampleLevel(${tex}, ${samp}, ${uv}, ${varName(expr.lod)})`;
  } else if (expr.bias) {
    sample = `textureSampleBias(${tex}, ${samp}, ${uv}, ${varName(expr.bias)})`;
  } else if (computeStage) {
    // textureSample computes implicit derivatives and is only valid in a fragment
    // stage; the path tracer megakernel runs in a compute pipeline, so sample the
    // base level explicitly (mip LOD 0).
    sample = `textureSampleLevel(${tex}, ${samp}, ${uv}, 0.0)`;
  } else {
    sample = `textureSample(${tex}, ${samp}, ${uv})`;
  }
  if (expr.type.kind === 'vector') {
    if (expr.type.size === 4) return sample;
    return `(${sample}).${'rgba'.slice(0, expr.type.size)}`;
  }
  return `(${sample}).r`;
}

const KNOWN_VARYINGS = new Set(['position', 'normal', 'tangent', 'bitangent', 'texcoord']);

function inputRef(name: string): string {
  const lower = name.toLowerCase();
  if (KNOWN_VARYINGS.has(lower)) return `vary.${lower}`;
  if (lower === 'view' || lower === 'viewdir' || lower === 'viewdirection') return 'vary.viewDir';
  return `vary.in_${ident(name)}`;
}

/** Result of lowering a ShaderIr's expressions to WGSL `let` statements plus the
 *  bindings/preludes/varyings metadata needed to assemble a module. Shared by the
 *  entry-point emitter (emitWgsl) and the layered-surface emitter (surface-wgsl.ts,
 *  T055d). */
export interface LoweredExprs {
  order: IrRef[];
  /** `  let eN = <rhs>;` lines, one per reachable expression in topo order. */
  body: string[];
  preludes: Set<string>;
  extraInputs: Map<string, IrType>;
  primvarFields: Map<string, IrType>;
  usesLighting: boolean;
  uniforms: WgslUniformField[];
  textures: WgslBinding[];
  samplers: WgslBinding[];
}

/** Walk a ShaderIr and emit one `let` statement per reachable expression (topo
 *  order, CSE already applied upstream), collecting the uniform/texture/sampler
 *  bindings, required preludes and varying fields. The refs are used verbatim as
 *  WGSL variable names. `handlePrefix` namespaces the texture/sampler handles so
 *  several lowered surfaces can share one module (path tracer megakernel, T057g);
 *  it defaults to empty for single-surface modules. `computeStage` forces explicit
 *  LOD-0 texture sampling (textureSample is fragment-only; the PT megakernel runs
 *  in a compute pipeline). */
export function lowerExprs(ir: ShaderIr, handlePrefix = '', computeStage = false): LoweredExprs {
  const ctx: NodeEmitContext = {
    varyings: {
      position: 'vary.position',
      normal: 'vary.normal',
      tangent: 'vary.tangent',
      bitangent: 'vary.bitangent',
      texcoord: 'vary.texcoord',
      viewDir: 'vary.viewDir',
    },
    wgslType,
  };

  const order = topoOrder(ir);
  const varName = (r: IrRef): string => r;
  const preludes = new Set<string>([CLOSURE_PRELUDE]);
  // Texture/sampler handles actually sampled by the emitted body. A declared but
  // unreachable texture (e.g. an input the surface family never reads) would add
  // a WGSL binding the shader never uses, which auto-layout prunes -- leaving the
  // device bind group one entry longer than the pipeline layout. Only emit the
  // bindings the body references.
  const usedTextures = new Set<string>();
  const usedSamplers = new Set<string>();
  const extraInputs = new Map<string, IrType>();
  const primvarFields = new Map<string, IrType>();
  const body: string[] = [];
  let usesLighting = false;

  for (const ref of order) {
    const expr = ir.exprs.get(ref)!;
    let rhs: string;
    switch (expr.kind) {
      case 'const':
        rhs = litConst(expr.type, expr.value);
        break;
      case 'param':
        rhs = `u.${ident(expr.name)}`;
        break;
      case 'input': {
        const r = inputRef(expr.name);
        if (r.startsWith('vary.in_')) extraInputs.set(expr.name, expr.type);
        rhs = r;
        break;
      }
      case 'primvar':
        rhs = `vary.v_${ident(expr.name)}`;
        primvarFields.set(expr.name, expr.type);
        break;
      case 'convert':
        rhs = emitConvert(varName(expr.source), expr.from, expr.type);
        break;
      case 'swizzle':
        rhs = `${varName(expr.source)}.${expr.pattern}`;
        break;
      case 'texture':
        rhs = emitTexture(expr, varName, handlePrefix, computeStage);
        usedTextures.add(expr.texture);
        usedSamplers.add(expr.sampler);
        break;
      case 'call': {
        const lowering = getNodeLowering(expr.op);
        if (!lowering) throw new WgslEmitError(`no WGSL lowering for node '${expr.op}'`);
        addPreludes(preludes, lowering.prelude);
        const named = Object.fromEntries(Object.entries(expr.namedArgs ?? {}).map(([name, ref]) => [name, varName(ref)]));
        const types: Record<string, IrType> = {};
        for (const [name, argRef] of Object.entries(expr.namedArgs ?? {})) {
          const argExpr = ir.exprs.get(argRef);
          if (argExpr) types[name] = argExpr.type;
        }
        rhs = lowering.emit(makeInputs(expr.args.map(varName), named, expr.namedArgs !== undefined, types), expr.type, ctx);
        break;
      }
      case 'closure': {
        const lowering = getNodeLowering(expr.op);
        if (!lowering) throw new WgslEmitError(`no WGSL lowering for closure '${expr.op}'`);
        if (closureUsesLighting(expr.op)) {
          preludes.add(LIGHTING_PRELUDE);
          usesLighting = true;
        }
        addPreludes(preludes, lowering.prelude);
        const named: Record<string, string> = {};
        for (const [k, v] of Object.entries(expr.params)) named[k] = varName(v);
        rhs = lowering.emit(makeInputs([], named), expr.type, ctx);
        break;
      }
      case 'combine':
        rhs = emitCombine(expr, varName);
        break;
    }
    body.push(`  let ${ref} = ${rhs};`);
  }

  // Uniforms.
  const uniforms: WgslUniformField[] = ir.params.map((p) => ({ name: p.name, field: ident(p.name), wgslType: wgslType(p.type) }));
  // Bindings. Only expose textures/samplers the body actually samples so the
  // declared WGSL bindings match what auto-layout keeps (and the device plan).
  const usedTex = ir.textures.filter((t) => usedTextures.has(t.name));
  const usedSamp = ir.samplers.filter((s) => usedSamplers.has(s.name));
  const textures: WgslBinding[] = usedTex.map((t, i) => ({ name: t.name, handle: `${handlePrefix}tex_${ident(t.name)}`, group: 1, binding: i, ...(t.fileRef !== undefined ? { fileRef: t.fileRef } : {}) }));
  const samplers: WgslBinding[] = usedSamp.map((s, i) => ({ name: s.name, handle: `${handlePrefix}samp_${ident(s.name)}`, group: 2, binding: i }));
  return { order, body, preludes, extraInputs, primvarFields, usesLighting, uniforms, textures, samplers };
}

export function emitWgsl(ir: ShaderIr): WgslModule {
  const lowered = lowerExprs(ir);
  const { uniforms, textures, samplers, preludes, primvarFields, extraInputs, body, usesLighting } = lowered;

  // Outputs.
  const seenFields = new Set<string>();
  const outputs: WgslOutput[] = ir.outputs.map((o) => {
    let field = ident(o.name);
    while (seenFields.has(field)) field = `${field}_`;
    seenFields.add(field);
    return { name: o.name, field, wgslType: wgslType(o.type) };
  });

  const outputAssigns = ir.outputs.map((o, i) => ({ field: outputs[i]!.field, ref: o.ref }));
  const code = assembleModule({ uniforms, textures, samplers, outputs, outputAssigns, preludes, primvarFields, extraInputs, body });
  return {
    code,
    entryPoint: ENTRY_POINT,
    uniforms,
    textures,
    samplers,
    outputs,
    ...(usesLighting ? { lighting: { group: 0, binding: 1 } } : {}),
  };
}

function emitCombine(expr: Extract<IrExpr, { kind: 'combine' }>, varName: (r: IrRef) => string): string {
  const ops = expr.operands.map(varName);
  const isClosure = expr.type.kind === 'closure' || expr.type.kind === 'shader';
  if (isClosure) {
    switch (expr.op) {
      case 'add':
        return ops.reduce((a, b) => `mx_closure_add(${a}, ${b})`);
      case 'mix':
        return `mx_closure_mix(${ops[0]}, ${ops[1]}, ${expr.weight ? varName(expr.weight) : '0.5'})`;
      case 'multiply':
        return `mx_closure_mul(${ops[0]}, ${ops[1]}.color)`;
      case 'layer':
        return `mx_layer(${ops[0]}, ${ops[1]})`;
    }
  }
  switch (expr.op) {
    case 'add':
      return `(${ops.join(' + ')})`;
    case 'multiply':
      return `(${ops.join(' * ')})`;
    case 'mix':
      return `mix(${ops[0]}, ${ops[1]}, ${expr.weight ? varName(expr.weight) : '0.5'})`;
    case 'layer':
      return `(${ops.join(' + ')})`;
    default:
      throw new WgslEmitError(`unsupported combine op`);
  }
}

interface AssembleArgs {
  uniforms: WgslUniformField[];
  textures: WgslBinding[];
  samplers: WgslBinding[];
  outputs: WgslOutput[];
  outputAssigns: { field: string; ref: IrRef }[];
  preludes: Set<string>;
  primvarFields: Map<string, IrType>;
  extraInputs: Map<string, IrType>;
  body: string[];
}

/** The standard varyings struct (position/normal/tangent/bitangent/texcoord/viewDir)
 *  plus any primvar (`v_*`) and extra input (`in_*`) fields. Shared by the entry
 *  module and the layered-surface module (T055d). */
export function emitVaryingsStruct(primvarFields: Map<string, IrType>, extraInputs: Map<string, IrType>): string {
  const varyingFields = [
    '  position: vec3f,',
    '  normal: vec3f,',
    '  tangent: vec3f,',
    '  bitangent: vec3f,',
    '  texcoord: vec2f,',
    '  viewDir: vec3f,',
  ];
  for (const [name, type] of primvarFields) varyingFields.push(`  v_${ident(name)}: ${wgslType(type)},`);
  for (const [name, type] of extraInputs) varyingFields.push(`  in_${ident(name)}: ${wgslType(type)},`);
  return `struct MxVaryings {\n${varyingFields.join('\n')}\n};`;
}

function assembleModule(a: AssembleArgs): string {
  const parts: string[] = [];
  parts.push([...a.preludes].join('\n'));

  if (a.uniforms.length > 0) {
    parts.push(
      `struct MxUniforms {\n${a.uniforms.map((u) => `  ${u.field}: ${u.wgslType},`).join('\n')}\n};\n@group(0) @binding(0) var<uniform> u: MxUniforms;`,
    );
  }

  for (const t of a.textures) parts.push(`@group(${t.group}) @binding(${t.binding}) var ${t.handle}: texture_2d<f32>;`);
  for (const s of a.samplers) parts.push(`@group(${s.group}) @binding(${s.binding}) var ${s.handle}: sampler;`);

  parts.push(emitVaryingsStruct(a.primvarFields, a.extraInputs));

  parts.push(`struct MxOutputs {\n${a.outputs.map((o) => `  ${o.field}: ${o.wgslType},`).join('\n')}\n};`);

  const assigns = a.outputAssigns.map((o) => `  result.${o.field} = ${o.ref};`);
  parts.push(
    `fn ${ENTRY_POINT}(vary: MxVaryings) -> MxOutputs {\n${a.body.join('\n')}\n  var result: MxOutputs;\n${assigns.join('\n')}\n  return result;\n}`,
  );

  return parts.join('\n\n') + '\n';
}
