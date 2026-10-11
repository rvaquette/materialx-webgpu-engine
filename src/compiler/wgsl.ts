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

function litFloat(n: number): string {
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
      return [...expr.args];
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

function makeInputs(positional: readonly string[], named: Readonly<Record<string, string>>): NodeInputs {
  return {
    at(index, fallback) {
      const v = positional[index];
      if (v !== undefined) return v;
      if (fallback !== undefined) return fallback;
      throw new WgslEmitError(`missing positional argument ${index}`);
    },
    named(name, fallback) {
      const v = named[name];
      if (v !== undefined) return v;
      if (fallback !== undefined) return fallback;
      throw new WgslEmitError(`missing named input '${name}'`);
    },
    has(name) {
      return named[name] !== undefined;
    },
  };
}

function emitConvert(src: string, from: IrType, to: IrType): string {
  if (to.kind === 'vector') {
    if (from.kind === 'scalar') return `${wgslType(to)}(${src})`;
    if (from.kind === 'vector') {
      if (from.size === to.size) return src;
      if (from.size < to.size) {
        const pad = to.size - from.size === 1 ? '1.0' : Array(to.size - from.size).fill('1.0').join(', ');
        return `${wgslType(to)}(${src}, ${pad})`;
      }
      return `${src}.${'xyzw'.slice(0, to.size)}`;
    }
  }
  if (to.kind === 'scalar') {
    if (from.kind === 'vector') return `${src}.x`;
    if (from.kind === 'scalar' && from.scalar !== to.scalar) return `${wgslType(to)}(${src})`;
  }
  return src;
}

function emitTexture(expr: Extract<IrExpr, { kind: 'texture' }>, varName: (r: IrRef) => string): string {
  const tex = `tex_${ident(expr.texture)}`;
  const samp = `samp_${ident(expr.sampler)}`;
  const uv = varName(expr.uv);
  let sample: string;
  if (expr.gradient) {
    sample = `textureSampleGrad(${tex}, ${samp}, ${uv}, ${varName(expr.gradient.ddx)}, ${varName(expr.gradient.ddy)})`;
  } else if (expr.lod) {
    sample = `textureSampleLevel(${tex}, ${samp}, ${uv}, ${varName(expr.lod)})`;
  } else if (expr.bias) {
    sample = `textureSampleBias(${tex}, ${samp}, ${uv}, ${varName(expr.bias)})`;
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

export function emitWgsl(ir: ShaderIr): WgslModule {
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
  const extraInputs = new Map<string, IrType>();
  const primvarFields = new Map<string, IrType>();
  const body: string[] = [];

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
        rhs = emitTexture(expr, varName);
        break;
      case 'call': {
        const lowering = getNodeLowering(expr.op);
        if (!lowering) throw new WgslEmitError(`no WGSL lowering for node '${expr.op}'`);
        if (lowering.prelude) preludes.add(lowering.prelude);
        rhs = lowering.emit(makeInputs(expr.args.map(varName), {}), expr.type, ctx);
        break;
      }
      case 'closure': {
        const lowering = getNodeLowering(expr.op);
        if (!lowering) throw new WgslEmitError(`no WGSL lowering for closure '${expr.op}'`);
        if (lowering.prelude) preludes.add(lowering.prelude);
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
  // Bindings.
  const textures: WgslBinding[] = ir.textures.map((t, i) => ({ name: t.name, handle: `tex_${ident(t.name)}`, group: 1, binding: i }));
  const samplers: WgslBinding[] = ir.samplers.map((s, i) => ({ name: s.name, handle: `samp_${ident(s.name)}`, group: 2, binding: i }));
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
  return { code, entryPoint: ENTRY_POINT, uniforms, textures, samplers, outputs };
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

  const varyingFields = [
    '  position: vec3f,',
    '  normal: vec3f,',
    '  tangent: vec3f,',
    '  bitangent: vec3f,',
    '  texcoord: vec2f,',
    '  viewDir: vec3f,',
  ];
  for (const [name, type] of a.primvarFields) varyingFields.push(`  v_${ident(name)}: ${wgslType(type)},`);
  for (const [name, type] of a.extraInputs) varyingFields.push(`  in_${ident(name)}: ${wgslType(type)},`);
  parts.push(`struct MxVaryings {\n${varyingFields.join('\n')}\n};`);

  parts.push(`struct MxOutputs {\n${a.outputs.map((o) => `  ${o.field}: ${o.wgslType},`).join('\n')}\n};`);

  const assigns = a.outputAssigns.map((o) => `  result.${o.field} = ${o.ref};`);
  parts.push(
    `fn ${ENTRY_POINT}(vary: MxVaryings) -> MxOutputs {\n${a.body.join('\n')}\n  var result: MxOutputs;\n${assigns.join('\n')}\n  return result;\n}`,
  );

  return parts.join('\n\n') + '\n';
}
