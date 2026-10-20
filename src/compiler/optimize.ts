// IR optimizer (plan section 7.3). Conservative, semantics-preserving passes:
//  - explicit specialization of named editable params (opt-in only),
//  - constant folding limited to identity/broadcast converts and swizzles,
//  - canonicalization of commutative closure compositions,
//  - common-subexpression elimination,
//  - dead-code elimination and unused-resource reduction.
//
// Editable params are never frozen unless explicitly specialized, closures are
// never folded, and no float reassociation / fast-math is applied.

import {
  typeToString,
  typesEqual,
  type IrConstValue,
  type IrExpr,
  type IrOutput,
  type IrRef,
  type IrType,
  type ParamResource,
  type PrimvarResource,
  type SamplerResource,
  type ShaderIr,
  type TextureResource,
} from './ir.ts';

export interface OptimizeOptions {
  /** Replace named editable params with constants (explicit specialization). */
  specialize?: Readonly<Record<string, IrConstValue>>;
}

interface WorkingIr {
  exprs: Map<IrRef, IrExpr>;
  outputs: IrOutput[];
}

export function optimize(ir: ShaderIr, options: OptimizeOptions = {}): ShaderIr {
  const work: WorkingIr = {
    exprs: new Map(ir.exprs),
    outputs: ir.outputs.map((o) => ({ ...o })),
  };

  if (options.specialize) specialize(work, options.specialize);
  foldToFixpoint(work.exprs);
  canonicalize(work.exprs);
  commonSubexpressionElimination(work);

  const reachable = collectReachable(work);
  const exprs = new Map<IrRef, IrExpr>();
  for (const ref of reachable) {
    const expr = work.exprs.get(ref);
    if (expr) exprs.set(ref, expr);
  }

  return {
    exprs,
    outputs: work.outputs,
    ...pruneResources(ir, exprs),
    requirements: { ...ir.requirements },
  };
}

function childRefs(expr: IrExpr): IrRef[] {
  switch (expr.kind) {
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
    default:
      return [];
  }
}

function remapChildren(expr: IrExpr, remap: (ref: IrRef) => IrRef): IrExpr {
  switch (expr.kind) {
    case 'convert':
      return { ...expr, source: remap(expr.source) };
    case 'swizzle':
      return { ...expr, source: remap(expr.source) };
    case 'texture': {
      const next: IrExpr = { ...expr, uv: remap(expr.uv) };
      if (expr.lod) next.lod = remap(expr.lod);
      if (expr.bias) next.bias = remap(expr.bias);
      if (expr.gradient) next.gradient = { ddx: remap(expr.gradient.ddx), ddy: remap(expr.gradient.ddy) };
      return next;
    }
    case 'call':
      return {
        ...expr,
        args: expr.args.map(remap),
        ...(expr.namedArgs !== undefined ? { namedArgs: Object.fromEntries(Object.entries(expr.namedArgs).map(([name, ref]) => [name, remap(ref)])) } : {}),
      };
    case 'closure': {
      const params: Record<string, IrRef> = {};
      for (const [k, v] of Object.entries(expr.params)) params[k] = remap(v);
      return { ...expr, params };
    }
    case 'combine': {
      const next: IrExpr = { ...expr, operands: expr.operands.map(remap) };
      if (expr.weight) next.weight = remap(expr.weight);
      return next;
    }
    default:
      return expr;
  }
}

function specialize(work: WorkingIr, table: Readonly<Record<string, IrConstValue>>): void {
  for (const [ref, expr] of work.exprs) {
    if (expr.kind === 'param' && expr.name in table) {
      const value = table[expr.name] as IrConstValue;
      work.exprs.set(ref, expr.meta ? { kind: 'const', type: expr.type, value, meta: expr.meta } : { kind: 'const', type: expr.type, value });
    }
  }
}

function foldToFixpoint(exprs: Map<IrRef, IrExpr>): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const [ref, expr] of exprs) {
      if (expr.kind === 'convert') {
        const src = exprs.get(expr.source);
        if (src?.kind === 'const') {
          const value = foldConvert(src.type, expr.type, src.value);
          if (value !== undefined) {
            exprs.set(ref, expr.meta ? { kind: 'const', type: expr.type, value, meta: expr.meta } : { kind: 'const', type: expr.type, value });
            changed = true;
          }
        }
      } else if (expr.kind === 'swizzle') {
        const src = exprs.get(expr.source);
        if (src?.kind === 'const' && Array.isArray(src.value)) {
          const value = foldSwizzle(expr.pattern, src.value);
          if (value !== undefined) {
            exprs.set(ref, expr.meta ? { kind: 'const', type: expr.type, value, meta: expr.meta } : { kind: 'const', type: expr.type, value });
            changed = true;
          }
        }
      }
    }
  }
}

function foldConvert(from: IrType, to: IrType, value: IrConstValue): IrConstValue | undefined {
  if (typesEqual(from, to)) return value;
  // Scalar -> vector broadcast is the only numeric widening we fold.
  if (from.kind === 'scalar' && to.kind === 'vector' && typeof value === 'number') {
    return Array.from({ length: to.size }, () => value);
  }
  return undefined;
}

const SWIZZLE_INDEX: Readonly<Record<string, number>> = { x: 0, y: 1, z: 2, w: 3, r: 0, g: 1, b: 2, a: 3 };

function foldSwizzle(pattern: string, value: readonly number[]): IrConstValue | undefined {
  const out: number[] = [];
  for (const ch of pattern) {
    const idx = SWIZZLE_INDEX[ch];
    if (idx === undefined || idx >= value.length) return undefined;
    out.push(value[idx] as number);
  }
  return out.length === 1 ? (out[0] as number) : out;
}

function canonicalize(exprs: Map<IrRef, IrExpr>): void {
  for (const [ref, expr] of exprs) {
    if (expr.kind === 'combine' && (expr.op === 'add' || expr.op === 'multiply')) {
      const operands = [...expr.operands].sort();
      exprs.set(ref, { ...expr, operands });
    }
  }
}

function structuralKey(expr: IrExpr): string {
  const base = `${expr.kind}|${typeToString(expr.type)}`;
  switch (expr.kind) {
    case 'const':
      return `${base}|${Array.isArray(expr.value) ? `[${expr.value.join(',')}]` : String(expr.value)}`;
    case 'param':
    case 'input':
      return `${base}|${expr.name}`;
    case 'primvar':
      return `${base}|${expr.name}|${expr.space ?? ''}`;
    case 'convert':
      return `${base}|${typeToString(expr.from)}|${expr.source}`;
    case 'swizzle':
      return `${base}|${expr.pattern}|${expr.source}`;
    case 'texture':
      return `${base}|${expr.texture}|${expr.sampler}|${expr.uv}|${expr.lod ?? ''}|${expr.bias ?? ''}|${expr.gradient ? `${expr.gradient.ddx},${expr.gradient.ddy}` : ''}`;
    case 'call':
      return `${base}|${expr.op}|${expr.args.join(',')}|${expr.namedArgs === undefined ? 'positional' : JSON.stringify(Object.entries(expr.namedArgs).sort(([first], [second]) => first.localeCompare(second)))}`;
    case 'closure': {
      const params = Object.entries(expr.params)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      return `${base}|${expr.closure}|${expr.op}|${params}`;
    }
    case 'combine':
      return `${base}|${expr.op}|${expr.operands.join(',')}|${expr.weight ?? ''}`;
  }
}

function commonSubexpressionElimination(work: WorkingIr): void {
  const order = topoOrder(work);
  const remap = new Map<IrRef, IrRef>();
  const resolve = (ref: IrRef): IrRef => remap.get(ref) ?? ref;
  const seen = new Map<string, IrRef>();

  for (const ref of order) {
    const original = work.exprs.get(ref);
    if (!original) continue;
    const rewritten = remapChildren(original, resolve);
    work.exprs.set(ref, rewritten);
    const key = structuralKey(rewritten);
    const canonical = seen.get(key);
    if (canonical !== undefined) {
      remap.set(ref, canonical);
      work.exprs.delete(ref);
    } else {
      seen.set(key, ref);
    }
  }

  for (const output of work.outputs) output.ref = resolve(output.ref);
}

function topoOrder(work: WorkingIr): IrRef[] {
  const order: IrRef[] = [];
  const state = new Map<IrRef, 'visiting' | 'done'>();
  const visit = (ref: IrRef): void => {
    if (state.get(ref) === 'done' || state.get(ref) === 'visiting') return;
    const expr = work.exprs.get(ref);
    if (!expr) return;
    state.set(ref, 'visiting');
    for (const child of childRefs(expr)) visit(child);
    state.set(ref, 'done');
    order.push(ref);
  };
  for (const output of work.outputs) visit(output.ref);
  return order;
}

function collectReachable(work: WorkingIr): Set<IrRef> {
  const reachable = new Set<IrRef>();
  const visit = (ref: IrRef): void => {
    if (reachable.has(ref)) return;
    const expr = work.exprs.get(ref);
    if (!expr) return;
    reachable.add(ref);
    for (const child of childRefs(expr)) visit(child);
  };
  for (const output of work.outputs) visit(output.ref);
  return reachable;
}

function pruneResources(
  ir: ShaderIr,
  exprs: ReadonlyMap<IrRef, IrExpr>,
): {
  textures: TextureResource[];
  samplers: SamplerResource[];
  params: ParamResource[];
  primvars: PrimvarResource[];
} {
  const textures = new Set<string>();
  const samplers = new Set<string>();
  const params = new Set<string>();
  const primvars = new Set<string>();

  for (const expr of exprs.values()) {
    if (expr.kind === 'texture') {
      textures.add(expr.texture);
      samplers.add(expr.sampler);
    } else if (expr.kind === 'param') {
      params.add(expr.name);
    } else if (expr.kind === 'primvar') {
      primvars.add(expr.name);
    }
  }

  return {
    textures: ir.textures.filter((t) => textures.has(t.name)),
    samplers: ir.samplers.filter((s) => samplers.has(s.name)),
    params: ir.params.filter((p) => params.has(p.name)),
    primvars: ir.primvars.filter((p) => primvars.has(p.name)),
  };
}
