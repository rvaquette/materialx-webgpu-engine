// Feature, layout and pass extraction (plan section 7.4). Walks a ShaderIr and
// produces structured requirements -- vertex attributes, a logical binding
// layout, closure usage, capability flags, render passes and a canonical variant
// key -- rather than a flat list of booleans. Detection is structural (based on
// node/closure ops and declared input/param names), never value-evaluated.

import type {
  ClosureKind,
  EvaluationRequirements,
  IrType,
  ShaderIr,
} from './ir.ts';
import { typeToString } from './ir.ts';

export type AttributeSemantic =
  | 'position'
  | 'normal'
  | 'tangent'
  | 'bitangent'
  | 'texcoord'
  | 'color'
  | 'custom';

export interface VertexAttribute {
  name: string;
  semantic: AttributeSemantic;
  type: IrType;
  location: number;
}

export interface UniformMember {
  name: string;
  type: IrType;
}

export interface TextureBinding {
  name: string;
  valueType: IrType;
  colorSpace?: string;
  group: number;
  binding: number;
}

export interface SamplerBinding {
  name: string;
  group: number;
  binding: number;
}

export interface BindingLayout {
  uniforms: UniformMember[];
  textures: TextureBinding[];
  samplers: SamplerBinding[];
}

export interface ClosureUsage {
  kind: ClosureKind;
  op: string;
  count: number;
}

export interface FeatureFlags {
  hasBsdf: boolean;
  hasEdf: boolean;
  hasVdf: boolean;
  hasBssrdf: boolean;
  transparency: boolean;
  transmission: boolean;
  coat: boolean;
  anisotropy: boolean;
  thinFilm: boolean;
  subsurface: boolean;
  volume: boolean;
  displacement: boolean;
  /** A tangent frame is required (anisotropy / thin film). */
  needsTangentFrame: boolean;
}

export type RenderPassKind = 'displacement' | 'opaque' | 'transmission' | 'volume';

export interface RenderPass {
  kind: RenderPassKind;
  reason: string;
}

export interface ShaderFeatures {
  attributes: VertexAttribute[];
  layout: BindingLayout;
  closures: ClosureUsage[];
  flags: FeatureFlags;
  passes: RenderPass[];
  requirements: EvaluationRequirements;
  variantKey: string;
}

const SEMANTIC_ORDER: Readonly<Record<AttributeSemantic, number>> = {
  position: 0,
  normal: 1,
  tangent: 2,
  bitangent: 3,
  texcoord: 4,
  color: 5,
  custom: 6,
};

function attributeSemantic(name: string, type: IrType): AttributeSemantic {
  const n = name.toLowerCase();
  if (n === 'p' || n === 'position') return 'position';
  if (n === 'n' || n === 'normal') return 'normal';
  if (n === 't' || n === 'tangent') return 'tangent';
  if (n === 'bitangent' || n === 'binormal') return 'bitangent';
  if (type.kind === 'vector' && type.semantic === 'texcoord') return 'texcoord';
  if (n === 'st' || n.startsWith('uv') || n.startsWith('texcoord')) return 'texcoord';
  if (n.includes('color') || type.kind === 'vector' && type.semantic === 'color') return 'color';
  return 'custom';
}

function extractAttributes(ir: ShaderIr): VertexAttribute[] {
  const attrs = ir.primvars.map((p) => ({
    name: p.name,
    semantic: attributeSemantic(p.name, p.type),
    type: p.type,
  }));
  attrs.sort((a, b) =>
    SEMANTIC_ORDER[a.semantic] - SEMANTIC_ORDER[b.semantic] || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
  return attrs.map((a, i) => ({ ...a, location: i }));
}

function extractLayout(ir: ShaderIr): BindingLayout {
  const uniforms: UniformMember[] = ir.params.map((p) => ({ name: p.name, type: p.type }));
  const textures: TextureBinding[] = ir.textures.map((t, i) => ({
    name: t.name,
    valueType: t.valueType,
    ...(t.colorSpace !== undefined ? { colorSpace: t.colorSpace } : {}),
    group: 1,
    binding: i,
  }));
  const samplers: SamplerBinding[] = ir.samplers.map((s, i) => ({ name: s.name, group: 2, binding: i }));
  return { uniforms, textures, samplers };
}

function extractClosures(ir: ShaderIr): ClosureUsage[] {
  const counts = new Map<string, ClosureUsage>();
  for (const expr of ir.exprs.values()) {
    if (expr.kind === 'closure') {
      const key = `${expr.closure}|${expr.op}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { kind: expr.closure, op: expr.op, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => (a.op < b.op ? -1 : a.op > b.op ? 1 : 0));
}

function gatherTokens(ir: ShaderIr): Set<string> {
  const tokens = new Set<string>();
  for (const expr of ir.exprs.values()) {
    switch (expr.kind) {
      case 'closure':
        tokens.add(expr.op.toLowerCase());
        for (const k of Object.keys(expr.params)) tokens.add(k.toLowerCase());
        break;
      case 'call':
        tokens.add(expr.op.toLowerCase());
        break;
      case 'param':
      case 'input':
      case 'primvar':
        tokens.add(expr.name.toLowerCase());
        break;
    }
  }
  for (const p of ir.params) tokens.add(p.name.toLowerCase());
  return tokens;
}

function anyToken(tokens: Set<string>, substrings: readonly string[]): boolean {
  for (const token of tokens) {
    for (const s of substrings) if (token.includes(s)) return true;
  }
  return false;
}

function extractFlags(ir: ShaderIr): FeatureFlags {
  const closureKinds = new Set<ClosureKind>();
  for (const expr of ir.exprs.values()) {
    if (expr.kind === 'closure') closureKinds.add(expr.closure);
  }
  const tokens = gatherTokens(ir);
  const hasVolumeOutput = ir.outputs.some((o) => o.type.kind === 'shader' && o.type.shader === 'volume');
  const displacement = ir.outputs.some((o) => o.type.kind === 'shader' && o.type.shader === 'displacement');

  const transmission = anyToken(tokens, ['transmission', 'dielectric_bsdf', 'translucent']);
  const subsurface = closureKinds.has('bssrdf') || anyToken(tokens, ['subsurface']);
  const volume = closureKinds.has('vdf') || hasVolumeOutput || anyToken(tokens, ['_vdf', 'absorption', 'anisotropic_vdf']);
  const coat = anyToken(tokens, ['coat']);
  const anisotropy = anyToken(tokens, ['anisotrop']);
  const thinFilm = anyToken(tokens, ['thin_film', 'thinfilm']);

  return {
    hasBsdf: closureKinds.has('bsdf'),
    hasEdf: closureKinds.has('edf'),
    hasVdf: closureKinds.has('vdf'),
    hasBssrdf: closureKinds.has('bssrdf'),
    transparency: transmission || anyToken(tokens, ['opacity']),
    transmission,
    coat,
    anisotropy,
    thinFilm,
    subsurface,
    volume,
    displacement,
    needsTangentFrame: anisotropy || thinFilm,
  };
}

function extractPasses(flags: FeatureFlags): RenderPass[] {
  const passes: RenderPass[] = [];
  if (flags.displacement) passes.push({ kind: 'displacement', reason: 'displacementshader output present' });
  passes.push({ kind: 'opaque', reason: 'base surface shading' });
  if (flags.transmission) passes.push({ kind: 'transmission', reason: 'transmissive BSDF present' });
  if (flags.volume) passes.push({ kind: 'volume', reason: 'volume distribution present' });
  return passes;
}

function variantKey(features: Omit<ShaderFeatures, 'variantKey'>): string {
  const flags = Object.entries(features.flags)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort()
    .join(',');
  const attrs = features.attributes.map((a) => `${a.semantic}:${typeToString(a.type)}`).join('|');
  const closures = features.closures.map((c) => `${c.kind}.${c.op}`).join('|');
  const req = Object.entries(features.requirements)
    .filter(([, v]) => v)
    .map(([k]) => k)
    .sort()
    .join(',');
  const passes = features.passes.map((p) => p.kind).join(',');
  return `flags[${flags}];attrs[${attrs}];closures[${closures}];req[${req}];passes[${passes}]`;
}

/** Extract structured features, layout, passes and a variant key from the IR. */
export function extractFeatures(ir: ShaderIr): ShaderFeatures {
  const attributes = extractAttributes(ir);
  const layout = extractLayout(ir);
  const closures = extractClosures(ir);
  const flags = extractFlags(ir);
  const passes = extractPasses(flags);
  const requirements = { ...ir.requirements };
  const partial = { attributes, layout, closures, flags, passes, requirements };
  return { ...partial, variantKey: variantKey(partial) };
}
